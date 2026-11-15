import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
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
