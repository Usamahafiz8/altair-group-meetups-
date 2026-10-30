// Test harness for the endpoint layer against the hosted project:
// - the real Hono app (in-process via app.request), real JWKS verification,
//   real seed-account sessions from Supabase Auth, real database under RLS;
// - an owner connection only for fixtures and cleanup (the spec allows test
//   setup to write directly as the database owner, e.g. a started meetup).
import postgres from 'postgres';
import { inject } from 'vitest';
import { createApp } from '../../server/src/app';
import { createVerifier } from '../../server/src/auth';
import { createSql } from '../../server/src/db';
import { silentLogger } from '../../server/src/log';
import type { Persona } from './sessions';

const { SUPABASE_URL, SUPABASE_ANON_KEY, DATABASE_URL } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !DATABASE_URL) {
  throw new Error('tests need SUPABASE_URL, SUPABASE_ANON_KEY and DATABASE_URL in ../.env');
}

export const U = {
  avery: 'a1000000-0000-4000-8000-000000000001',
  jordan: 'a1000000-0000-4000-8000-000000000002',
  sam: 'a1000000-0000-4000-8000-000000000003',
  riley: 'a1000000-0000-4000-8000-000000000004',
  morgan: 'a1000000-0000-4000-8000-000000000005',
  casey: 'a1000000-0000-4000-8000-000000000006',
  taylor: 'a1000000-0000-4000-8000-000000000007',
  quinn: 'a1000000-0000-4000-8000-000000000008',
} as const satisfies Record<Persona, string>;
export type { Persona };

export const G = {
  maple: 'b2000000-0000-4000-8000-000000000001',
  riverside: 'b2000000-0000-4000-8000-000000000002',
} as const;

export const M = {
  saturday: 'c3000000-0000-4000-8000-000000000001',
  weeknight: 'c3000000-0000-4000-8000-000000000002',
  riverside: 'c3000000-0000-4000-8000-000000000003',
} as const;

export const SEED_HOME_VALUES = [
  40.004812, -99.993127, 40.007395, -99.98864, 39.998263, -99.995418, 40.002957, -100.006284,
  39.993481, -100.011736, 39.989624, -100.004952, 40.010538, -100.014867, 39.996107, -100.017392,
];
// Any trace of a home location in a payload: the column names or any seeded value.
export function leaksHome(body: unknown): boolean {
  const s = JSON.stringify(body);
  return /home_l(at|ng)/i.test(s) || SEED_HOME_VALUES.some((v) => s.includes(String(v)));
}

export const TEST_TAG = '[test]';
export const owner = postgres(DATABASE_URL, { max: 2, prepare: false, onnotice: () => {} });
const appSql = createSql(DATABASE_URL);
export const app = createApp({ sql: appSql, verify: createVerifier(SUPABASE_URL), log: silentLogger });

// Sessions come from globalSetup (sessions.ts): one sign-in per persona per run.
export async function token(who: Persona): Promise<string> {
  return inject('tokens')[who];
}

export type ApiResult = { status: number; body: any };

// Call the API as a persona (or with a raw Authorization header / none).
export async function api(
  who: Persona | null,
  method: string,
  path: string,
  body?: unknown,
  { rawAuth, rawBody }: { rawAuth?: string; rawBody?: string } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (rawAuth !== undefined) headers.Authorization = rawAuth;
  else if (who) headers.Authorization = `Bearer ${await token(who)}`;
  const res = await app.request(path, {
    method,
    headers,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

export const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

export const createBody = (overrides: Record<string, unknown> = {}) => ({
  groupId: G.maple,
  title: `${TEST_TAG} walk`,
  startsAt: inDays(3),
  meetingPoint: { name: 'Fountain plaza, Town Green', lat: 39.999134, lng: -99.999461 },
  ...overrides,
});

// Owner-created fixture: a Maple meetup by `creator`, optional RSVPs.
export async function fixtureMeetup({
  creator = 'avery' as Persona,
  group = G.maple as string,
  rsvps = [] as Persona[],
  title = `${TEST_TAG} fixture`,
} = {}): Promise<string> {
  const [row] = await owner<{ id: string }[]>`
    insert into public.meetups (group_id, created_by, title, starts_at, meeting_point_name, meeting_point_lat, meeting_point_lng)
    values (${group}, ${U[creator]}, ${title}, now() + interval '5 days', 'Fountain plaza, Town Green', 39.999134, -99.999461)
    returning id`;
  for (const who of rsvps) {
    await owner`insert into public.rsvps (meetup_id, user_id) values (${row!.id}, ${U[who]})`;
  }
  return row!.id;
}

// The spec: "your test setup may insert or update one directly as the database owner".
export async function makeStarted(meetupId: string) {
  await owner`update public.meetups set starts_at = now() - interval '10 minutes' where id = ${meetupId}`;
}

export async function cleanup() {
  await owner`delete from public.meetups where title like ${TEST_TAG + '%'}`;
  await owner`delete from public.groups where name like ${TEST_TAG + '%'}`; // cascades memberships
}

// Owner-created group with the given members (and no meetups).
export async function fixtureGroup(members: Persona[]): Promise<string> {
  const [g] = await owner<{ id: string }[]>`insert into public.groups (name) values (${TEST_TAG + ' empty group'}) returning id`;
  for (const who of members) await owner`insert into public.group_memberships (group_id, user_id) values (${g!.id}, ${U[who]})`;
  return g!.id;
}

export async function closeAll() {
  await cleanup();
  await Promise.all([owner.end({ timeout: 5 }), appSql.end({ timeout: 5 })]);
}
