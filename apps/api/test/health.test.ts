import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';

const server = createServer(createApp());
let baseUrl: string;

beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('The test server did not bind to a TCP port.');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

it.each(['/', '/api/health'])(
  'returns a healthy response from %s',
  async (path) => {
    const response = await fetch(new URL(path, baseUrl));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  },
);

it('sets browser security headers and restricts connections to the configured project', async () => {
  const app = createApp(undefined, {
    config: {
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'sb_publishable_fixture',
    },
  });
  const response = await request(app).get('/api/config');
  expect(response.headers['content-security-policy']).toContain(
    "connect-src 'self' https://project.supabase.co",
  );
  expect(response.headers['content-security-policy']).toContain(
    "script-src 'self';",
  );
  expect(response.headers['content-security-policy']).toContain(
    "object-src 'none'",
  );
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  expect(response.headers['referrer-policy']).toBe('no-referrer');
  expect(response.headers['strict-transport-security']).toContain(
    'max-age=31536000',
  );
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers).not.toHaveProperty('x-powered-by');
});

it('does not grant cross-origin reads or authorization preflights', async () => {
  const app = createApp();
  const read = await request(app)
    .get('/api/health')
    .set('Origin', 'https://untrusted.example');
  const preflight = await request(app)
    .options('/api/inspections')
    .set('Origin', 'https://untrusted.example')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'authorization,content-type');
  for (const response of [read, preflight]) {
    expect(response.headers).not.toHaveProperty('access-control-allow-origin');
    expect(response.headers).not.toHaveProperty(
      'access-control-allow-credentials',
    );
  }
});
