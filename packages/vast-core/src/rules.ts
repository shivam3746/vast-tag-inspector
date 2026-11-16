import type { Chain } from './resolver.ts';

export interface RuleConfig {
  supportedVersions: readonly string[];
  requiredTrackingEvents: readonly string[];
  maxHopLatencyMs: number;
  maxChainLatencyMs: number;
}

const defaults: RuleConfig = {
  supportedVersions: ['2.0', '3.0', '4.0', '4.1', '4.2', '4.3'],
  requiredTrackingEvents: [
    'start',
    'firstQuartile',
    'midpoint',
    'thirdQuartile',
    'complete',
  ],
  maxHopLatencyMs: 1000,
  maxChainLatencyMs: 3000,
};

export interface Finding {
  ruleId: string;
  severity: 'error' | 'warning';
  hopIndex: number | null;
  message: string;
}

export function evaluateRules(
  chain: Chain,
  config: Partial<RuleConfig> = {},
): Finding[] {
  const settings = { ...defaults, ...config };
  const findings: Finding[] = [];
  const add = (
    ruleId: string,
    severity: Finding['severity'],
    hopIndex: number | null,
    message: string,
  ) => findings.push({ ruleId, severity, hopIndex, message });

  if (
    chain.outcome.kind === 'error' &&
    chain.outcome.code === 'WRAPPER_LIMIT'
  ) {
    add(
      'CHAIN-DEPTH',
      'error',
      chain.outcome.hopIndex,
      'The wrapper chain exceeds the configured depth.',
    );
  }
  if (chain.outcome.kind === 'empty') {
    add(
      'CHAIN-EMPTY',
      'warning',
      chain.hops.length - 1,
      'The response chain ended without an ad.',
    );
  }
  const totalLatency = chain.hops.reduce(
    (total, hop) => total + hop.latencyMs,
    0,
  );
  if (totalLatency > settings.maxChainLatencyMs) {
    add(
      'CHAIN-LATENCY',
      'warning',
      null,
      'Total fetch latency exceeds the configured threshold.',
    );
  }

  const inheritedEvents = new Set<string>();
  chain.hops.forEach((hop, hopIndex) => {
    if (hop.latencyMs > settings.maxHopLatencyMs) {
      add(
        'CHAIN-LATENCY',
        'warning',
        hopIndex,
        'Fetch latency exceeds the configured hop threshold.',
      );
    }
    const document = hop.document;
    if (!document) return;
    if (
      !document.version ||
      !settings.supportedVersions.includes(document.version)
    ) {
      add(
        'VAST-VERSION',
        'warning',
        hopIndex,
        'VAST version is missing or unsupported.',
      );
    }
    document.ads.forEach((ad, adIndex) => {
      const label = `Ad ${adIndex + 1}`;
      if (!ad.impressions.length) {
        add(
          'IMP-MISSING',
          'error',
          hopIndex,
          `${label} has no impression URL.`,
        );
      }
      if (ad.kind === 'wrapper') return;
      ad.creatives.forEach((creative, creativeIndex) => {
        const name = `${label}, linear creative ${creativeIndex + 1}`;
        if (creative.durationSeconds === null) {
          add(
            'DUR-MISMATCH',
            'error',
            hopIndex,
            `${name} has a missing or invalid duration.`,
          );
        }
        const supportsTv = creative.mediaFiles.some(
          ({ url, mimeType, codec }) =>
            url &&
            mimeType?.toLowerCase() === 'video/mp4' &&
            (!codec || /^(?:h\.?264|avc1|avc3)(?:\.|$)/i.test(codec)),
        );
        if (!supportsTv) {
          add(
            'MEDIA-MIME',
            'warning',
            hopIndex,
            `${name} has no MP4 with a compatible or unspecified codec.`,
          );
        }
        const events = new Set(
          creative.trackers
            .filter((tracker) => tracker.url)
            .map((tracker) => tracker.event),
        );
        const missingEvents = settings.requiredTrackingEvents.filter(
          (event) =>
            !events.has(event) &&
            (adIndex !== 0 || !inheritedEvents.has(event)),
        );
        if (missingEvents.length) {
          add(
            'TRK-MISSING',
            'warning',
            hopIndex,
            `${name} is missing tracking events: ${missingEvents.join(', ')}.`,
          );
        }
      });
    });

    const firstAd = document.ads[0];
    if (firstAd?.kind === 'wrapper') {
      for (const tracker of firstAd.creatives.flatMap(
        (creative) => creative.trackers,
      )) {
        if (tracker.url) inheritedEvents.add(tracker.event);
      }
    }
  });
  return findings;
}
