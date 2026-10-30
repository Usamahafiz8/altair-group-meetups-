# Security Review

Status: Phase 7 (database, endpoint layer, app, location privacy). Product decision and pushback:
[DECISIONS.md](DECISIONS.md).

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
| `service_role` | **not used by this slice** (the key is in no config, app or test) | Supabase default (bypasses RLS) | Supabase default |
| `postgres` | migrations; test fixtures/cleanup; the endpoint's connection, which drops to `meetup_writer` per transaction | owner | owner |

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
| `npm run check:postgrest -w tests` | **hosted REST API with real seed-account JWTs** (anon, outsider, member, multi-group; home-location probes incl. embedded `users(*)`; direct REST writes incl. creator cancel → 403; `private` schema not exposed) | 28/28 |

Personas covered: anon; outsider (Taylor); group-scoped outsiders (Morgan, Quinn); member not RSVP'd
(Sam); member RSVP'd (Jordan); creator (Avery, Sam); multi-group (Riley).

## 8. Endpoint layer (Phase 4)

- **Authentication:** ES256 access tokens verified locally against the project JWKS (signature, issuer,
  audience, expiry). `role` must be `authenticated` and `sub` a UUID: an anon key, a service-role token or
  a self-made `role: meetup_writer` token is rejected. Unit-tested with a local key pair (14 tests); a
  mutation removing the role check fails 3 of them. With the real keys the legacy HS256 anon key already
  fails on its signature, so the end-to-end anon test alone did not prove the role rule (caught in review).
- **Authorization stays in Postgres:** every request runs as `authenticated` (reads) or `meetup_writer`
  (writes) with the verified claims. A test asserts `current_user` / `auth.uid()` inside the transaction
  and that the pooled connection is back to the owner afterwards, also after a failed query.
- **No trusted ids from the body:** strict schemas reject `createdBy` / `userId` / `status`; the
  `meetup_writer` grants do not include `created_by` / `user_id`, which default to `auth.uid()`.
- **Errors:** outsiders always get the same 404 body as for a random id (asserted for detail, list,
  cancel, RSVP); `forbidden` goes only to members who can already see the meetup. 500s carry no internals.
- **Output:** every response is re-parsed with the contract's strip schema; the endpoint suite scans every
  response body (more than 50) for home-location keys and the 16 seeded values.
- **Input limits:** 16 KB body limit; malformed JSON is a 400.
- **Logging:** method, path, status, duration, member id only.

## 9. App and location privacy (Phases 6–7)

- **Secrets:** the app bundles only `EXPO_PUBLIC_SUPABASE_URL`, the anon key and the API URL. A built
  Android bundle was searched for the service-role key, DB password and DB URL: absent.
- **Meeting point:** exact for every group member (decision in DECISIONS.md §1); RLS limits it to the
  group. Tests: same exact point before/after RSVP; outsiders get 404 with no coordinates; list/detail
  responses carry exactly the contract's keys (`tests/api/privacy.test.ts`).
- **Home location:** column grants (§4); no reference in `server/src`, `app/src`, `packages/contract/src`
  or any migration after the starter (static test); outbound strip parse; the app requests no location
  permission and never reads the device position (static test). Mutation: planting `home_lat` in the
  response builder fails the static audit, and the strip parse keeps it off the wire.
- **App trust model:** the app only decides which buttons to show, from server-computed `viewer` flags;
  every rule is enforced by the server and Postgres. A 401 signs the user out locally.

## 10. Known limitations / follow-ups

- **Co-member names**: a member can read display names of everyone in their groups, not just
  attendees. Display names are already visible in every attendee list; judged acceptable.
- **Endpoint holds owner credentials** (`DATABASE_URL`, server-only). It immediately drops to
  `meetup_writer` per transaction. Hardening: a dedicated login role whose only membership is
  `meetup_writer`.
- **Session log contains the database password** (it was pasted into a tracked file and read during the
  session). Rotate the database password before submitting the log.
