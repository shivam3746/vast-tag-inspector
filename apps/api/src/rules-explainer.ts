import type { Explanation, LlmClient } from './explainer.ts';

type Guidance = Pick<Explanation['fixes'][number], 'action' | 'owner'> & {
  cause: string;
};

const guidance: Record<string, Guidance> = {
  'CHAIN-DEPTH': {
    cause: 'Too many wrapper responses precede the final ad.',
    action:
      'Review which wrappers add tracking or verification and shorten the chain where possible.',
    owner: 'ssp',
  },
  'CHAIN-EMPTY': {
    cause: 'The final response may be a no-fill result.',
    action:
      'Check the final response and confirm the placement has eligible demand for the request.',
    owner: 'unknown',
  },
  'CHAIN-LATENCY': {
    cause:
      'Time spent waiting for upstream servers may be delaying the ad response.',
    action:
      'Compare each hop in the waterfall and ask the owner of the slowest endpoint to check its response time.',
    owner: 'unknown',
  },
  'DUR-MISMATCH': {
    cause:
      'The creative metadata may omit the video length or encode it incorrectly.',
    action:
      'Set the Linear Duration to the actual video length using the VAST time format.',
    owner: 'demand_partner',
  },
  'IMP-MISSING': {
    cause:
      'The ad template may have omitted its impression tracker or produced an empty URL.',
    action:
      'Add an Impression element with the intended reporting URL to the affected ad response.',
    owner: 'demand_partner',
  },
  'MEDIA-MIME': {
    cause:
      'The tag may offer video in a format outside the inspector’s CTV compatibility rules.',
    action:
      'Offer a compatible H.264 MP4 MediaFile for CTV players and declare its media type and codec.',
    owner: 'demand_partner',
  },
  'TRK-MISSING': {
    cause:
      'The creative configuration may be missing one or more playback event trackers.',
    action:
      'Under Linear > TrackingEvents, add a Tracking element with the reporting URL for each event listed in the finding. Re-run the inspection and confirm TRK-MISSING clears.',
    owner: 'demand_partner',
  },
  'VAST-VERSION': {
    cause:
      'The tag template may declare an unsupported VAST version or omit it entirely.',
    action:
      'Declare a supported version on the VAST element and check the tag against the matching schema.',
    owner: 'unknown',
  },
};

const fallback: Guidance = {
  cause: 'Review the inspection findings for the affected VAST fields.',
  action: 'Review the affected part of the VAST response.',
  owner: 'unknown',
};
const forRule = (ruleId: string) =>
  Object.hasOwn(guidance, ruleId) ? (guidance[ruleId] ?? fallback) : fallback;

export const rulesExplanationClient: LlmClient = {
  model: 'built-in-rules',
  async complete({ evidence }) {
    const primary =
      evidence.find((entry) => entry.counts.error > 0) ?? evidence[0];
    const output: Explanation = {
      summary:
        evidence.length === 1
          ? (primary?.description ?? 'The inspection has a finding to review.')
          : `The inspection reported ${evidence.length} different VAST issues.`,
      probable_root_cause: forRule(primary?.ruleId ?? '').cause,
      confidence: 'medium',
      fixes: evidence.map(({ ruleId }) => {
        const { action, owner } = forRule(ruleId);
        return { finding_rule_id: ruleId, action, owner };
      }),
    };
    return {
      text: JSON.stringify(output),
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  },
};
