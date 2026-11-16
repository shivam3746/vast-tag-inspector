import type { IncomingHttpHeaders } from 'node:http';
import { beforeEach, expect, it, vi } from 'vitest';
import { safeFetch } from '../src/index.ts';
import { requestPinned } from '../src/transport.ts';

const dns = vi.hoisted(() => ({
  resolve4: vi.fn<(host: string) => Promise<string[]>>(),
  resolve6: vi.fn<(host: string) => Promise<string[]>>(),
  cancel: vi.fn(),
}));
vi.mock('node:dns/promises', () => ({
  Resolver: class {
    resolve4 = dns.resolve4;
    resolve6 = dns.resolve6;
    cancel = dns.cancel;
  },
}));
vi.mock('../src/transport.ts', () => ({ requestPinned: vi.fn() }));

const connect = vi.mocked(requestPinned);
const input = 'https://ads.example/vast.xml';
const publicIPv4 = '1.1.1.1';
const publicIPv6 = '2606:4700:4700::1111';

function response(
  statusCode = 200,
  headers: IncomingHttpHeaders = { 'content-type': 'application/xml' },
  chunks = [Buffer.from('<VAST/>')],
) {
  return {
    statusCode,
    headers,
    destroy: vi.fn(),
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  dns.resolve4.mockResolvedValue([publicIPv4]);
  dns.resolve6.mockResolvedValue([publicIPv6]);
  connect.mockResolvedValue(response());
});

it.each([
  'http://ads.example/vast.xml',
  'file:///tmp/vast.xml',
  'https://ads.example:8443/vast.xml',
  'https://user:password@ads.example/vast.xml',
])('rejects URLs outside the HTTPS policy before DNS (%s)', async (url) => {
  await expect(safeFetch(url)).rejects.toMatchObject({ code: 'INVALID_URL' });
  expect(dns.resolve4).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

it.each([
  'localhost',
  'localhost.',
  'test.localhost',
  '127.0.0.1',
  '0.0.0.0',
  '10.0.0.1',
  '172.16.0.1',
  '192.168.0.1',
  '100.64.0.1',
  '169.254.0.1',
  '192.0.2.1',
  '224.0.0.1',
  '[::]',
  '[::1]',
  '[::ffff:192.168.0.1]',
  '[fc00::1]',
  '[fe80::1]',
  '[2001:db8::1]',
  '[2002::1]',
])(
  'blocks non-public IPs or local hostnames without connecting (%s)',
  async (host) => {
    await expect(safeFetch(`https://${host}/`)).rejects.toMatchObject({
      code: 'BLOCKED_IP',
    });
    expect(dns.resolve4).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  },
);

it('evaluates both DNS families and rejects an answer set containing a reserved address', async () => {
  dns.resolve6.mockResolvedValue([publicIPv6, 'fd00::1']);
  await expect(safeFetch(input)).rejects.toMatchObject({ code: 'BLOCKED_IP' });
  expect(dns.resolve4).toHaveBeenCalledWith('ads.example');
  expect(dns.resolve6).toHaveBeenCalledWith('ads.example');
  expect(connect).not.toHaveBeenCalled();
});

it('accepts an IPv6-only hostname when the A query has no records', async () => {
  dns.resolve4.mockRejectedValue(
    Object.assign(new Error(), { code: 'ENODATA' }),
  );
  await expect(safeFetch(input)).resolves.toEqual({
    status: 200,
    body: '<VAST/>',
    finalUrl: input,
  });
  expect(connect).toHaveBeenCalledWith(
    new URL(input),
    { address: publicIPv6, family: 6 },
    expect.any(AbortSignal),
    2500,
  );
});

it('fails closed when one DNS query fails for a reason other than absent records', async () => {
  dns.resolve6.mockRejectedValue(
    Object.assign(new Error(), { code: 'ESERVFAIL' }),
  );
  await expect(safeFetch(input)).rejects.toMatchObject({ code: 'DNS_FAILED' });
  expect(connect).not.toHaveBeenCalled();
});

it('validates the redirect target and never starts its connection if DNS is blocked', async () => {
  const redirect = response(302, {
    location: 'https://other.example/vast.xml',
  });
  connect.mockResolvedValueOnce(redirect);
  dns.resolve4
    .mockResolvedValueOnce([publicIPv4])
    .mockResolvedValueOnce(['10.0.0.1']);
  await expect(safeFetch(input)).rejects.toMatchObject({ code: 'BLOCKED_IP' });
  expect(dns.resolve4).toHaveBeenLastCalledWith('other.example');
  expect(connect).toHaveBeenCalledTimes(1);
  expect(redirect.destroy).toHaveBeenCalledOnce();
});

it('revalidates each redirect and returns its final URL as the wrapper base', async () => {
  connect.mockResolvedValueOnce(
    response(307, { location: 'next/final.xml#ignored' }),
  );
  await expect(safeFetch(input)).resolves.toMatchObject({
    finalUrl: 'https://ads.example/next/final.xml',
  });
  expect(dns.resolve4).toHaveBeenCalledTimes(2);
  expect(connect.mock.calls.map(([url]) => url.pathname)).toEqual([
    '/vast.xml',
    '/next/final.xml',
  ]);
});

it('limits redirects even when the destination stays the same', async () => {
  connect.mockImplementation(async () =>
    response(302, { location: '/vast.xml' }),
  );
  await expect(safeFetch(input, { maxRedirects: 1 })).rejects.toMatchObject({
    code: 'TOO_MANY_REDIRECTS',
  });
  expect(connect).toHaveBeenCalledTimes(2);
});

it('rejects redirects missing a location', async () => {
  connect.mockResolvedValueOnce(response(302, {}));
  await expect(safeFetch(input)).rejects.toMatchObject({
    code: 'INVALID_REDIRECT',
  });
});

it.each([
  ['application/json', 'identity', 'UNSUPPORTED_CONTENT_TYPE'],
  ['application/xml', 'gzip', 'UNSUPPORTED_ENCODING'],
])(
  'rejects unsupported content metadata (%s, %s)',
  async (type, encoding, code) => {
    connect.mockResolvedValueOnce(
      response(200, { 'content-type': type, 'content-encoding': encoding }),
    );
    await expect(safeFetch(input)).rejects.toMatchObject({ code });
  },
);

it('rejects over-limit Content-Length and streaming bodies and destroys the response', async () => {
  const declared = response(200, {
    'content-type': 'application/xml',
    'content-length': '12',
  });
  const streamed = response(200, { 'content-type': 'text/plain' }, [
    Buffer.alloc(4),
    Buffer.alloc(5),
  ]);
  connect.mockResolvedValueOnce(declared).mockResolvedValueOnce(streamed);
  await expect(safeFetch(input, { maxBytes: 8 })).rejects.toMatchObject({
    code: 'TOO_LARGE',
  });
  await expect(safeFetch(input, { maxBytes: 8 })).rejects.toMatchObject({
    code: 'TOO_LARGE',
  });
  expect(declared.destroy).toHaveBeenCalledOnce();
  expect(streamed.destroy).toHaveBeenCalledOnce();
});

it('preserves status for no-content responses and upstream errors', async () => {
  connect
    .mockResolvedValueOnce(response(204, {}))
    .mockResolvedValueOnce(response(403, {}));
  await expect(safeFetch(input)).resolves.toMatchObject({
    status: 204,
    body: '',
  });
  await expect(safeFetch(input)).resolves.toMatchObject({
    status: 403,
    body: '',
  });
});

it('normalizes transport errors without exposing their details', async () => {
  connect.mockRejectedValueOnce(new Error('Internal socket details'));
  await expect(safeFetch(input)).rejects.toMatchObject({
    code: 'REQUEST_FAILED',
    message: 'REQUEST_FAILED',
  });
});

it('applies the total deadline to a stalled response body', async () => {
  const destroy = vi.fn();
  connect.mockImplementationOnce(async (_url, _address, signal) => ({
    statusCode: 200,
    headers: { 'content-type': 'application/xml' },
    destroy,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('<VAST');
      await new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    },
  }));
  await expect(safeFetch(input, { timeoutMs: 40 })).rejects.toMatchObject({
    code: 'TIMEOUT',
  });
  expect(destroy).toHaveBeenCalledOnce();
});
