import { request } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import type { LookupFunction } from 'node:net';
import type { Address } from './addresses.ts';
import { SafeFetchError } from './errors.ts';

export interface PinnedResponse extends AsyncIterable<Buffer> {
  statusCode?: number | undefined;
  headers: IncomingHttpHeaders;
  destroy(): void;
}

export function requestPinned(
  url: URL,
  address: Address,
  signal: AbortSignal,
  connectTimeoutMs: number,
): Promise<PinnedResponse> {
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
    } else {
      callback(null, address.address, address.family);
    }
  };

  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        agent: false,
        method: 'GET',
        lookup,
        family: address.family,
        rejectUnauthorized: true,
        signal,
        headers: {
          accept: 'application/xml, text/xml, text/plain',
          'accept-encoding': 'identity',
          'user-agent': 'CTV-VAST-Inspector/0.1',
        },
      },
      resolve,
    );
    const deadline = setTimeout(
      () => req.destroy(new SafeFetchError('TIMEOUT')),
      connectTimeoutMs,
    );
    const clearDeadline = () => clearTimeout(deadline);
    req.once('socket', (socket) => socket.once('secureConnect', clearDeadline));
    req.once('close', clearDeadline);
    req.once('error', reject);
    req.end();
  });
}
