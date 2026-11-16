import { createReadStream } from 'node:fs';
import { safeFetch, SafeFetchError } from '@vast-tag/safe-fetch';
import { evaluateRules, MAX_XML_BYTES, resolveVast } from '@vast-tag/vast-core';
import type { Chain, FetchDocument } from '@vast-tag/vast-core';

const fetchDocument: FetchDocument = async (url) => {
  try {
    return await safeFetch(url, { maxBytes: MAX_XML_BYTES });
  } catch (error) {
    if (error instanceof SafeFetchError)
      return { errorCode: `FETCH_${error.code}` };
    throw error;
  }
};

function report(chain: Chain) {
  const findings = evaluateRules(chain);
  console.log(JSON.stringify({ outcome: chain.outcome, findings }, null, 2));
  return chain.outcome.kind === 'error' ||
    findings.some((finding) => finding.severity === 'error')
    ? 1
    : 0;
}

async function inspectFile(path: string) {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(path, { end: MAX_XML_BYTES })) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks);
  if (input.length > MAX_XML_BYTES) {
    console.error('XML_TOO_LARGE');
    return 1;
  }
  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    console.error('INVALID_UTF8');
    return 1;
  }

  return report(await resolveVast({ type: 'xml', value: xml }));
}

const [first, url, ...extra] = process.argv.slice(2);
if (first === '--url' && url && !extra.length) {
  process.exitCode = report(
    await resolveVast({ type: 'url', value: url }, { fetchDocument }),
  );
} else if (first && !first.startsWith('--') && !url && !extra.length) {
  try {
    process.exitCode = await inspectFile(first);
  } catch {
    console.error('Unable to read the XML file.');
    process.exitCode = 1;
  }
} else {
  console.error('Usage: npm run inspect -- <fixture.xml> | --url <https-url>');
  process.exitCode = 2;
}
