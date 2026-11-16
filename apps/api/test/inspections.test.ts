import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { createTokenVerifier } from '../src/auth.ts';
import type { VerifyAccessToken } from '../src/auth.ts';
import { connectDatabase } from '../src/db.ts';
import {
  createInspectionRepository,
  recoverExpiredInspections,
} from '../src/inspection-repository.ts';
import { createInspectionService } from '../src/inspection-service.ts';
import { inspections, profiles, teams } from '../src/schema.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const xml = readFileSync(
  new URL(
    '../../../packages/vast-core/test/fixtures/inline-no-impression.xml',
    import.meta.url,
  ),
  'utf8',
);

function session(api: ReturnType<typeof request>, token: string) {
  return {
    get: (path: string) => api.get(path).auth(token, { type: 'bearer' }),
    post: (path: string) => api.post(path).auth(token, { type: 'bearer' }),
    delete: (path: string) => api.delete(path).auth(token, { type: 'bearer' }),
  };
}

function poll(client: ReturnType<typeof session>, id: string, status: string) {
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
  let verifyAccessToken: VerifyAccessToken;
  let api: ReturnType<typeof request>;
  let client: ReturnType<typeof session>;
  let viewer: ReturnType<typeof session>;
  let admin: ReturnType<typeof session>;
  let otherAdmin: ReturnType<typeof session>;
  let noProfile: ReturnType<typeof session>;
  let opsToken: string;
  let otherTeamToken: string;
  const teamId = randomUUID();
  const otherTeamId = randomUUID();
  const opsId = randomUUID();
  const viewerId = randomUUID();
  const adminId = randomUUID();
  const otherAdminId = randomUUID();

  beforeAll(async () => {
    if (!testDatabaseUrl)
      throw new Error('Set TEST_DATABASE_URL to a dedicated test database.');
    connection = connectDatabase(testDatabaseUrl);
    await migrate(connection.db, {
      migrationsFolder: fileURLToPath(
        new URL('../../../drizzle/', import.meta.url),
      ),
    });
    await connection.db.insert(teams).values([
      { id: teamId, name: 'Integration team A' },
      { id: otherTeamId, name: 'Integration team B' },
    ]);
    await connection.db.insert(profiles).values([
      { userId: opsId, teamId, role: 'ad_ops' },
      { userId: viewerId, teamId, role: 'viewer' },
      { userId: adminId, teamId, role: 'admin' },
      { userId: otherAdminId, teamId: otherTeamId, role: 'admin' },
    ]);
    const { publicKey, privateKey } = await generateKeyPair('ES256', {
      extractable: true,
    });
    const issuer = 'https://fixture.supabase.example/auth/v1';
    const keys = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), kid: 'test' }],
    });
    verifyAccessToken = createTokenVerifier(issuer, keys);
    const token = (id: string) =>
      new SignJWT({
        role: 'authenticated',
        app_metadata: { role: 'admin', team_id: otherTeamId },
      })
        .setProtectedHeader({ alg: 'ES256', kid: 'test' })
        .setIssuer(issuer)
        .setAudience('authenticated')
        .setSubject(id)
        .setExpirationTime('5m')
        .sign(privateKey);
    repository = createInspectionRepository(connection.db, teamId);
    api = request(
      createApp({
        db: connection.db,
        verifyAccessToken,
        service: createInspectionService(),
      }),
    );
    opsToken = await token(opsId);
    otherTeamToken = await token(otherAdminId);
    client = session(api, opsToken);
    viewer = session(api, await token(viewerId));
    admin = session(api, await token(adminId));
    otherAdmin = session(api, otherTeamToken);
    noProfile = session(api, await token(randomUUID()));
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
      teamId,
      createdBy: opsId,
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
    const gatedApi = request(
      createApp({
        db: connection.db,
        verifyAccessToken,
        service: createInspectionService({
          concurrency: 1,
          capacity: 2,
          fetch,
        }),
      }),
    );
    const gatedClient = session(gatedApi, opsToken);
    const secondClient = session(gatedApi, otherTeamToken);
    let firstId: string | undefined;
    let secondId: string | undefined;
    try {
      const first = await gatedClient
        .post('/api/inspections')
        .send({ type: 'url', value: 'https://fixture.example/tag.xml' })
        .expect(202);
      firstId = first.body.id;
      await poll(gatedClient, first.body.id, 'running');
      const second = await secondClient
        .post('/api/inspections')
        .send({ type: 'xml', value: xml })
        .expect(202);
      secondId = second.body.id;
      await poll(secondClient, second.body.id, 'queued');
      const third = await gatedClient
        .post('/api/inspections')
        .send({ type: 'xml', value: xml })
        .expect(503);
      expect(third.body.error.code).toBe('QUEUE_FULL');
    } finally {
      release();
      if (firstId) await poll(gatedClient, firstId, 'done');
      if (secondId) await poll(secondClient, secondId, 'done');
    }
  });

  it('recovers expired work without failing fresh jobs from another process', async () => {
    const other = createInspectionRepository(connection.db, otherTeamId);
    const otherId = await other.create(
      { type: 'xml', value: xml },
      otherAdminId,
    );
    const queuedId = await repository.create(
      { type: 'xml', value: xml },
      opsId,
    );
    const runningId = await repository.create(
      { type: 'xml', value: xml },
      opsId,
    );
    await repository.start(runningId);
    const now = Date.now();
    await connection.db
      .update(inspections)
      .set({ createdAt: new Date(now - 20 * 60_000) })
      .where(inArray(inspections.id, [queuedId, runningId]));
    await recoverExpiredInspections(connection.db, new Date(now - 15 * 60_000));
    for (const id of [queuedId, runningId]) {
      expect(await repository.get(id)).toMatchObject({
        status: 'failed',
        errorCode: 'JOB_EXPIRED',
      });
    }
    expect(await other.get(otherId)).toMatchObject({ status: 'queued' });
    await client.get(`/api/inspections/${otherId}`).expect(404);
  });

  it('requires a verified identity and a database team profile while keeping health public', async () => {
    await api.get('/api/health').expect(200);
    await api
      .get('/api/inspections')
      .expect(401)
      .expect('WWW-Authenticate', 'Bearer');
    await noProfile
      .get('/api/inspections')
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe('PROFILE_REQUIRED');
      });
  });

  it('lets a viewer read team records and denies writes despite role claims in the token', async () => {
    const id = await repository.create({ type: 'xml', value: xml }, opsId);
    await viewer
      .get(`/api/inspections/${id}`)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    await viewer
      .post('/api/inspections')
      .send({ type: 'xml', value: xml })
      .expect(403);
    await viewer.delete(`/api/inspections/${id}`).expect(403);
    await client.delete(`/api/inspections/${id}`).expect(403);
  });

  it('scopes the list, details, and admin deletion to each user’s database team', async () => {
    const first = await repository.create({ type: 'xml', value: xml }, adminId);
    const other = createInspectionRepository(connection.db, otherTeamId);
    const second = await other.create(
      { type: 'xml', value: xml },
      otherAdminId,
    );
    for (const [member, own, foreign, scope] of [
      [admin, first, second, teamId],
      [otherAdmin, second, first, otherTeamId],
    ] as const) {
      await member.get(`/api/inspections/${own}`).expect(200);
      await member.get(`/api/inspections/${foreign}`).expect(404);
      await member.delete(`/api/inspections/${foreign}`).expect(404);
      const { body } = await member.get('/api/inspections').expect(200);
      expect(body.items).toContainEqual(expect.objectContaining({ id: own }));
      expect(body.items).not.toContainEqual(
        expect.objectContaining({ id: foreign }),
      );
      expect(
        body.items.every((row: { teamId: string }) => row.teamId === scope),
      ).toBe(true);
    }
    await admin.delete(`/api/inspections/${first}`).expect(204);
    await viewer.get(`/api/inspections/${first}`).expect(404);
    await otherAdmin.get(`/api/inspections/${second}`).expect(200);
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
