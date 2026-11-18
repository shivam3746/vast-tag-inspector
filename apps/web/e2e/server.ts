import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import express from 'express';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../../api/src/app.ts';
import { createTokenVerifier } from '../../api/src/auth.ts';
import { connectDatabase } from '../../api/src/db.ts';
import {
  createExplanationService,
  withExplanationFallback,
} from '../../api/src/explanation-service.ts';
import { createInspectionService } from '../../api/src/inspection-service.ts';
import { rulesExplanationClient } from '../../api/src/rules-explainer.ts';
import { profiles, teams } from '../../api/src/schema.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error('Set TEST_DATABASE_URL to a dedicated test database.');
const baseURL = 'http://127.0.0.1:4178';
const issuer = `${baseURL}/auth/v1`;
const { db, close } = connectDatabase(databaseUrl);
await migrate(db, {
  migrationsFolder: fileURLToPath(
    new URL('../../../drizzle/', import.meta.url),
  ),
});
const userId = randomUUID();
const teamId = randomUUID();
await db.insert(teams).values({ id: teamId, name: 'Playwright team' });
await db.insert(profiles).values({ userId, teamId, role: 'ad_ops' });
const { publicKey, privateKey } = await generateKeyPair('ES256', {
  extractable: true,
});
const jwk = { ...(await exportJWK(publicKey)), kid: 'e2e' };
const signAccessToken = () =>
  new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'e2e' })
    .setIssuer(issuer)
    .setSubject(userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

const inline = readFileSync(
  new URL(
    '../../../packages/vast-core/test/fixtures/inline-no-impression.xml',
    import.meta.url,
  ),
  'utf8',
);
const wrapper =
  '<VAST version="4.3"><Ad><Wrapper><VASTAdTagURI>https://ads.fixture.example/inline</VASTAdTagURI><Impression>https://metrics.fixture.example/?token=fixture</Impression></Wrapper></Ad></VAST>';
const fixtureServer = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/xml');
  if (request.url === '/wrapper') response.end(wrapper);
  else if (request.url === '/inline') response.end(inline);
  else response.writeHead(404).end();
});
fixtureServer.listen(0, '127.0.0.1');
await once(fixtureServer, 'listening');
const address = fixtureServer.address();
if (!address || typeof address === 'string')
  throw new Error('Fixture server did not bind.');

const service = createInspectionService({
  fetch: async (url) => {
    if (
      url.origin !== 'https://ads.fixture.example' ||
      !['/wrapper', '/inline'].includes(url.pathname)
    ) {
      return { errorCode: 'FETCH_INVALID_URL' };
    }
    const response = await fetch(
      `http://127.0.0.1:${address.port}${url.pathname}`,
    );
    return { status: response.status, body: await response.text() };
  },
});
const app = express();
const explanationModel = 'gemini/fixture';
const explain = withExplanationFallback(
  createExplanationService({
    model: explanationModel,
    async complete() {
      throw new Error('Fixture provider quota exceeded.');
    },
  }),
  createExplanationService(rulesExplanationClient),
);
app.post('/auth/v1/token', express.json(), async (request, response) => {
  if (
    request.body.email !== 'fixture@example.com' ||
    request.body.password !== 'FixturePassword'
  ) {
    response.status(400).json({ message: 'Invalid login credentials' });
    return;
  }
  response.json({
    access_token: await signAccessToken(),
    refresh_token: 'fixture-refresh',
    token_type: 'bearer',
    expires_in: 300,
    user: {
      id: userId,
      role: 'authenticated',
      aud: 'authenticated',
      email: 'fixture@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  });
});
app.post('/auth/v1/logout', (_request, response) => response.status(204).end());
app.use(
  createApp(
    {
      db,
      service,
      explain,
      explanationModel,
      verifyAccessToken: createTokenVerifier(
        issuer,
        createLocalJWKSet({ keys: [jwk] }),
      ),
    },
    {
      directory: fileURLToPath(new URL('../dist/', import.meta.url)),
      config: {
        supabaseUrl: baseURL,
        supabasePublishableKey: 'sb_publishable_fixture',
      },
    },
  ),
);
const server = app.listen(4178, '127.0.0.1');
process.once('SIGTERM', () => {
  server.close();
  fixtureServer.close();
  void close();
});
