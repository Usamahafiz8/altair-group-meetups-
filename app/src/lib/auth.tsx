import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

type AuthState = {
  session: Session | null;
  ready: boolean; // the stored session has been read
  notice: string | null; // why the user was signed out, shown on sign-in
  clearNotice: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// The API client calls this when the server rejects the session (401).
let onExpired: () => void = () => {};
export const expireSession = () => onExpired();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth
      .getSession()
      .then(({ data }) => alive && setSession(data.session))
      .finally(() => alive && setReady(true));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    onExpired = () => {
      setNotice('Your session has expired. Please sign in again.');
      void supabase.auth.signOut({ scope: 'local' });
    };
    return () => {
      alive = false;
      data.subscription.unsubscribe();
      onExpired = () => {};
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      ready,
      notice,
      clearNotice: () => setNotice(null),
      signOut: async () => {
        setNotice(null);
        await supabase.auth.signOut({ scope: 'local' });
      },
    }),
    [session, ready, notice],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
