import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StoredExplanation } from './api.ts';
import { readError } from './api.ts';

const owners = {
  publisher: 'Publisher',
  ssp: 'SSP',
  demand_partner: 'Demand partner',
  unknown: 'Owner unknown',
};

export function ExplanationPanel({
  stored,
  generate,
  preferredModel,
  promptVersion,
}: {
  stored: StoredExplanation | null | undefined;
  preferredModel: string | null;
  promptVersion: string | null;
  generate:
    | ((signal: AbortSignal) => Promise<{ explanation: StoredExplanation }>)
    | undefined;
}) {
  const [result, setResult] = useState<StoredExplanation>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function explain() {
    if (!generate || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const { explanation } = await generate(controller.signal);
      if (!controller.signal.aborted) setResult(explanation);
    } catch (failure) {
      if (!controller.signal.aborted) setError(readError(failure));
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const explanation = result ?? stored;
  const canGenerate =
    generate &&
    (!explanation ||
      (preferredModel && explanation.model !== preferredModel) ||
      (promptVersion && explanation.promptVersion !== promptVersion));
  if (!explanation && !generate) return null;
  return (
    <section
      className="explanation-panel"
      aria-labelledby="explanation-heading"
      aria-busy={busy}
    >
      <div className="explanation-heading">
        <h3 id="explanation-heading">
          <Sparkles size={16} aria-hidden="true" /> Finding explanation
        </h3>
        {explanation && (
          <span className="explanation-confidence">
            {explanation.model === 'built-in-rules'
              ? 'Rule guidance'
              : `Model generated · ${explanation.output.confidence} confidence`}
          </span>
        )}
      </div>
      {explanation && (
        <>
          <p>{explanation.output.summary}</p>
          <p>
            <strong>Probable cause</strong>{' '}
            {explanation.output.probable_root_cause}
          </p>
          <h4 id="suggested-fixes-heading">Suggested fixes</h4>
          <ul aria-labelledby="suggested-fixes-heading">
            {explanation.output.fixes.map((fix) => (
              <li key={fix.finding_rule_id}>
                <span>
                  <code>{fix.finding_rule_id}</code> · {owners[fix.owner]}
                </span>
                <p>{fix.action}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      {canGenerate && (
        <>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void explain()}
          >
            {busy
              ? 'Explaining…'
              : explanation
                ? 'Regenerate explanation'
                : 'Explain findings'}
          </button>
          {busy && (
            <span className="sr-only" role="status">
              Generating explanation.
            </span>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
