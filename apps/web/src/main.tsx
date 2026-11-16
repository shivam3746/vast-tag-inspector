import '@fontsource-variable/inter';
import './style.css';
import { createClient } from '@supabase/supabase-js';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getConfig, readError } from './api.ts';
import { Login } from './login.tsx';
import { Workspace } from './workspace.tsx';

function SessionView({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const { data } = client.auth.onAuthStateChange((_event, next) =>
      setSession(next),
    );
    return () => data.subscription.unsubscribe();
  }, [client]);

  if (!session)
    return <Login client={client} waiting={session === undefined} />;
  return (
    <Workspace
      key={session.user.id}
      token={session.access_token}
      email={session.user.email ?? 'Signed-in user'}
      signOut={async () => {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw error;
      }}
    />
  );
}

function App() {
  const [client, setClient] = useState<SupabaseClient>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void getConfig(controller.signal)
      .then((config) => {
        if (!controller.signal.aborted)
          setClient(
            createClient(config.supabaseUrl, config.supabasePublishableKey),
          );
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(readError(failure));
      });
    return () => controller.abort();
  }, [attempt]);

  return client ? (
    <SessionView client={client} />
  ) : (
    <Login
      waiting={!error}
      configError={error}
      retry={() => {
        setError('');
        setAttempt((current) => current + 1);
      }}
    />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('App root is missing.');
createRoot(root).render(<App />);
