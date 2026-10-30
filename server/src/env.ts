import { z } from 'zod';

// Server-only configuration. Fails fast at startup naming what is wrong;
// messages never include the values (they hold credentials).
const Env = z.object({
  SUPABASE_URL: z.url(),
  // Session pooler (5432) or direct connection. The transaction pooler (6543)
  // does not support the prepared statements the server uses.
  DATABASE_URL: z
    .string()
    .startsWith('postgres')
    .refine((u) => !/:6543\//.test(u), { error: 'use the Session pooler (port 5432), not the Transaction pooler (6543)' }),
  API_PORT: z.coerce.number().int().positive().default(8787),
});
export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid server environment (see .env.example):\n  ${problems.join('\n  ')}`);
  }
  return parsed.data;
}
