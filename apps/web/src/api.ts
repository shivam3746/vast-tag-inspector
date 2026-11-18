export type Role = 'admin' | 'ad_ops' | 'viewer';
export type RunStatus = 'queued' | 'running' | 'done' | 'failed';
export type Severity = 'none' | 'info' | 'warning' | 'error';
export type Source = { type: 'url' | 'xml'; value: string };

export interface Run {
  id: string;
  sourceType: Source['type'];
  sourceRef: string;
  status: RunStatus;
  errorCode: string | null;
  hopCount: number;
  totalLatencyMs: number;
  maxSeverity: Severity;
  createdAt: string;
}

export interface Hop {
  id: string;
  index: number;
  httpStatus: number | null;
  latencyMs: number;
  kind: 'wrapper' | 'inline' | 'empty' | 'error';
  vastVersion: string | null;
  urlOrigin: string | null;
  xmlPreview: string | null;
  errorCode: string | null;
}

export interface Finding {
  id: string;
  hopId: string | null;
  ruleId: string;
  severity: Exclude<Severity, 'none'>;
  message: string;
}

export interface RunDetails extends Run {
  hops: Hop[];
  findings: Finding[];
  explanation?: StoredExplanation | null;
}

export interface StoredExplanation {
  model: string;
  promptVersion: string;
  output: {
    summary: string;
    probable_root_cause: string;
    confidence: 'low' | 'medium' | 'high';
    fixes: {
      finding_rule_id: string;
      action: string;
      owner: 'publisher' | 'ssp' | 'demand_partner' | 'unknown';
    }[];
  };
}

interface BrowserConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const data: { error?: { message?: string } } | null = await response
      .json()
      .catch(() => null);
    const message =
      response.status === 401
        ? 'Your session may have expired. Sign out and sign in again.'
        : (data?.error?.message ??
          'Could not reach the inspection API. Try again.');
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

const inspections = '/api/inspections';
export const pageSize = 10;
export const getConfig = (signal: AbortSignal) =>
  request<BrowserConfig>('/api/config', { signal });

export function inspectionApi(token: string) {
  return {
    access: (signal: AbortSignal) =>
      request<{
        role: Role;
        explanationsAvailable: boolean;
        explanationModel: string | null;
        explanationPromptVersion: string | null;
      }>(`${inspections}/access`, { signal }, token),
    history: (offset: number, signal: AbortSignal) =>
      request<{ items: Run[] }>(
        `${inspections}?limit=${pageSize + 1}&offset=${offset}`,
        { signal },
        token,
      ),
    details: (id: string, signal: AbortSignal) =>
      request<RunDetails>(
        `${inspections}/${encodeURIComponent(id)}`,
        { signal },
        token,
      ),
    submit: (source: Source, signal: AbortSignal) =>
      request<{ id: string }>(
        inspections,
        { method: 'POST', body: JSON.stringify(source), signal },
        token,
      ),
    explain: (id: string, signal: AbortSignal) =>
      request<{ explanation: StoredExplanation }>(
        `${inspections}/${encodeURIComponent(id)}/explain`,
        { method: 'POST', signal },
        token,
      ),
  };
}

export const readError = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Try again.';

export const pending = (status: RunStatus) =>
  status === 'queued' || status === 'running';
