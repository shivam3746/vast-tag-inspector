import {
  explainFindings,
  explanationKey,
  prepareEvidence,
  promptVersion,
} from './explainer.ts';
import type { LlmClient } from './explainer.ts';
import type {
  ExplanationRecord,
  InspectionRepository,
} from './inspection-repository.ts';

export const explanationErrors = {
  NOT_FOUND: { status: 404, message: 'Inspection not found.' },
  NOT_READY: { status: 409, message: 'Wait for the inspection to finish.' },
  NO_FINDINGS: {
    status: 422,
    message: 'This inspection has no findings to explain.',
  },
  EXPLAIN_BUSY: {
    status: 503,
    message: 'The explainer is busy. Try again shortly.',
  },
  PROVIDER_UNAVAILABLE: {
    status: 503,
    message: 'The explanation provider is unavailable.',
  },
  INVALID_EXPLANATION: {
    status: 502,
    message: 'The provider returned an invalid explanation. Try again.',
  },
} as const;

type SharedResult =
  | { record: ExplanationRecord; cached: boolean; savedFor?: string }
  | { code: keyof typeof explanationErrors };

export function createExplanationService(client: LlmClient) {
  const pending = new Map<string, Promise<SharedResult>>();

  return async (
    repository: InspectionRepository,
    teamId: string,
    id: string,
  ) => {
    const inspection = await repository.getExplanationEvidence(id);
    if (!inspection) return { code: 'NOT_FOUND' } as const;
    if (inspection.status === 'queued' || inspection.status === 'running')
      return { code: 'NOT_READY' } as const;
    const evidence = prepareEvidence(inspection.findings);
    if (!evidence.length) return { code: 'NO_FINDINGS' } as const;
    const cacheKey = explanationKey(client.model, evidence);
    const key = `${teamId}:${cacheKey}`;
    let work = pending.get(key);

    if (!work) {
      if (pending.size >= 4) return { code: 'EXPLAIN_BUSY' } as const;
      work = (async (): Promise<SharedResult> => {
        const found = await repository.getCachedExplanation(cacheKey);
        if (found) return { record: found, cached: true };
        const result = await explainFindings(client, evidence);
        if (!result.ok) return { code: result.code };
        const record = {
          cacheKey,
          model: client.model,
          promptVersion,
          output: result.output,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
          latencyMs: result.latencyMs,
          createdAt: new Date(),
        };
        const saved = await repository.saveExplanation(id, record);
        return { record, cached: false, ...(saved ? { savedFor: id } : {}) };
      })();
      pending.set(key, work);
      const remove = () => pending.delete(key);
      void work.then(remove, remove);
    }

    const result = await work;
    if ('code' in result) return result;
    if (
      result.savedFor !== id &&
      !(await repository.saveExplanation(id, result.record))
    ) {
      return { code: 'NOT_FOUND' } as const;
    }
    const {
      output,
      model,
      promptVersion: version,
      createdAt,
      latencyMs,
      inputTokens,
      outputTokens,
      costUsd,
    } = result.record;
    return {
      explanation: {
        output,
        model,
        promptVersion: version,
        createdAt,
        latencyMs,
        inputTokens,
        outputTokens,
        costUsd,
      },
      cached: result.cached,
    };
  };
}

export type ExplainInspection = ReturnType<typeof createExplanationService>;

export function withExplanationFallback(
  primary: ExplainInspection,
  fallback: ExplainInspection,
): ExplainInspection {
  return async (...args) => {
    const result = await primary(...args);
    return 'code' in result &&
      (result.code === 'PROVIDER_UNAVAILABLE' ||
        result.code === 'INVALID_EXPLANATION')
      ? fallback(...args)
      : result;
  };
}
