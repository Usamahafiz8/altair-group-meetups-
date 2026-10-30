import { z } from 'zod';

// Public, bundled configuration. Each variable must be read with a literal
// `process.env.EXPO_PUBLIC_*` expression so Expo can inline it at build time.
// Only the anon key is here: the service role key never reaches the app.
const Config = z.object({
  supabaseUrl: z.url(),
  supabaseAnonKey: z.string().min(20),
  apiUrl: z.url(),
});
export type Config = z.infer<typeof Config>;

const parsed = Config.safeParse({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  apiUrl: process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, ''),
});

export const config: Config | null = parsed.success ? parsed.data : null;
export const configProblem: string | null = parsed.success
  ? null
  : `Missing or invalid: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}. ` +
    'Fill in EXPO_PUBLIC_* in the repo-root .env and restart Expo.';
