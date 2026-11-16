import { resolveAddress } from './addresses.ts';
import { SafeFetchError } from './errors.ts';
import { requestPinned } from './transport.ts';
import type { PinnedResponse } from './transport.ts';

export { SafeFetchError } from './errors.ts';
export type { SafeFetchErrorCode } from './errors.ts';

interface Options {
  timeoutMs?: number;
  connectTimeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

interface FetchedDocument {
  status: number;
  body: string;
  finalUrl: string;
}

const defaults = {
  timeoutMs: 8000,
  connectTimeoutMs: 2500,
  maxBytes: 1024 * 1024,
  maxRedirects: 5,
};
const redirects = new Set([301, 302, 303, 307, 308]);

function validateUrl(input: string, base?: URL): URL {
  const url = URL.parse(input, base);
  if (
    !url ||
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new SafeFetchError('INVALID_URL');
  }
  url.hash = '';
  return url;
}

async function readBody(
  response: PinnedResponse,
  maxBytes: number,
): Promise<string> {
  const length = response.headers['content-length'];
  if (length && Number(length) > maxBytes)
    throw new SafeFetchError('TOO_LARGE');

  const contentType = response.headers['content-type']
    ?.split(';')[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType !== 'application/xml' &&
    contentType !== 'text/xml' &&
    contentType !== 'text/plain' &&
    !/^application\/[\w.+-]+\+xml$/.test(contentType ?? '')
  ) {
    throw new SafeFetchError('UNSUPPORTED_CONTENT_TYPE');
  }
  const encoding = response.headers['content-encoding']?.trim().toLowerCase();
  if (encoding && encoding !== 'identity')
    throw new SafeFetchError('UNSUPPORTED_ENCODING');

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new SafeFetchError('TOO_LARGE');
    chunks.push(chunk);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks, bytes),
    );
  } catch {
    throw new SafeFetchError('INVALID_UTF8');
  }
}

export async function safeFetch(
  input: string | URL,
  options: Options = {},
): Promise<FetchedDocument> {
  const { timeoutMs, connectTimeoutMs, maxBytes, maxRedirects } = {
    ...defaults,
    ...options,
  };
  for (const limit of [timeoutMs, connectTimeoutMs, maxBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_147_483_647) {
      throw new RangeError(
        'Timeouts and maxBytes must be positive 32-bit integers.',
      );
    }
  }
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new RangeError('maxRedirects must be a nonnegative integer.');
  }

  let url = validateUrl(input.toString());
  const controller = new AbortController();
  const { signal } = controller;
  const timer = setTimeout(
    () => controller.abort(new SafeFetchError('TIMEOUT')),
    timeoutMs,
  );
  try {
    for (let redirectCount = 0; ; redirectCount++) {
      const address = await resolveAddress(url.hostname, signal);
      signal.throwIfAborted();
      const response = await requestPinned(
        url,
        address,
        signal,
        connectTimeoutMs,
      );
      try {
        signal.throwIfAborted();
        const status = response.statusCode ?? 0;
        if (redirects.has(status)) {
          if (redirectCount >= maxRedirects)
            throw new SafeFetchError('TOO_MANY_REDIRECTS');
          const location = response.headers.location?.trim();
          if (!location) throw new SafeFetchError('INVALID_REDIRECT');
          url = validateUrl(location, url);
          continue;
        }
        const body =
          status >= 200 && status < 300 && status !== 204 && status !== 205
            ? await readBody(response, maxBytes)
            : '';
        signal.throwIfAborted();
        return { status, body, finalUrl: url.href };
      } finally {
        response.destroy();
      }
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof SafeFetchError) throw error;
    throw new SafeFetchError('REQUEST_FAILED');
  } finally {
    clearTimeout(timer);
  }
}
