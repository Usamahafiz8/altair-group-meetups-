# Database Analysis

## Starter schema (`supabase/migrations/20261001000000_starter.sql`, copied verbatim)

```
auth.users (Supabase)
   │ 1:1, on delete cascade
public.users ───────────────┐
  id uuid PK → auth.users   │
  display_name text 1..60   │
  home_lat  double  PRIVATE │
  home_lng  double  PRIVATE │
  created_at                │
                            │ M:N
public.group_memberships ◄──┘
  group_id uuid → groups (cascade)   PK (group_id, user_id)
  user_id  uuid → users  (cascade)   index on user_id
  joined_at
        │
public.groups
  id uuid PK default gen_random_uuid()
  name text 1..80
  created_at
```

- RLS is **enabled with no policies** on all three tables → deny by default for `anon` and
  `authenticated`. Every read the slice needs must be granted deliberately.
- No meetup/RSVP tables, no views, functions, or endpoints exist.
- The starter is applied once, before our migrations (timestamp `20261001000000` sorts first).

## Critical observation: `users` and the home location

The attendee list needs `users.display_name`, but `home_lat/home_lng` live on the same row. RLS filters
**rows, not columns**, so any SELECT policy on `users` that lets a member read a co-member's row would also
let them `select home_lat, home_lng` directly through PostgREST with their own session.

Therefore display names must be exposed through one of:

1. column-level privileges (`revoke select on users from authenticated; grant select (id, display_name)`), or
2. a view / security-definer function returning only `id, display_name`.

Decision deferred to Phase 2; either way a test must try `select home_lat` as each persona and get nothing.

## RLS recursion risk

A policy on `group_memberships` like "you can see memberships of groups you belong to" that queries
`group_memberships` itself recurses. The standard fix is a `security definer` helper
(`is_group_member(group_id)`) with a pinned `search_path`, used by policies on other tables.

## Seed data facts relevant to schema design

- Seed PART 2 column names (`created_by`, `meeting_point_name`, `meeting_point_lat`, `meeting_point_lng`,
  `rsvps(meetup_id, user_id)`) are a suggestion only — "the VALUES are what matter".
- Seed PART 2 has no `status` column → default must be `'scheduled'`.
- Seed meetups use fixed UUIDs `c3000000-…-00000000000{1,2,3}` → `meetups.id` must accept explicit ids.
- Start times are `now() + interval` → seeds are always upcoming at load time.

## Hosted-environment implications

- `supabase/seed.sql` is only auto-run by `supabase db reset` (local). On hosted, seed PART 1 is run once in
  the SQL editor (or via `psql`), and PART 2 after our migrations.
- Hosted DB cannot be reset freely, so tests must create and clean up their own fixtures rather than rely
  on a reset between runs.

---

# Phase 1 — Meetups and RSVPs design

Migration: `supabase/migrations/20261030100000_meetups_and_rsvps.sql`

## Naming

Column names follow seed PART 2 (`created_by`, `meeting_point_name/lat/lng`, `rsvps(meetup_id, user_id)`)
rather than the workbook's draft names (`creator_id`, `location_name`, `latitude/longitude`), so the
reference data loads with zero remapping. PART 2 is uncommented in `supabase/seed.sql`, values unchanged.

## `public.meetups`

| Column | Type | Rule |
|---|---|---|
| id | uuid PK | default `gen_random_uuid()`; seed supplies fixed ids |
| group_id | uuid → groups | not null, on delete cascade |
| created_by | uuid → users | not null, default `auth.uid()`, on delete cascade; never from request body |
| title | text | 1–80 chars, not blank (endpoint trims first) |
| starts_at | timestamptz | not null; future-only enforced by trigger |
| meeting_point_name | text | 1–120 chars, not blank |
| meeting_point_lat / _lng | double precision | not null, −90..90 / −180..180 |
| status | text | `scheduled` \| `cancelled`, default `scheduled` |
| cancelled_at | timestamptz | set by trigger on cancel; check: non-null ⇔ cancelled |
| created_at / updated_at | timestamptz | `updated_at` maintained by trigger |

Indexes: `(group_id, starts_at)` for the soonest-first group list; `(created_by)`.

`status` is `text + check` rather than an enum type: same integrity, simpler to evolve in a migration.

## `public.rsvps`

| Column | Type | Rule |
|---|---|---|
| id | uuid PK | default `gen_random_uuid()` |
| meetup_id | uuid → meetups | not null, on delete cascade |
| user_id | uuid → users | not null, default `auth.uid()`, on delete cascade |
| created_at | timestamptz | default now() |

`unique (meetup_id, user_id)` = one RSVP per member per meetup; the endpoint will insert with
`on conflict do nothing` so a repeat RSVP is not a user-visible error. Index on `user_id`.

## Integrity triggers (apply to every writer, including the service role)

| Trigger | Rule |
|---|---|
| `meetups_integrity` (insert) | `starts_at > now()` (rejects past **and** current); status must start `scheduled`; creator must be a member of the group |
| `meetups_integrity` (update) | id / group_id / created_by immutable; a cancelled meetup cannot change at all (no reopen, no edit); cancelling stamps `cancelled_at`; a changed `starts_at` must be future when the writer is role `authenticated` |
| `meetups_set_updated_at` | maintains `updated_at` |
| `rsvps_integrity` (insert) | locks the meetup row `FOR SHARE`, then requires: meetup exists, user is a member of its group, meetup not cancelled, meetup not started |
| `rsvps_no_update` | RSVPs are insert/delete only |

Why some rules are triggers rather than RLS: these are facts about the data that must hold even for the
endpoint's own writes or a maintenance script. RLS (next phase) decides *who* may write; triggers decide
*what* a valid row is. A CHECK constraint cannot use `now()` reliably (it is re-evaluated on every
update/restore), so the future-start rule is a trigger.

**Started-meetup test setup:** the spec lets the test setup move a meetup into the past "as the database
owner". The update branch only enforces future start for role `authenticated`, so owner / service-role
setup can do this, while an app user editing a meetup cannot.

**Concurrency:** RSVP-vs-cancel race. The RSVP trigger takes `FOR SHARE` on the meetup row, which
conflicts with the cancel's row update lock, so either the cancel waits for the RSVP to commit, or the
RSVP waits and then re-reads the row and sees `cancelled`. No RSVP can land on a cancelled meetup.

`tg_rsvps_integrity` is `SECURITY DEFINER` (it must see the meetup and membership regardless of the
caller's RLS view), with `search_path = ''`, and its errors reveal nothing about the meetup's contents.

## Verification (offline, PGlite) — 41/41 passed

`npm run check:migrations -w tests` applies starter + migration + full seed to in-process Postgres with
stand-in `auth` schema/roles and checks: seed loads (3 meetups, 3 RSVPs); every column constraint;
past/current start rejected; outsider creator rejected; created-as-cancelled rejected; immutable
group/creator; `cancelled_at` only via cancel; cancel stamps `cancelled_at`; reopen and edit-after-cancel
rejected; duplicate RSVP unique + `on conflict do nothing` leaves one; outsider and other-group RSVP
rejected; RSVP to cancelled / started / unknown meetup rejected; RSVPs not updatable; withdraw allowed on a
cancelled meetup; group deletion cascades; RLS enabled on both tables.

Hosted verification (`supabase db push` + seed) is pending the project `.env`.

## Rollback / recovery

Migrations are forward-only (Supabase convention). To undo this migration on a dev database:

```sql
drop table if exists public.rsvps;
drop table if exists public.meetups;
drop function if exists public.tg_rsvps_no_update(), public.tg_rsvps_integrity(),
                        public.tg_meetups_integrity(), public.tg_set_updated_at();
delete from supabase_migrations.schema_migrations where version = '20261030100000';
```

On hosted, a mistake after push is fixed with a new forward migration, not by editing a pushed file.
