// Sign in the seed personas once per test run (Vitest globalSetup) and hand
// the access tokens to every test file. Vitest isolates modules per file, so a
// per-file cache signed every persona in again for each file; a full run then
// hit Supabase Auth's sign-in rate limit ("sign-in failed for riley" on a
// clean-clone run). Retries with backoff on 429 / network errors.
import type { TestProject } from 'vitest/node';

export const PERSONAS = ['avery', 'jordan', 'sam', 'riley', 'morgan', 'casey', 'taylor', 'quinn'] as const;
export type Persona = (typeof PERSONAS)[number];

declare module 'vitest' {
  export interface ProvidedContext {
    tokens: Record<Persona, string>;
  }
}

export async function signIn(who: Persona, attempts = 5): Promise<string> {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  for (let i = 1; ; i++) {
    let detail: string;
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `${who}@example.test`, password: 'altair-fixture-pass' }),
      });
      const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_code?: string; msg?: string };
      if (json.access_token) return json.access_token;
      detail = `HTTP ${res.status} ${json.error_code ?? ''} ${json.msg ?? ''}`.trim();
      if (res.status !== 429 && res.status < 500) throw new Error(`sign-in failed for ${who}: ${detail}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('sign-in failed')) throw e;
      detail = `network error: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (i >= attempts) throw new Error(`sign-in failed for ${who} after ${attempts} attempts: ${detail}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
}

export default async function setup(project: TestProject) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return; // unit-only runs
  const tokens = {} as Record<Persona, string>;
  for (const who of PERSONAS) tokens[who] = await signIn(who); // sequential: gentle on the rate limit
  project.provide('tokens', tokens);
}
