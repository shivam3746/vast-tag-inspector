import { createReadStream } from 'node:fs';
import { evaluateRules, MAX_XML_BYTES, resolveVast } from './index.ts';

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

  const chain = await resolveVast({ type: 'xml', value: xml });
  const findings = evaluateRules(chain);
  console.log(JSON.stringify({ outcome: chain.outcome, findings }, null, 2));
  return chain.outcome.kind === 'error' ||
    findings.some((finding) => finding.severity === 'error')
    ? 1
    : 0;
}

const [path, ...extra] = process.argv.slice(2);
if (!path || extra.length) {
  console.error('Usage: npm run inspect -- <fixture.xml>');
  process.exitCode = 2;
} else {
  try {
    process.exitCode = await inspectFile(path);
  } catch {
    console.error('Unable to read the XML file.');
    process.exitCode = 1;
  }
}
