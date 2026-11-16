import { Resolver } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { SafeFetchError } from './errors.ts';

export interface Address {
  address: string;
  family: 4 | 6;
}

const blockedIPv4 = new BlockList();
const reservedIPv4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const;
for (const [network, prefix] of reservedIPv4)
  blockedIPv4.addSubnet(network, prefix);

const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');

const blockedIPv6 = new BlockList();
const reservedIPv6 = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const;
for (const [network, prefix] of reservedIPv6)
  blockedIPv6.addSubnet(network, prefix, 'ipv6');

function isPublicAddress(address: string, family: number): boolean {
  if (isIP(address) !== family || address.includes('%')) return false;
  if (family === 4) return !blockedIPv4.check(address);
  return (
    family === 6 &&
    globalIPv6.check(address, 'ipv6') &&
    !blockedIPv6.check(address, 'ipv6')
  );
}

async function emptyIfNoRecords(query: Promise<string[]>): Promise<string[]> {
  try {
    return await query;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENODATA' || error.code === 'ENOTFOUND')
    )
      return [];
    throw error;
  }
}

export async function resolveAddress(
  hostname: string,
  signal: AbortSignal,
): Promise<Address> {
  signal.throwIfAborted();
  const host = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  const family = isIP(host);
  if (family === 4 || family === 6) {
    if (!isPublicAddress(host, family)) throw new SafeFetchError('BLOCKED_IP');
    return { address: host, family };
  }

  const name = host.replace(/\.$/, '');
  if (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    !name.includes('.')
  ) {
    throw new SafeFetchError('BLOCKED_IP');
  }

  const resolver = new Resolver();
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const [ipv4, ipv6] = await Promise.all([
      emptyIfNoRecords(resolver.resolve4(host)),
      emptyIfNoRecords(resolver.resolve6(host)),
    ]);
    signal.throwIfAborted();
    const addresses: Address[] = [
      ...ipv4.map((address) => ({ address, family: 4 as const })),
      ...ipv6.map((address) => ({ address, family: 6 as const })),
    ];
    const selected = addresses[0];
    if (!selected) throw new SafeFetchError('DNS_FAILED');
    if (
      addresses.some(({ address, family }) => !isPublicAddress(address, family))
    ) {
      throw new SafeFetchError('BLOCKED_IP');
    }
    return selected;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof SafeFetchError) throw error;
    throw new SafeFetchError('DNS_FAILED');
  } finally {
    signal.removeEventListener('abort', cancel);
    resolver.cancel();
  }
}
