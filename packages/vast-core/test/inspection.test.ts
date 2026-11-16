import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  evaluateRules,
  MAX_XML_BYTES,
  parseVast,
  resolveVast,
} from '../src/index.ts';

function fixture(name: string) {
  return readFileSync(
    new URL(`./fixtures/${name}.xml`, import.meta.url),
    'utf8',
  );
}

function wrapped(target: string) {
  return `<VAST version="4.3"><Ad><Wrapper><VASTAdTagURI>${target}</VASTAdTagURI></Wrapper></Ad></VAST>`;
}

describe('parseVast', () => {
  it('normalizes impression entities, media CDATA, duration, and skippability', () => {
    const parsed = parseVast(fixture('inline-clean'));
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        version: '4.3',
        ads: [
          {
            kind: 'inline',
            impressions: ['https://metrics.example/impression?a=1&b=2'],
            creatives: [
              {
                durationSeconds: 30.25,
                skipOffset: '25%',
                mediaFiles: [
                  {
                    url: 'https://media.example/creative?x=1&y=2',
                    mimeType: 'video/mp4',
                    codec: 'avc1.640028',
                    bitrateKbps: 2400,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  });

  it('reads multiple ads in order', () => {
    const parsed = parseVast(fixture('inline-pod'));
    expect(parsed.ok && parsed.value.ads.map((ad) => ad.id)).toEqual([
      'inline-1',
      'inline-2',
    ]);
  });

  it('reads a namespace-prefixed wrapper', () => {
    const xml =
      '<v:VAST xmlns:v="urn:example" version="4.3"><v:Ad><v:Wrapper><v:VASTAdTagURI>https://fixture.example/inline</v:VASTAdTagURI></v:Wrapper></v:Ad></v:VAST>';
    expect(parseVast(xml)).toMatchObject({
      ok: true,
      value: {
        ads: [{ kind: 'wrapper', adTagUri: 'https://fixture.example/inline' }],
      },
    });
  });

  it.each([
    ['<VAST><Ad></VAST>', 'INVALID_XML'],
    ['<VAST/><VAST/>', 'INVALID_XML'],
    ['<VAST><Ad/></VAST>', 'INVALID_XML'],
    ['<VAST><Ad><InLine/><Wrapper/></Ad></VAST>', 'INVALID_XML'],
    ['<html/>', 'NOT_VAST'],
    ['<!DOCTYPE VAST><VAST/>', 'XML_DECLARATION_BLOCKED'],
    [
      `<VAST>${'<child>'.repeat(64)}${'</child>'.repeat(64)}</VAST>`,
      'INVALID_XML',
    ],
    [`<VAST>${'é'.repeat(MAX_XML_BYTES / 2)}</VAST>`, 'XML_TOO_LARGE'],
  ])('rejects invalid or out-of-bounds input (%#)', (xml, code) => {
    expect(parseVast(xml)).toEqual({ ok: false, code });
  });
});

describe('evaluateRules', () => {
  it.each([
    ['inline-clean', []],
    ['inline-no-impression', ['IMP-MISSING']],
    ['inline-no-quartiles', ['TRK-MISSING']],
    ['inline-webm', ['MEDIA-MIME']],
    ['inline-invalid-duration', ['DUR-MISMATCH']],
    ['inline-unknown-version', ['VAST-VERSION']],
    ['inline-no-version', ['VAST-VERSION']],
    ['inline-pod', []],
    ['no-ad', ['CHAIN-EMPTY']],
  ])('reports the expected rules for %s', async (name, rules) => {
    const chain = await resolveVast({ type: 'xml', value: fixture(name) });
    expect(evaluateRules(chain).map((finding) => finding.ruleId)).toEqual(
      rules,
    );
  });

  it('honors hop and cumulative latency thresholds independently', () => {
    const findings = evaluateRules(
      {
        hops: [
          { status: 200, latencyMs: 400, document: null },
          { status: 200, latencyMs: 200, document: null },
        ],
        outcome: { kind: 'inline' },
      },
      { maxHopLatencyMs: 300, maxChainLatencyMs: 500 },
    );
    expect(findings.map(({ ruleId, hopIndex }) => [ruleId, hopIndex])).toEqual([
      ['CHAIN-LATENCY', null],
      ['CHAIN-LATENCY', 0],
    ]);
  });
});

describe('resolveVast', () => {
  it('follows a wrapper with an injected transport backed by a local fixture server', async () => {
    const server = createServer((_request, response) =>
      response.end(fixture('inline-clean')),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Test server did not bind.');
      const fetchDocument = vi.fn(async (url: URL) => {
        expect(url.href).toBe('https://fixture.example/inline');
        const response = await fetch(`http://127.0.0.1:${address.port}/inline`);
        return { status: response.status, body: await response.text() };
      });
      const chain = await resolveVast(
        { type: 'xml', value: fixture('wrapper-inline') },
        { fetchDocument },
      );
      expect(chain.outcome.kind).toBe('inline');
      expect(chain.hops.map((hop) => hop.status)).toEqual([null, 200]);
      expect(evaluateRules(chain)).toEqual([]);
      expect(fetchDocument).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('resolves a relative target and catches a URL cycle before another fetch', async () => {
    const fetchDocument = vi.fn(async () => ({
      status: 200,
      body: wrapped('/start#fragment'),
    }));
    const chain = await resolveVast(
      { type: 'url', value: 'https://fixture.example/start' },
      { fetchDocument },
    );
    expect(chain.outcome).toMatchObject({
      kind: 'error',
      code: 'WRAPPER_CYCLE',
    });
    expect(fetchDocument).toHaveBeenCalledTimes(1);
  });

  it('stops further fetches at the configured wrapper depth', async () => {
    const fetchDocument = vi.fn(async () => ({
      status: 200,
      body: wrapped('/third'),
    }));
    const chain = await resolveVast(
      { type: 'xml', value: fixture('wrapper-inline') },
      { maxWrapperDepth: 1, fetchDocument },
    );
    expect(chain.outcome).toMatchObject({
      kind: 'error',
      code: 'WRAPPER_LIMIT',
    });
    expect(evaluateRules(chain)[0]?.ruleId).toBe('CHAIN-DEPTH');
    expect(fetchDocument).toHaveBeenCalledTimes(1);
  });

  it('observes followAdditionalWrappers when the next response is another wrapper', async () => {
    const fetchDocument = vi.fn(async () => ({
      status: 200,
      body: wrapped('/third'),
    }));
    const chain = await resolveVast(
      { type: 'xml', value: fixture('wrapper-disallows-chain') },
      { fetchDocument },
    );
    expect(chain.outcome).toMatchObject({
      kind: 'error',
      code: 'WRAPPER_DISALLOWED',
    });
    expect(fetchDocument).toHaveBeenCalledTimes(1);
  });

  it('allows an inline ad after a wrapper that disallows additional wrappers', async () => {
    const chain = await resolveVast(
      { type: 'xml', value: fixture('wrapper-disallows-chain') },
      {
        fetchDocument: async () => ({
          status: 200,
          body: fixture('inline-clean'),
        }),
      },
    );
    expect(chain.outcome.kind).toBe('inline');
  });

  it.each(['', fixture('no-ad')])(
    'reports an empty terminal wrapper response (%#)',
    async (body) => {
      const chain = await resolveVast(
        { type: 'xml', value: fixture('wrapper-inline') },
        { fetchDocument: async () => ({ status: 200, body }) },
      );
      expect(chain.outcome.kind).toBe('empty');
      expect(evaluateRules(chain).map((finding) => finding.ruleId)).toEqual([
        'CHAIN-EMPTY',
      ]);
    },
  );

  it('requires a transport and a wrapper URI before fetching', async () => {
    const unavailable = await resolveVast({
      type: 'xml',
      value: fixture('wrapper-inline'),
    });
    const missingUri = await resolveVast({
      type: 'xml',
      value: fixture('wrapper-missing-uri'),
    });
    expect(unavailable.outcome).toMatchObject({ code: 'FETCH_UNAVAILABLE' });
    expect(missingUri.outcome).toMatchObject({ code: 'WRAPPER_URI_MISSING' });
  });

  it('preserves HTTP errors and records transport failures', async () => {
    const source = {
      type: 'url',
      value: 'https://fixture.example/inline',
    } as const;
    const httpError = await resolveVast(source, {
      fetchDocument: async () => ({ status: 404, body: 'Not found' }),
    });
    const fetchError = await resolveVast(source, {
      fetchDocument: async () => {
        throw new Error('Unavailable');
      },
    });
    expect(httpError.outcome).toMatchObject({ code: 'HTTP_ERROR' });
    expect(httpError.hops[0]?.status).toBe(404);
    expect(fetchError.outcome).toMatchObject({ code: 'FETCH_FAILED' });
  });
});
