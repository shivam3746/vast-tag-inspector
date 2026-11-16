export type SafeFetchErrorCode =
  | 'INVALID_URL'
  | 'BLOCKED_IP'
  | 'DNS_FAILED'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'TOO_MANY_REDIRECTS'
  | 'INVALID_REDIRECT'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'UNSUPPORTED_ENCODING'
  | 'INVALID_UTF8'
  | 'REQUEST_FAILED';

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;

  constructor(code: SafeFetchErrorCode) {
    super(code);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}
