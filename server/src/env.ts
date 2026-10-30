import { z } from 'zod';

// Server-only configuration. Fails fast at startup with the names (never the
// values) of anything missing.
const Env = z.object({
  SUPABASE_URL: z.url(),
  DATABASE_URL: z.string().startsWith('postgres'),
  API_PORT: z.coerce.number().int().positive().default(8787),
});
export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))];
    throw new Error(`Invalid server environment: ${names.join(', ')} (see .env.example)`);
  }
  return parsed.data;
}
