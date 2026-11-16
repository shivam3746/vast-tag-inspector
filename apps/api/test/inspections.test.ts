import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { connectDatabase } from '../src/db.ts';
import { createInspectionRepository } from '../src/inspection-repository.ts';
import { createInspectionService } from '../src/inspection-service.ts';
import { teams } from '../src/schema.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const xml = readFileSync(
  new URL(
    '../../../packages/vast-core/test/fixtures/inline-no-impression.xml',
    import.meta.url,
  ),
  'utf8',
);

function poll(client: ReturnType<typeof request>, id: string, status: string) {
  return vi.waitFor(
    async () => {
      const result = await client.get(`/api/inspections/${id}`).expect(200);
      expect(result.body.status).toBe(status);
      return result;
    },
    { timeout: 5000, interval: 25 },
  );
}

describe.skipIf(!testDatabaseUrl)('inspection API with Postgres', () => {
  let connection: ReturnType<typeof connectDatabase>;
  let repository: ReturnType<typeof createInspectionRepository>;
  let client: ReturnType<typeof request>;

  beforeAll(async () => {
    if (!testDatabaseUrl)
      throw new Error('Set TEST_DATABASE_URL to a dedicated test database.');
    connection = connectDatabase(testDatabaseUrl);
    await migrate(connection.db, {
      migrationsFolder: fileURLToPath(
        new URL('../../../drizzle/', import.meta.url),
      ),
    });
    const teamId = randomUUID();
    await connection.db
      .insert(teams)
      .values({ id: teamId, name: 'Integration test' });
    repository = createInspectionRepository(connection.db, teamId);
    client = request(createApp(createInspectionService(repository)));
  });

  afterAll(async () => connection?.close());

  it('accepts XML, then returns stored hops and linked findings on polling', async () => {
    const accepted = await client
      .post('/api/inspections')
      .send({ type: 'xml', value: xml })
      .expect(202);
    const id = accepted.body.id;
    expect(accepted.headers.location).toBe(`/api/inspections/${id}`);
    const { body: inspection } = await poll(client, id, 'done');
    expect(inspection).toMatchObject({
      id,
      sourceType: 'xml',
      sourceRef: 'Pasted XML',
      hopCount: 1,
      maxSeverity: 'error',
    });
    expect(inspection.hops).toMatchObject([
      { kind: 'inline', index: 0, vastVersion: '4.3' },
    ]);
    expect(inspection.findings).toMatchObject([
      {
        ruleId: 'IMP-MISSING',
        severity: 'error',
        hopId: inspection.hops[0].id,
      },
    ]);
    expect(JSON.stringify(inspection)).not.toContain('<VAST');

    const { body: history } = await client
      .get('/api/inspections?limit=1&offset=0')
      .expect(200);
    expect(history).toMatchObject({ items: [{ id }], limit: 1, offset: 0 });
  });

  it('stores a typed fetch rejection and excludes URL paths and credentials from storage', async () => {
    const accepted = await client
      .post('/api/inspections')
      .send({
        type: 'url',
        value: 'https://localhost/private?token=example',
      })
      .expect(202);
    const { body } = await poll(client, accepted.body.id, 'failed');
    expect(body).toMatchObject({
      sourceRef: 'https://localhost',
      errorCode: 'FETCH_BLOCKED_IP',
      hops: [{ kind: 'error', errorCode: 'FETCH_BLOCKED_IP' }],
    });
  });

  it('enforces queue capacity and leaves a second job queued until a slot opens', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn(async () => {
      await gate;
      return { status: 200, body: xml };
    });
    const gatedClient = request(
      createApp(
        createInspectionService(repository, {
          concurrency: 1,
          capacity: 2,
          fetch,
        }),
      ),
    );
    let firstId: string | undefined;
    let secondId: string | undefined;
    try {
      const first = await gatedClient
        .post('/api/inspections')
        .send({ type: 'url', value: 'https://fixture.example/tag.xml' })
        .expect(202);
      firstId = first.body.id;
      await poll(gatedClient, first.body.id, 'running');
      const second = await gatedClient
        .post('/api/inspections')
        .send({ type: 'xml', value: xml })
        .expect(202);
      secondId = second.body.id;
      await poll(gatedClient, second.body.id, 'queued');
      const third = await gatedClient
        .post('/api/inspections')
        .send({ type: 'xml', value: xml })
        .expect(503);
      expect(third.body.error.code).toBe('QUEUE_FULL');
    } finally {
      release();
      if (firstId) await poll(gatedClient, firstId, 'done');
      if (secondId) await poll(gatedClient, secondId, 'done');
    }
  });

  it('recovers pending work and scopes recovery and reads to the repository team', async () => {
    const teamId = randomUUID();
    await connection.db
      .insert(teams)
      .values({ id: teamId, name: 'Other team' });
    const other = createInspectionRepository(connection.db, teamId);
    const otherId = await other.create({ type: 'xml', value: xml });
    const queuedId = await repository.create({ type: 'xml', value: xml });
    const runningId = await repository.create({ type: 'xml', value: xml });
    await repository.start(runningId);

    await repository.recoverInterrupted();
    for (const id of [queuedId, runningId]) {
      expect(await repository.get(id)).toMatchObject({
        status: 'failed',
        errorCode: 'PROCESS_RESTARTED',
      });
    }
    expect(await other.get(otherId)).toMatchObject({ status: 'queued' });
    await client.get(`/api/inspections/${otherId}`).expect(404);
  });

  it('returns structured validation errors', async () => {
    const invalid = await client
      .post('/api/inspections')
      .send({ type: 'url', value: 'https://user:password@fixture.example/' })
      .expect(400);
    expect(invalid.body.error.code).toBe('INVALID_INPUT');
    const malformed = await client
      .post('/api/inspections')
      .type('json')
      .send('{')
      .expect(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    const badPage = await client.get('/api/inspections?limit=500').expect(400);
    expect(badPage.body.error.code).toBe('INVALID_PAGINATION');
  });
});
