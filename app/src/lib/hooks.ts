import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { toClientError, type ClientError } from './api';

export type Resource<T> = {
  data: T | undefined;
  error: ClientError | undefined;
  loading: boolean; // first load, nothing to show yet
  refreshing: boolean; // pull-to-refresh with data on screen
  reload: () => void;
  refresh: () => Promise<void>;
  setData: (data: T) => void;
};

// Loads when the screen gains focus (so returning from create / edit / RSVP
// shows fresh data) and keeps the last data on screen while reloading.
// Out-of-order and post-unmount responses are ignored. Pass `null` to wait
// (e.g. until a group is chosen). `key` identifies what is being loaded.
export function useResource<T>(key: string | null, load: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<{ key: string | null; data?: T; error?: ClientError; loading: boolean; refreshing: boolean }>(
    { key, loading: key !== null, refreshing: false },
  );
  const latest = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  // Switching key (e.g. another group) must not show the previous key's data.
  const current = state.key === key ? state : { key, loading: key !== null, refreshing: false };

  const run = useCallback(
    async (mode: 'load' | 'refresh') => {
      if (key === null) return;
      const id = ++latest.current;
      setState((s) => ({
        ...(s.key === key ? s : { key }),
        key,
        loading: mode === 'load' && (s.key !== key || s.data === undefined),
        refreshing: mode === 'refresh',
        error: undefined,
      }));
      try {
        const data = await loadRef.current();
        if (id === latest.current) setState({ key, data, loading: false, refreshing: false });
      } catch (e) {
        if (id === latest.current) {
          setState((s) => ({ ...(s.key === key ? s : { key }), key, error: toClientError(e), loading: false, refreshing: false }));
        }
      }
    },
    [key],
  );

  useFocusEffect(
    useCallback(() => {
      void run('load');
      return () => {
        latest.current++; // drop responses that arrive after leaving the screen
      };
    }, [run]),
  );

  return {
    data: current.data,
    error: current.error,
    loading: current.loading,
    refreshing: current.refreshing,
    reload: () => void run('load'),
    refresh: () => run('refresh'),
    setData: (data: T) => setState({ key, data, loading: false, refreshing: false }),
  };
}

export type ActionResult<R> = { ok: true; data: R } | { ok: false; error: ClientError | null };

// A user action (submit, RSVP, cancel...). Ignores taps while one is running
// (error: null), keeps the last error in state for display, and returns the
// outcome directly: state read right after `await run()` would be stale.
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ClientError | undefined>();
  const busy = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args: A): Promise<ActionResult<R>> => {
    if (busy.current) return { ok: false, error: null };
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      return { ok: true, data: await fnRef.current(...args) };
    } catch (e) {
      const err = toClientError(e);
      setError(err);
      return { ok: false, error: err };
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);

  return { run, pending, error, clearError: () => setError(undefined) };
}
