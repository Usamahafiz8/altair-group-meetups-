// Offline migration check (no Docker, no hosted project needed).
// Runs the starter + our migrations + the full seed on PGlite (in-process Postgres)
// with minimal stand-ins for Supabase's auth schema and roles, then exercises the
// constraints and integrity triggers. It is a fast pre-push check, not a substitute for
// the hosted-database access tests (RLS behaviour depends on real Supabase roles/JWTs).
// Usage (repo root): npm install && npm run check:migrations -w tests
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';

const repo = process.argv[2];
const mig = (f) => fs.readFileSync(path.join(repo, 'supabase/migrations', f), 'utf8');
const db = new PGlite({ extensions: { pgcrypto } });

const SUPABASE_STUBS = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions; create extension pgcrypto schema extensions;
  create schema auth;
  create table auth.users (
    instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text,
    email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
    created_at timestamptz, updated_at timestamptz, confirmation_token text, email_change text,
    email_change_token_new text, recovery_token text);
  create table auth.identities (id uuid, user_id uuid, provider_id text, identity_data jsonb, provider text,
    last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log('  PASS', name); };
const bad = (name, e) => { fail++; console.log('  FAIL', name, e ?? ''); };
async function expectOk(name, sql) {
  try { await db.exec(sql); ok(name); } catch (e) { bad(name, e.message); }
}
async function expectErr(name, sql, re) {
  try { await db.exec(sql); bad(name, '(no error)'); }
  catch (e) { re.test(e.message) ? ok(`${name} -> ${e.message}`) : bad(name, `wrong error: ${e.message}`); }
}
const one = async (sql) => (await db.query(sql)).rows[0];

console.log('setup');
await db.exec(SUPABASE_STUBS);
await expectOk('starter migration', mig('20261001000000_starter.sql'));
await expectOk('meetups+rsvps migration', mig('20261030100000_meetups_and_rsvps.sql'));
await expectOk('seed (PART 1 + PART 2)', fs.readFileSync(path.join(repo, 'supabase/seed.sql'), 'utf8'));

console.log('seed contents');
const c = await one(`select (select count(*) from public.meetups)::int m, (select count(*) from public.rsvps)::int r,
  (select count(*) from public.meetups where status='scheduled' and cancelled_at is null)::int s`);
c.m === 3 && c.r === 3 && c.s === 3 ? ok('3 meetups, 3 rsvps, all scheduled') : bad('seed counts', JSON.stringify(c));

const G1 = 'b2000000-0000-4000-8000-000000000001', AVERY = 'a1000000-0000-4000-8000-000000000001';
const SAM = 'a1000000-0000-4000-8000-000000000003', TAYLOR = 'a1000000-0000-4000-8000-000000000007';
const SAT = 'c3000000-0000-4000-8000-000000000001', WEEK = 'c3000000-0000-4000-8000-000000000002';
const ins = (o = {}) => {
  const v = { title: `'T'`, starts_at: `now() + interval '1 day'`, name: `'Fountain plaza, Town Green'`,
              lat: '39.999134', lng: '-99.999461', by: `'${AVERY}'`, group: `'${G1}'`, ...o };
  return `insert into public.meetups (group_id, created_by, title, starts_at, meeting_point_name, meeting_point_lat, meeting_point_lng)
          values (${v.group}, ${v.by}, ${v.title}, ${v.starts_at}, ${v.name}, ${v.lat}, ${v.lng})`;
};

console.log('column constraints');
await expectErr('title empty', ins({ title: `''` }), /check constraint/);
await expectErr('title whitespace only', ins({ title: `'   '` }), /check constraint/);
await expectErr('title 81 chars', ins({ title: `repeat('x', 81)` }), /check constraint/);
await expectOk('title 80 chars', ins({ title: `repeat('x', 80)` }));
await expectErr('place name 121 chars', ins({ name: `repeat('x', 121)` }), /check constraint/);
await expectErr('lat 90.1', ins({ lat: '90.1' }), /check constraint/);
await expectErr('lng -180.1', ins({ lng: '-180.1' }), /check constraint/);
await expectErr('null lat', ins({ lat: 'null' }), /null value/);
await expectErr('bad status', `update public.meetups set status='done' where id='${WEEK}'`, /check constraint/);
await expectErr('unknown group (FK)', ins({ group: `gen_random_uuid()` }), /creator must be a member|foreign key/);

console.log('meetup triggers');
await expectErr('past start on insert', ins({ starts_at: `now() - interval '1 minute'` }), /must be in the future/);
await expectErr('current start on insert', ins({ starts_at: `now()` }), /must be in the future/);
await expectErr('outsider creator', ins({ by: `'${TAYLOR}'` }), /creator must be a member/);
await expectErr('insert as cancelled', ins().replace('meeting_point_lng)', 'meeting_point_lng, status)').replace(/\)\s*$/, `, 'cancelled')`), /must be scheduled/);
await expectErr('change group_id', `update public.meetups set group_id='b2000000-0000-4000-8000-000000000002' where id='${WEEK}'`, /cannot change/);
await expectErr('change created_by', `update public.meetups set created_by='${SAM}' where id='${WEEK}'`, /cannot change/);
await expectErr('set cancelled_at without cancelling', `update public.meetups set cancelled_at=now() where id='${WEEK}'`, /only by cancelling/);
await expectOk('owner may change start time', `update public.meetups set starts_at = now() + interval '3 days' where id='${WEEK}'`);

console.log('cancel is final');
await expectOk('cancel', `update public.meetups set status='cancelled' where id='${WEEK}'`);
const w = await one(`select status, cancelled_at is not null as has_ts, updated_at > created_at as touched from public.meetups where id='${WEEK}'`);
w.status === 'cancelled' && w.has_ts ? ok('cancelled_at stamped') : bad('cancelled_at', JSON.stringify(w));
await expectErr('reopen', `update public.meetups set status='scheduled' where id='${WEEK}'`, /cancelled and cannot be changed/);
await expectErr('edit cancelled', `update public.meetups set title='x' where id='${WEEK}'`, /cancelled and cannot be changed/);

console.log('rsvps');
await expectErr('duplicate RSVP (plain insert)', `insert into public.rsvps (meetup_id, user_id) values ('${SAT}', 'a1000000-0000-4000-8000-000000000002')`, /rsvps_one_per_member/);
await expectOk('duplicate RSVP with ON CONFLICT DO NOTHING', `insert into public.rsvps (meetup_id, user_id) values ('${SAT}', 'a1000000-0000-4000-8000-000000000002') on conflict (meetup_id, user_id) do nothing`);
const d = await one(`select count(*)::int n from public.rsvps where meetup_id='${SAT}' and user_id='a1000000-0000-4000-8000-000000000002'`);
d.n === 1 ? ok('still exactly one RSVP') : bad('rsvp count', d.n);
await expectErr('outsider RSVP', `insert into public.rsvps (meetup_id, user_id) values ('${SAT}', '${TAYLOR}')`, /only group members/);
await expectErr('other-group member RSVP (Morgan -> Maple)', `insert into public.rsvps (meetup_id, user_id) values ('${SAT}', 'a1000000-0000-4000-8000-000000000005')`, /only group members/);
await expectErr('RSVP to cancelled', `insert into public.rsvps (meetup_id, user_id) values ('${WEEK}', '${SAM}')`, /cancelled/);
await expectErr('RSVP to unknown meetup', `insert into public.rsvps (meetup_id, user_id) values (gen_random_uuid(), '${SAM}')`, /not found/);
await expectOk('owner moves SAT into the past (simulate started)', `update public.meetups set starts_at = now() - interval '5 minutes' where id='${SAT}'`);
await expectErr('RSVP to started', `insert into public.rsvps (meetup_id, user_id) values ('${SAT}', '${SAM}')`, /already started/);
await expectErr('rsvps not updatable', `update public.rsvps set created_at=now() where meetup_id='${SAT}'`, /not updatable/);

console.log('withdraw + cascade');
await expectOk('re-seed an RSVP on a fresh meetup then cancel it', `
  ${ins({ title: `'withdraw-test'` })};
  insert into public.rsvps (meetup_id, user_id) select id, '${SAM}' from public.meetups where title='withdraw-test';
  update public.meetups set status='cancelled' where title='withdraw-test';`);
await expectOk('withdraw RSVP on a cancelled meetup', `delete from public.rsvps where user_id='${SAM}' and meetup_id=(select id from public.meetups where title='withdraw-test')`);
await expectOk('delete group cascades', `delete from public.groups where id='b2000000-0000-4000-8000-000000000002'`);
const cc = await one(`select (select count(*) from public.meetups where group_id='b2000000-0000-4000-8000-000000000002')::int m,
  (select count(*) from public.rsvps where meetup_id='c3000000-0000-4000-8000-000000000003')::int r`);
cc.m === 0 && cc.r === 0 ? ok('meetups and rsvps of deleted group removed') : bad('cascade', JSON.stringify(cc));

console.log('catalog');
const rls = await db.query(`select relname, relrowsecurity from pg_class where relname in ('meetups','rsvps') order by 1`);
rls.rows.every((r) => r.relrowsecurity) ? ok('RLS enabled on meetups, rsvps') : bad('rls', JSON.stringify(rls.rows));
const idx = await db.query(`select indexname from pg_indexes where tablename in ('meetups','rsvps') order by 1`);
console.log('  indexes:', idx.rows.map((r) => r.indexname).join(', '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
