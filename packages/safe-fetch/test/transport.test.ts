import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { afterEach, expect, it, vi } from 'vitest';
import { requestPinned } from '../src/transport.ts';

const request = vi.hoisted(() =>
  vi.fn<
    (
      url: URL,
      options: RequestOptions,
      respond: (response: IncomingMessage) => void,
    ) => EventEmitter
  >(),
);
vi.mock('node:https', () => ({ request }));

const url = new URL('https://ads.example/tag.xml');
const address = { address: '1.1.1.1', family: 4 } as const;

afterEach(() => request.mockReset());

it('pins DNS lookup to the approved IP while keeping the original TLS URL', async () => {
  request.mockImplementationOnce(() => {
    const req = new EventEmitter();
    return Object.assign(req, {
      end() {
        req.emit('error', new Error('Mock transport ended'));
        req.emit('close');
      },
    });
  });
  await expect(
    requestPinned(url, address, new AbortController().signal, 100),
  ).rejects.toThrow();
  const [requestUrl, options] = request.mock.calls[0] ?? [];
  expect(requestUrl).toEqual(url);
  expect(options).toMatchObject({
    agent: false,
    family: 4,
    rejectUnauthorized: true,
    headers: { 'accept-encoding': 'identity' },
  });
  expect(options?.headers).not.toHaveProperty('cookie');
  expect(options?.headers).not.toHaveProperty('authorization');
  const result = vi.fn();
  options?.lookup?.('ads.example', { family: 4, hints: 0 }, result);
  expect(result).toHaveBeenCalledWith(null, address.address, address.family);
});

it('aborts the request when the TLS connection deadline expires', async () => {
  request.mockImplementationOnce(() => {
    const req = new EventEmitter();
    return Object.assign(req, {
      end() {},
      destroy(error: Error) {
        req.emit('error', error);
        req.emit('close');
      },
    });
  });
  await expect(
    requestPinned(url, address, new AbortController().signal, 10),
  ).rejects.toMatchObject({
    code: 'TIMEOUT',
  });
});
