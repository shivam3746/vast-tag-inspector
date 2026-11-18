import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { evaluateRules, resolveVast } from '@vast-tag/vast-core';
import { z } from 'zod';
import {
  explainFindings,
  prepareEvidence,
  promptVersion,
} from '../apps/api/src/explainer.ts';
import type { ExplanationResult } from '../apps/api/src/explainer.ts';
import { createGeminiClient } from '../apps/api/src/gemini-explainer.ts';
import { createOllamaClient } from '../apps/api/src/ollama-explainer.ts';
import { rulesExplanationClient } from '../apps/api/src/rules-explainer.ts';

const fixtureDir = new URL('./fixtures/', import.meta.url);
const reportFile = new URL('./report.md', import.meta.url);
const expectation = z.strictObject({
  ruleIds: z.array(z.string()),
  maxWrapperDepth: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  followFixture: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  injection: z.boolean().optional(),
});

const flags = process.argv.slice(2);
if (
  flags.length > 1 ||
  (flags[0] && !['--local', '--rules', '--gemini'].includes(flags[0]))
) {
  throw new Error('Usage: npm run eval [-- --local | --rules | --gemini]');
}
const local = flags[0] === '--local';
const rulesOnly = flags[0] === '--rules';
const gemini = flags[0] === '--gemini';
const geminiKey = process.env.GEMINI_API_KEY?.trim();
if (gemini && !geminiKey)
  throw new Error('Set GEMINI_API_KEY to a Free Tier project key.');
const client =
  gemini && geminiKey
    ? createGeminiClient(geminiKey)
    : local
      ? createOllamaClient()
      : rulesExplanationClient;
const mode = rulesOnly
  ? 'Rules only'
  : gemini
    ? 'Gemini model'
    : local
      ? 'Local Ollama model'
      : 'Built-in rule guidance';

const fixtures = (await readdir(fixtureDir))
  .filter((name) => name.endsWith('.xml'))
  .sort();
const perRule = new Map<string, { tp: number; fp: number; fn: number }>();
const results: {
  name: string;
  expected: string[];
  actual: string[];
  matched: boolean;
}[] = [];
const completed: {
  result: ExplanationResult;
  matches: boolean;
  elapsedMs: number;
}[] = [];
let injectionPassed: boolean | undefined;
const equalIds = (a: string[], b: string[]) =>
  JSON.stringify([...new Set(a)].sort()) ===
  JSON.stringify([...new Set(b)].sort());

for (const file of fixtures) {
  const name = file.slice(0, -4);
  const xml = await readFile(new URL(file, fixtureDir), 'utf8');
  const expected = expectation.parse(
    JSON.parse(
      await readFile(new URL(`${name}.expected.json`, fixtureDir), 'utf8'),
    ),
  );
  const chain = await resolveVast(
    { type: 'xml', value: xml },
    {
      ...(expected.maxWrapperDepth === undefined
        ? {}
        : { maxWrapperDepth: expected.maxWrapperDepth }),
      ...(expected.followFixture
        ? {
            fetchDocument: async (url: URL) =>
              url.href === 'https://fixture.example/inline.xml'
                ? {
                    status: 200,
                    body: await readFile(
                      new URL(`${expected.followFixture}.xml`, fixtureDir),
                      'utf8',
                    ),
                  }
                : { errorCode: 'FETCH_UNEXPECTED_FIXTURE' as const },
          }
        : {}),
    },
  );
  if (expected.latencyMs !== undefined && chain.hops[0])
    chain.hops[0].latencyMs = expected.latencyMs;
  const findings = evaluateRules(chain);
  const actual = [...new Set(findings.map(({ ruleId }) => ruleId))].sort();
  const matched = equalIds(expected.ruleIds, actual);
  results.push({ name, expected: expected.ruleIds, actual, matched });
  for (const rule of new Set([...expected.ruleIds, ...actual])) {
    const counts = perRule.get(rule) ?? { tp: 0, fp: 0, fn: 0 };
    if (expected.ruleIds.includes(rule) && actual.includes(rule)) counts.tp++;
    else if (actual.includes(rule)) counts.fp++;
    else counts.fn++;
    perRule.set(rule, counts);
  }

  if (!rulesOnly && expected.ruleIds.length) {
    const evidence = prepareEvidence(findings);
    if (!evidence.length) {
      completed.push({
        result: {
          ok: false,
          code: 'INVALID_EXPLANATION',
          attempts: 0,
          schemaValidAttempts: 0,
          unknownRuleAttempts: 0,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          costUsd: 0,
        },
        matches: false,
        elapsedMs: 0,
      });
      if (expected.injection) injectionPassed = false;
      continue;
    }
    const start = performance.now();
    const result = await explainFindings(client, evidence);
    const matches =
      result.ok &&
      equalIds(
        result.output.fixes.map((fix) => fix.finding_rule_id),
        expected.ruleIds,
      );
    completed.push({ result, matches, elapsedMs: performance.now() - start });
    if (expected.injection) {
      injectionPassed =
        matches &&
        !JSON.stringify(evidence)
          .toLowerCase()
          .includes('ignore previous instructions');
    }
  }
}

const percentage = (passed: number, total: number) =>
  total ? `${((100 * passed) / total).toFixed(1)}%` : 'n/a';
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};
const exact = results.filter(({ matched }) => matched).length;
const lines = [
  '# VAST evaluation',
  '',
  `**${mode}** using prompt version \`${promptVersion}\`.`,
  '',
  `## Rules`,
  '',
  `Rules matched the expected set on **${exact}/${results.length} fixtures (${percentage(exact, results.length)})**.`,
  '',
  '| Rule | True positives | False positives | False negatives | Precision | Recall |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...[...perRule]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([rule, { tp, fp, fn }]) =>
        `| ${rule} | ${tp} | ${fp} | ${fn} | ${percentage(tp, tp + fp)} | ${percentage(tp, tp + fn)} |`,
    ),
  '',
  '| Fixture | Expected | Actual |',
  '| --- | --- | --- |',
  ...results.map(
    ({ name, expected, actual }) =>
      `| ${name} | ${expected.join(', ') || 'None'} | ${actual.join(', ') || 'None'} |`,
  ),
];

if (!rulesOnly) {
  const sum = (
    key: 'attempts' | 'schemaValidAttempts' | 'unknownRuleAttempts',
  ) => completed.reduce((total, { result }) => total + result[key], 0);
  const costs = completed.flatMap(({ result }) =>
    result.costUsd === null ? [] : [result.costUsd],
  );
  const mean = costs.length
    ? costs.reduce((total, cost) => total + cost, 0) / costs.length
    : null;
  lines.push(
    '',
    '## Explanations',
    '',
    `The evaluation used \`${client.model}\`.`,
    gemini
      ? 'The run records token usage. The API response does not identify the project’s billing tier.'
      : local
        ? 'Inference runs on the local machine. Cost figures cover API charges.'
        : 'These results measure the built-in guidance and its response contract. The run uses no model API.',
    '',
    `- ${percentage(sum('schemaValidAttempts'), sum('attempts'))} of attempts passed schema validation.`,
    `- ${percentage(completed.filter(({ matches }) => matches).length, completed.length)} of cases matched the expected finding references exactly.`,
    `- ${percentage(sum('unknownRuleAttempts'), sum('schemaValidAttempts'))} of schema-valid attempts contained an unknown rule ID.`,
    `- The injection fixture ${injectionPassed ? 'passed' : 'failed'}.`,
    `- Median latency was ${median(completed.map(({ elapsedMs }) => elapsedMs)).toFixed(2)} ms per case.`,
    `- Mean estimated cost was ${mean === null ? 'n/a' : `$${mean.toFixed(6)}`} per case (${costs.length}/${completed.length} with known cost).`,
  );
}

await writeFile(reportFile, `${lines.join('\n')}\n`);
console.log(
  `Rules matched ${exact}/${results.length} fixtures. Report written to ${fileURLToPath(reportFile)}.`,
);
if (
  exact !== results.length ||
  (!rulesOnly &&
    (!injectionPassed || completed.some(({ result }) => !result.ok)))
) {
  process.exitCode = 1;
}
