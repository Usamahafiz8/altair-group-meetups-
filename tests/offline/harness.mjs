// Shared setup for the offline checks: PGlite (in-process Postgres) with minimal
// stand-ins for what every Supabase project already has (auth schema, auth.uid(),
// API roles, pgcrypto in "extensions"), then every migration in order, then the seed.
// The real platform is exercised by the hosted access tests; this is a fast pre-push check.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_STUBS = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create role authenticator noinherit; grant anon, authenticated, service_role to authenticator;
  create schema extensions; create extension pgcrypto schema extensions;
  create schema auth;
  create table auth.users (
    instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text,
    email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
    created_at timestamptz, updated_at timestamptz, confirmation_token text, email_change text,
    email_change_token_new text, recovery_token text);
  create table auth.identities (id uuid, user_id uuid, provider_id text, identity_data jsonb, provider text,
    last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
  -- Same body as Supabase's auth.uid()
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  -- Supabase grants ALL on new public tables to the API roles by default.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

export async function setup(repo, { seed = true, report } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  const run = async (name, sql) => (report ? report.expectOk(db, name, sql) : db.exec(sql));
  await db.exec(SUPABASE_STUBS);
  const dir = path.join(repo, 'supabase/migrations');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await run(`migration ${f}`, fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  if (seed) await run('seed (PART 1 + PART 2)', fs.readFileSync(path.join(repo, 'supabase/seed.sql'), 'utf8'));
  return db;
}

// Same checks against the real hosted database (DATABASE_URL, project owner).
// Everything runs inside ONE outer transaction that is rolled back at the end,
// so the hosted data is left exactly as it was. Each `as()` call becomes a
// savepoint; the role and claims are reset explicitly after it.
export async function remote(url, body) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });
  const ROLLBACK = Symbol('rollback');
  try {
    await sql.begin(async (tx) => {
      const wrap = (q) => ({ exec: (s) => q.unsafe(s), query: async (s, p = []) => {
        const res = await q.unsafe(s, p);
        return { rows: [...res], affectedRows: res.count };
      } });
      const db = {
        ...wrap(tx),
        // On error the savepoint rollback already undoes SET LOCAL; on success
        // reset explicitly, since a released savepoint keeps SET LOCAL changes.
        transaction: (fn) => tx.savepoint(async (sp) => {
          const result = await fn(wrap(sp));
          await sp.unsafe(`reset role; select set_config('request.jwt.claims', '', true)`);
          return result;
        }),
      };
      await body(db);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  } finally {
    await sql.end();
  }
}

// Run SQL as an API role with a member's JWT claims, the way PostgREST (role
// "authenticated") and the write endpoint (role "meetup_writer") will.
// uid = null runs with no claims (anonymous).
export async function as(db, { role, uid }, sql) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    if (uid) {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    }
    return tx.query(sql);
  });
}

export function reporter() {
  let pass = 0, fail = 0;
  const r = {
    ok(name) { pass++; console.log('  PASS', name); },
    bad(name, e) { fail++; console.log('  FAIL', name, e ?? ''); },
    check(name, cond, detail) { cond ? r.ok(name) : r.bad(name, detail); },
    async expectOk(db, name, sql) {
      try { await db.exec(sql); r.ok(name); } catch (e) { r.bad(name, e.message); }
    },
    async expectErr(db, name, sql, re) {
      try { await db.exec(sql); r.bad(name, '(no error)'); }
      catch (e) { re.test(e.message) ? r.ok(`${name} -> ${e.message}`) : r.bad(name, `wrong error: ${e.message}`); }
    },
    // fn: async () => ...; passes if it throws an error matching re
    async expectThrow(name, fn, re) {
      try { await fn(); r.bad(name, '(no error)'); }
      catch (e) { re.test(e.message) ? r.ok(`${name} -> ${e.message}`) : r.bad(name, `wrong error: ${e.message}`); }
    },
    done() {
      console.log(`\n${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    },
  };
  return r;
}
