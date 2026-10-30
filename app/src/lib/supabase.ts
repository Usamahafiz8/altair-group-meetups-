import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { config } from './config';

// Used for sign-in and the session only. All feature data goes through the
// endpoint server (lib/api.ts). The root layout never renders the app without
// a valid config, so the placeholder values are never used for a request.
export const supabase = createClient(
  config?.supabaseUrl ?? 'http://invalid.local',
  config?.supabaseAnonKey ?? 'invalid',
  {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);

// Refresh tokens only while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
