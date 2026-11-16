import { MAX_XML_BYTES, parseVast } from './parser.ts';
import type { ParsedVast, ParseErrorCode } from './parser.ts';

export type InspectionSource = { type: 'xml' | 'url'; value: string };
export type FetchDocument = (
  url: URL,
) => Promise<
  | { status: number; body: string; finalUrl?: string }
  | { errorCode: `FETCH_${string}` }
>;
type ErrorCode =
  | ParseErrorCode
  | `FETCH_${string}`
  | 'HTTP_ERROR'
  | 'INVALID_URL'
  | 'WRAPPER_URI_MISSING'
  | 'WRAPPER_CYCLE'
  | 'WRAPPER_LIMIT'
  | 'WRAPPER_DISALLOWED';

export interface Hop {
  status: number | null;
  latencyMs: number;
  document: ParsedVast | null;
  xmlPreview?: string;
  urlOrigin?: string;
}

export interface Chain {
  hops: Hop[];
  outcome:
    | { kind: 'inline' | 'empty' }
    | { kind: 'error'; code: ErrorCode; hopIndex: number | null };
}

interface ResolverOptions {
  fetchDocument?: FetchDocument;
  maxWrapperDepth?: number;
  captureXmlPreview?: boolean;
}

function resolveUrl(value: string, base?: URL): URL | undefined {
  const url = URL.parse(value, base);
  if (!url || url.protocol !== 'https:' || url.username || url.password) return;
  url.hash = '';
  return url;
}

export async function resolveVast(
  source: InspectionSource,
  options: ResolverOptions = {},
): Promise<Chain> {
  const maxWrapperDepth = options.maxWrapperDepth ?? 5;
  if (!Number.isSafeInteger(maxWrapperDepth) || maxWrapperDepth < 0) {
    throw new RangeError('maxWrapperDepth must be a nonnegative integer.');
  }

  const hops: Hop[] = [];
  const visited = new Set<string>();
  const fail = (code: ErrorCode): Chain => ({
    hops,
    outcome: {
      kind: 'error',
      code,
      hopIndex: hops.length ? hops.length - 1 : null,
    },
  });

  let xml = source.value;
  let url = source.type === 'url' ? resolveUrl(source.value) : undefined;
  let wrapperCount = 0;
  let wrapperAllowed = true;
  if (source.type === 'url' && !url) return fail('INVALID_URL');

  while (true) {
    const hop: Hop = { status: null, latencyMs: 0, document: null };
    if (url) {
      if (visited.has(url.href)) return fail('WRAPPER_CYCLE');
      if (!options.fetchDocument) return fail('FETCH_UNAVAILABLE');
      visited.add(url.href);
      hop.urlOrigin = url.origin;
      const start = performance.now();
      hops.push(hop);
      try {
        const result = await options.fetchDocument(new URL(url));
        if ('errorCode' in result) return fail(result.errorCode);
        hop.status = result.status;
        xml = result.body;
        if (result.finalUrl) {
          const finalUrl = resolveUrl(result.finalUrl);
          if (!finalUrl) return fail('INVALID_URL');
          if (finalUrl.href !== url.href && visited.has(finalUrl.href))
            return fail('WRAPPER_CYCLE');
          visited.add(finalUrl.href);
          url = finalUrl;
          hop.urlOrigin = finalUrl.origin;
        }
      } catch {
        return fail('FETCH_FAILED');
      } finally {
        hop.latencyMs = performance.now() - start;
      }
      if (hop.status < 200 || hop.status >= 300) return fail('HTTP_ERROR');
    } else {
      hops.push(hop);
    }

    if (!xml.trim() && Buffer.byteLength(xml, 'utf8') <= MAX_XML_BYTES) {
      return { hops, outcome: { kind: 'empty' } };
    }
    const parsed = parseVast(xml, options.captureXmlPreview);
    if (!parsed.ok) return fail(parsed.code);
    hop.document = parsed.value;
    if (parsed.xmlPreview) hop.xmlPreview = parsed.xmlPreview;
    const firstAd = parsed.value.ads[0];
    if (!firstAd) return { hops, outcome: { kind: 'empty' } };
    if (firstAd.kind === 'inline') return { hops, outcome: { kind: 'inline' } };

    if (!wrapperAllowed) return fail('WRAPPER_DISALLOWED');
    if (++wrapperCount > maxWrapperDepth) return fail('WRAPPER_LIMIT');
    if (!firstAd.adTagUri) return fail('WRAPPER_URI_MISSING');
    wrapperAllowed = firstAd.followAdditionalWrappers;
    url = resolveUrl(firstAd.adTagUri, url);
    if (!url) return fail('INVALID_URL');
  }
}
