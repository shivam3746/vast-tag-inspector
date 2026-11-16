import {
  Activity,
  ArrowDown,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CodeXml,
  History,
  Link2,
  LogOut,
  Play,
  Radio,
  Timer,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { inspectionApi, pageSize, pending, readError } from './api.ts';
import type { Role, Run, RunDetails, RunStatus, Source } from './api.ts';
import { Brand } from './login.tsx';

const sampleUrl =
  'https://raw.githubusercontent.com/InteractiveAdvertisingBureau/VAST_Samples/master/VAST%204.2%20Samples/Inline_Linear_Tag-test.xml';
const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const statusLabel: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Completed',
  failed: 'Failed',
};
const roleLabel: Record<Role, string> = {
  admin: 'Admin',
  ad_ops: 'Ad operations',
  viewer: 'Viewer',
};

function Status({ status }: { status: RunStatus }) {
  return (
    <span className={`status status-${status}`}>
      <i />
      {statusLabel[status]}
    </span>
  );
}

function InspectionForm({
  role,
  busy,
  error,
  submit,
}: {
  role: Role | undefined;
  busy: boolean;
  error: string;
  submit: (source: Source) => Promise<void>;
}) {
  const [kind, setKind] = useState<Source['type']>('url');
  const [url, setUrl] = useState('');
  const [xml, setXml] = useState('');
  const allowed = role === 'admin' || role === 'ad_ops';

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowed || busy) return;
    void submit({ type: kind, value: (kind === 'url' ? url : xml).trim() });
  }

  return (
    <section className="card" aria-labelledby="new-run-heading">
      <div className="card-heading">
        <div>
          <h2 id="new-run-heading">New inspection</h2>
          <p>Enter a tag URL or paste a VAST response.</p>
        </div>
        <span className="card-icon">
          <Radio size={19} aria-hidden="true" />
        </span>
      </div>
      {role === 'viewer' ? (
        <p className="notice">Your viewer role can read saved runs.</p>
      ) : (
        <form onSubmit={onSubmit} className="inspection-form">
          <div
            className="source-toggle flex"
            aria-label="Source type"
            role="group"
          >
            <button
              type="button"
              aria-pressed={kind === 'url'}
              onClick={() => setKind('url')}
            >
              <Link2 size={16} /> Tag URL
            </button>
            <button
              type="button"
              aria-pressed={kind === 'xml'}
              onClick={() => setKind('xml')}
            >
              <CodeXml size={16} /> Paste XML
            </button>
          </div>
          <label htmlFor="tag-source">
            {kind === 'url' ? 'VAST tag URL' : 'VAST XML'}
          </label>
          {kind === 'url' ? (
            <input
              id="tag-source"
              type="url"
              placeholder="https://ads.example.com/vast.xml"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={8192}
            />
          ) : (
            <textarea
              id="tag-source"
              rows={6}
              placeholder={'<VAST version="4.3">\n  …\n</VAST>'}
              required
              value={xml}
              onChange={(e) => setXml(e.target.value)}
              maxLength={1024 * 1024}
            />
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={!allowed || busy}
            >
              <Play size={15} aria-hidden="true" />{' '}
              {busy ? 'Submitting…' : 'Run inspection'}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setKind('url');
                setUrl(sampleUrl);
              }}
            >
              Use sample tag <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function RunHistory({
  items,
  loading,
  error,
  selected,
  select,
  offset,
  hasNext,
  changePage,
  retry,
}: {
  items: Run[];
  loading: boolean;
  error: string;
  selected: string | undefined;
  select: (id: string) => void;
  offset: number;
  hasNext: boolean;
  changePage: (value: number) => void;
  retry: () => void;
}) {
  return (
    <section
      id="run-history"
      className="card history-card"
      aria-labelledby="history-heading"
      aria-busy={loading}
      tabIndex={-1}
    >
      <div className="card-heading">
        <div>
          <h2 id="history-heading">Run history</h2>
          <p>Recent inspections for your team.</p>
        </div>
        <span className="card-icon">
          <History size={19} aria-hidden="true" />
        </span>
      </div>
      {error ? (
        <p className="notice error" role="alert">
          {error}{' '}
          <button className="text-button" onClick={retry}>
            Retry
          </button>
        </p>
      ) : items.length ? (
        <ul className="history-items">
          {items.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                className="history-row"
                aria-pressed={selected === run.id}
                onClick={() => select(run.id)}
              >
                <span className="history-type">
                  {run.sourceType === 'url' ? (
                    <Link2 size={16} aria-hidden="true" />
                  ) : (
                    <CodeXml size={16} aria-hidden="true" />
                  )}
                </span>
                <span className="history-text">
                  <strong>{run.sourceRef}</strong>
                  <time dateTime={run.createdAt}>
                    {dateFormat.format(new Date(run.createdAt))}
                  </time>
                </span>
                <Status status={run.status} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="history-empty" role="status">
          {loading ? 'Loading history…' : 'No runs on this page.'}
        </div>
      )}
      {(offset > 0 || hasNext) && (
        <div className="history-pagination">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous page"
            disabled={offset === 0 || loading}
            onClick={() => changePage(offset - pageSize)}
          >
            <ChevronLeft size={17} />
          </button>
          <span>Page {Math.floor(offset / pageSize) + 1}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Next page"
            disabled={!hasNext || loading}
            onClick={() => changePage(offset + pageSize)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      )}
    </section>
  );
}

function Waterfall({
  run,
  selected,
  error,
  retry,
  rawXml,
}: {
  run: RunDetails | undefined;
  selected: string | undefined;
  error: string;
  retry: () => void;
  rawXml: string | undefined;
}) {
  const total = run?.hops.reduce((sum, hop) => sum + hop.latencyMs, 0) || 1;
  let elapsed = 0;
  const bars =
    run?.hops.map((hop) => {
      const start = elapsed;
      elapsed += hop.latencyMs;
      return {
        hop,
        left: (100 * start) / total,
        width: (100 * hop.latencyMs) / total,
      };
    }) ?? [];

  return (
    <section
      id="waterfall"
      className="card waterfall-card"
      aria-labelledby="waterfall-heading"
      tabIndex={-1}
    >
      <div className="card-heading">
        <div>
          <h2 id="waterfall-heading">Request waterfall</h2>
          <p>
            {run
              ? run.sourceRef
              : 'See the order and latency of each response.'}
          </p>
        </div>
        {run ? (
          <Status status={run.status} />
        ) : (
          <span className="card-icon">
            <Activity size={19} aria-hidden="true" />
          </span>
        )}
      </div>
      {error ? (
        <p className="notice error" role="alert">
          {error}{' '}
          <button className="text-button" onClick={retry}>
            Retry
          </button>
        </p>
      ) : !run ? (
        <div className="waterfall-empty" role="status">
          <span className="empty-icon">
            <Activity size={25} aria-hidden="true" />
          </span>
          <strong>
            {selected ? 'Loading inspection…' : 'No inspection selected'}
          </strong>
          {!selected && <p>Run an inspection or select one from history.</p>}
        </div>
      ) : pending(run.status) ? (
        <div className="waterfall-empty" role="status">
          <span className="empty-icon">
            <Timer size={23} aria-hidden="true" />
          </span>
          <strong>
            {run.status === 'queued'
              ? 'Waiting for a worker'
              : 'Inspecting the tag…'}
          </strong>
          <p>This page updates as the inspection finishes.</p>
        </div>
      ) : (
        <>
          <dl className="run-stats grid grid-cols-3">
            <div>
              <dt>Hops traced</dt>
              <dd>{run.hopCount}</dd>
            </div>
            <div>
              <dt>Total latency</dt>
              <dd>
                {run.totalLatencyMs} <small>ms</small>
              </dd>
            </div>
            <div>
              <dt>Findings</dt>
              <dd>{run.findings.length}</dd>
            </div>
          </dl>
          {run.errorCode && (
            <p className="notice error" role="status">
              <CircleAlert size={17} aria-hidden="true" /> Inspection failed{' '}
              <code>{run.errorCode}</code>
            </p>
          )}
          {bars.length > 0 && (
            <ol className="hops">
              {bars.map(({ hop, left, width }) => {
                const preview =
                  hop.index === 0 && rawXml ? rawXml : hop.xmlPreview;
                return (
                  <li className="hop" key={hop.id}>
                    <div className="hop-row">
                      <div className="hop-label">
                        <strong>
                          {hop.index + 1}. {hop.kind}
                        </strong>
                        <span title={hop.urlOrigin ?? undefined}>
                          {hop.urlOrigin ?? 'Pasted XML'}
                        </span>
                      </div>
                      <div className="hop-track" aria-hidden="true">
                        <span
                          className={`hop-bar hop-${hop.kind}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                        />
                      </div>
                      <span className="hop-time">{hop.latencyMs} ms</span>
                    </div>
                    <div className="hop-details">
                      {hop.httpStatus !== null && (
                        <span>HTTP {hop.httpStatus}</span>
                      )}
                      {hop.vastVersion && <span>VAST {hop.vastVersion}</span>}
                      {hop.errorCode && <code>{hop.errorCode}</code>}
                    </div>
                    {preview && (
                      <details className="xml-details">
                        <summary>
                          <ChevronDown size={15} aria-hidden="true" />
                          {hop.index === 0 && rawXml
                            ? 'View submitted XML'
                            : 'View redacted XML'}
                        </summary>
                        <pre>
                          <code>{preview}</code>
                        </pre>
                      </details>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <div className="findings">
            <h3>Findings</h3>
            {run.findings.length ? (
              <ul>
                {run.findings.map((finding) => (
                  <li
                    key={finding.id}
                    className={`finding finding-${finding.severity}`}
                  >
                    <CircleAlert size={17} aria-hidden="true" />
                    <div>
                      <strong>{finding.message}</strong>
                      <span>
                        {finding.severity} · <code>{finding.ruleId}</code>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="no-findings">
                <CircleCheck size={17} aria-hidden="true" />{' '}
                {run.status === 'failed'
                  ? 'No findings were recorded.'
                  : 'No issues found.'}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function Workspace({
  token,
  email,
  signOut,
}: {
  token: string;
  email: string;
  signOut: () => Promise<void>;
}) {
  const api = useMemo(() => inspectionApi(token), [token]);
  const [role, setRole] = useState<Role>();
  const [accessError, setAccessError] = useState('');
  const [accessAttempt, retryAccess] = useState(0);
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState<Run[]>([]);
  const [historyVersion, refreshHistory] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [selected, select] = useState<string>();
  const [run, setRun] = useState<RunDetails>();
  const [runError, setRunError] = useState('');
  const [runVersion, refreshRun] = useState(0);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [localXml, setLocalXml] = useState<{ id: string; value: string }>();
  const submission = useRef<AbortController | null>(null);

  useEffect(() => () => submission.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    void api
      .access(controller.signal)
      .then(({ role }) => {
        if (!controller.signal.aborted) {
          setRole(role);
          setAccessError('');
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setRole(undefined);
          setAccessError(readError(error));
        }
      });
    return () => controller.abort();
  }, [api, accessAttempt]);

  useEffect(() => {
    if (!role) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError('');
    void api
      .history(offset, controller.signal)
      .then(({ items }) => {
        if (controller.signal.aborted) return;
        setHistory(items);
        select((current) => current ?? items[0]?.id);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setHistoryError(readError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [api, role, offset, historyVersion]);

  useEffect(() => {
    if (!selected || !role) return;
    const controller = new AbortController();
    let next: ReturnType<typeof setTimeout> | undefined;
    setRunError('');
    async function poll(id: string) {
      try {
        const result = await api.details(id, controller.signal);
        if (controller.signal.aborted) return;
        setRun(result);
        if (pending(result.status)) {
          next = setTimeout(() => void poll(id), 1200);
        } else {
          refreshHistory((count) => count + 1);
        }
      } catch (error) {
        if (!controller.signal.aborted) setRunError(readError(error));
      }
    }
    void poll(selected);
    return () => {
      controller.abort();
      clearTimeout(next);
    };
  }, [api, selected, role, runVersion]);

  async function submit(source: Source) {
    if (submission.current) return;
    const controller = new AbortController();
    submission.current = controller;
    setSubmitting(true);
    setSubmitError('');
    try {
      const { id } = await api.submit(source, controller.signal);
      if (controller.signal.aborted) return;
      setLocalXml(
        source.type === 'xml' ? { id, value: source.value } : undefined,
      );
      setRun(undefined);
      select(id);
      setOffset(0);
      refreshHistory((count) => count + 1);
    } catch (error) {
      if (!controller.signal.aborted) setSubmitError(readError(error));
    } finally {
      submission.current = null;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to inspections
      </a>
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Workspace">
          <a href="#main" className="nav-active">
            <Activity size={18} aria-hidden="true" /> Inspector
          </a>
          <a href="#run-history">
            <History size={18} aria-hidden="true" /> History{' '}
            <ArrowDown size={13} aria-hidden="true" />
          </a>
        </nav>
        <div className="sidebar-account">
          <span className="avatar" aria-hidden="true">
            {email.slice(0, 1).toUpperCase()}
          </span>
          <div className="account-details">
            <strong title={email}>{email}</strong>
            {role && <span>{roleLabel[role]}</span>}
          </div>
          <button
            type="button"
            className="icon-button"
            title="Sign out"
            aria-label="Sign out"
            onClick={() => {
              void signOut().catch((error: unknown) =>
                setLogoutError(readError(error)),
              );
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main id="main" className="workspace" tabIndex={-1}>
        <div className="workspace-inner">
          <header className="page-heading">
            <h1>VAST Inspector</h1>
            <p>Trace ad responses, compare hop latency, and diagnose issues.</p>
          </header>
          {logoutError && (
            <p className="notice error" role="alert">
              {logoutError}
            </p>
          )}
          {accessError ? (
            <p className="notice error" role="alert">
              {accessError}{' '}
              <button
                className="text-button"
                onClick={() => retryAccess((count) => count + 1)}
              >
                Retry
              </button>
            </p>
          ) : (
            <div className="workspace-grid">
              <div className="primary-column">
                <InspectionForm
                  role={role}
                  busy={submitting}
                  error={submitError}
                  submit={submit}
                />
                <Waterfall
                  run={run?.id === selected ? run : undefined}
                  selected={selected}
                  error={runError}
                  retry={() => refreshRun((count) => count + 1)}
                  rawXml={
                    localXml?.id === selected ? localXml?.value : undefined
                  }
                />
              </div>
              <RunHistory
                items={history.slice(0, pageSize)}
                loading={historyLoading}
                error={historyError}
                selected={selected}
                select={(id) => {
                  setRunError('');
                  select(id);
                }}
                offset={offset}
                hasNext={history.length > pageSize}
                changePage={setOffset}
                retry={() => refreshHistory((count) => count + 1)}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
