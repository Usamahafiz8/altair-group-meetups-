# Security Review

Status: Phase 2 (database access control). Sections for the endpoint, app and map are added as
those phases land.

## 1. Threat model in one paragraph

Every caller is a signed-in member using the app's anon key plus their own JWT, so they can hit
PostgREST directly with any query the API allows — not just what the app sends. The database must
therefore be safe against a curious or hostile member hand-crafting requests. The two assets are
(1) meetups/attendees of groups the caller is not in, and (2) every member's home location.

## 2. Roles

| Role | Who | Can read | Can write |
|---|---|---|---|
| `anon` | no session | **nothing** (all grants revoked) | nothing |
| `authenticated` | the app via PostgREST, member's JWT | own groups, own memberships, meetups + RSVPs of own groups, `users(id, display_name)` of self and co-members | **nothing** |
| `meetup_writer` | the write endpoint, after verifying the JWT | inherits `authenticated` | insert meetup (6 columns), update meetup (status + editable fields), insert RSVP (`meetup_id` only), delete RSVP |
| `service_role` | test setup only (never in the app) | Supabase default (bypasses RLS) | Supabase default |
| `postgres` | migrations; the endpoint's connection, which drops to `meetup_writer` per transaction | owner | owner |

**Why the app role is read-only.** If `authenticated` could insert/update, a member could skip the
Zod endpoint and write straight to PostgREST. RLS would still hold, but the "every write is validated
by the shared Zod contract" requirement would only be a convention. Revoking writes from
`authenticated` makes the endpoint the *only* write path, enforced by Postgres.

**Why writes still run under RLS.** The endpoint does not use the service role for member writes.
Per request it opens a transaction, `set local role meetup_writer`, and sets
`request.jwt.claims` to the verified claims, so `auth.uid()` is the member and every write policy
applies. PostgREST's `authenticator` is not a member of `meetup_writer`, so a JWT with
`"role":"meetup_writer"` cannot select it through the API.

## 3. Policies (`20261030110000_access_control.sql`)

| Table | Policy | Rule |
|---|---|---|
| users | `users_select_self_or_comember` | `id = auth.uid()` or shares a group |
| groups | `groups_select_member` | caller is a member |
| group_memberships | `group_memberships_select_own` | `user_id = auth.uid()` |
| meetups | `meetups_select_member` | caller is a member of `group_id` (cancelled included) |
| meetups | `meetups_insert_member` (writer) | `created_by = auth.uid()` and member of `group_id` |
| meetups | `meetups_update_creator` (writer) | `created_by = auth.uid()` (USING and WITH CHECK) |
| rsvps | `rsvps_select_member` | the meetup is visible to the caller |
| rsvps | `rsvps_insert_self` (writer) | `user_id = auth.uid()` and meetup visible |
| rsvps | `rsvps_delete_self` (writer) | `user_id = auth.uid()` |

No DELETE on meetups for anyone through the API (cancel is a status change).

Integrity triggers from Phase 1 back these up for every writer: future start, creator/attendee must be
a group member, cancelled is final and frozen, group/creator immutable, no RSVP to a cancelled or
started meetup (row locked against a concurrent cancel).

## 4. Home location

RLS filters rows, not columns. Any policy letting a member read a co-member's `users` row would also
expose `home_lat/home_lng`. So:

- `authenticated` gets `select (id, display_name)` on `users` only — column-level grant.
- `select home_lat …` or `select * from users` as any API role → `permission denied`.
- No view, function or policy in this slice reads `home_lat/home_lng`; nothing is derived from them.
- The access check additionally serialises every row every persona can read and searches it for all
  16 seeded home coordinate values and the column names.

## 5. Recursion and SECURITY DEFINER review

| Function | Why definer | Safeguards |
|---|---|---|
| `private.is_group_member(uuid)` | policies on other tables need membership without RLS on `group_memberships` hiding rows / recursing | `search_path = ''`, fully qualified, `stable`, returns only a boolean about the caller, schema not exposed by PostgREST, EXECUTE revoked from public |
| `private.shares_group_with(uuid)` | same, for co-member names | same |
| `public.tg_rsvps_integrity()` | must see the meetup/membership regardless of caller RLS | trigger-only (not RPC-callable), EXECUTE revoked, errors carry no meetup data |

No policy queries its own table, so there is no recursion. `rsvps` policies query `meetups`, whose
policy uses only the definer helper.

## 6. Error-message leakage

- A non-member's RSVP to a real meetup and an RSVP to a made-up id raise the **same** error
  (`meetup not found`). Found during Phase 2 review: the Phase 1 trigger originally said "only group
  members can RSVP", which would have confirmed that a meetup id exists. Fixed before first push.
- Reads by outsiders return empty sets, not errors.
- Non-creator cancel affects 0 rows rather than erroring; the endpoint must map 0 rows to the same
  "not found" response as an invisible meetup (Phase 4).
- Known: an outsider creating a meetup in a group they are not in gets "creator must be a member of
  the group". The endpoint will map this to a generic response.

## 7. Verification

| Check | Where | Result |
|---|---|---|
| `npm run check:migrations -w tests` | PGlite, offline | 42/42 |
| `npm run check:access -w tests` | PGlite, offline | 77/77 |
| `npm run check:access:remote -w tests` | **hosted Supabase (PG 17.11)**, one transaction rolled back | 77/77 |

Personas covered: anon; outsider (Taylor); group-scoped outsiders (Morgan, Quinn); member not RSVP'd
(Sam); member RSVP'd (Jordan); creator (Avery, Sam); multi-group (Riley).

## 8. Known limitations / follow-ups

- **Co-member names**: a member can read display names of everyone in their groups, not just
  attendees. Display names are already visible in every attendee list; judged acceptable.
- **Endpoint holds owner credentials** (`DATABASE_URL`, server-only). It immediately drops to
  `meetup_writer` per transaction. Hardening: a dedicated login role whose only membership is
  `meetup_writer`.
- **PostgREST path** (real JWTs through the API) is verified in Phase 5 once the anon key is in `.env`.
- **Session log contains the database password** (it was pasted into a tracked file and read during the
  session). Rotate the database password before submitting the log.
