import type { SupabaseClient } from '@supabase/supabase-js';
import { Activity, ArrowRight, Layers3 } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { readError } from './api.ts';

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Layers3 size={20} aria-hidden="true" />
      </span>
      <span>VAST Inspector</span>
    </div>
  );
}

export function Login({
  client,
  waiting,
  configError,
  retry,
}: {
  client?: SupabaseClient;
  waiting: boolean;
  configError?: string;
  retry?: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (result.error) throw result.error;
    } catch (failure) {
      setError(readError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="login-panel">
        <Brand />
        <div className="login-intro">
          <h2>
            Trace VAST
            <br />
            ad responses.
          </h2>
          <p>
            Trace VAST wrappers and see exactly where the ad response breaks
            down.
          </p>
        </div>
        <div className="login-diagram" aria-hidden="true">
          <Activity size={22} />
          <div />
          <div />
          <div />
        </div>
      </section>
      <section className="login-form-area">
        <div className="login-card">
          <h1>Sign in</h1>
          <p className="muted">Use your team account to access inspections.</p>
          <form className="login-form" onSubmit={(event) => void signIn(event)}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              autoComplete="username"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            {configError && (
              <div className="notice" role="alert">
                {configError}{' '}
                <button type="button" className="text-button" onClick={retry}>
                  Retry
                </button>
              </div>
            )}
            <button
              type="submit"
              className="primary-button"
              disabled={!client || waiting || busy}
            >
              {busy ? 'Signing in…' : 'Sign in'}{' '}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
            {waiting && (
              <span className="muted small" role="status">
                Connecting to the workspace…
              </span>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}
