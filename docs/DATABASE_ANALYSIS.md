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
