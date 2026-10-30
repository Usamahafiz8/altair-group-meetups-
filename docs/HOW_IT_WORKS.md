# How it works

One user action at a time, from the app to the database and back. For setup see the
[README](../README.md); for the reasoning behind the design see [DECISIONS.md](DECISIONS.md).

## 1. The big picture

```
 ┌──────────────── Android app (Expo) ────────────────┐
 │ screens ── useResource / useAction ── lib/api.ts   │  only decides which buttons to show
 └───────┬───────────────────────────────┬────────────┘
         │ sign-in only                   │ every read + write: HTTPS, Bearer <member JWT>
         ▼                                ▼
 ┌─ Supabase Auth ─┐            ┌──────── server (Node + Hono) ─────────┐
 │ issues ES256    │◀─ JWKS ────│ 1 verify JWT   (auth.ts)              │
 │ access tokens   │            │ 2 validate     (@altair/contract Zod) │  decides what is valid
 └─────────────────┘            │ 3 run as member (db.ts asMember)      │
                                │ 4 map errors   (errors.ts)            │
                                │ 5 strip + send (contract schemas)     │
                                └──────────────────┬────────────────────┘
                                                   │ one transaction per request,
                                                   │ role authenticated | meetup_writer
                                                   ▼
                                ┌──────── Supabase Postgres ────────────┐
                                │ RLS policies     who may see / write  │  decides who
                                │ column grants    home location hidden │
                                │ triggers         what a valid row is  │
                                └───────────────────────────────────────┘
```

**Where each rule lives:**

| Rule | Enforced by |
|---|---|
| Outsiders see nothing; members see their group | RLS policies (`meetups_select_member`, `rsvps_select_member`, …) |
| Only the creator can cancel / edit | RLS `meetups_update_creator` |
| RSVP only for yourself | `rsvps_insert_self` + `user_id` defaults to `auth.uid()` and is not a writable column |
| Writes only through the Zod endpoint | the app's role `authenticated` has **no write grants**; only `meetup_writer` does |
| Home location never leaves | column grants: API roles may read `users(id, display_name)` only |
| Start in the future, cancel is final, no RSVP to cancelled/started, creator is a member | triggers (hold for every writer) |
| Title / place / coordinates / dates are well formed | shared Zod contract (server and app form) |

## 2. The pieces

| Piece | Path | Job |
|---|---|---|
| Migrations | `supabase/migrations/` | starter tables, `meetups`, `rsvps`, roles, grants, RLS, triggers |
| Seed | `supabase/seed.sql` | 8 accounts, 2 groups, 3 reference meetups |
| Contract | `packages/contract/src/` | Zod request/response schemas, error codes, route paths |
| Server | `server/src/` | `auth.ts` verify · `app.ts` routes · `db.ts` run-as-member · `queries.ts` SQL · `errors.ts` |
| App | `app/src/` | `lib/api.ts` HTTP client · `lib/hooks.ts` loading/actions · `app/` screens · `components/` |
| Tests | `tests/`, `packages/contract/test/` | offline DB checks, hosted API/access/privacy suites |

### Data model

```
auth.users ─1:1─ users (id, display_name, home_lat*, home_lng*)      * never readable by API roles
                   │
groups ──< group_memberships >── users
  │
  └──< meetups (group_id, created_by, title, starts_at, meeting_point_name/lat/lng,
                status scheduled|cancelled, cancelled_at)
            │
            └──< rsvps (meetup_id, user_id)   unique (meetup_id, user_id)
```

## 3. Sign in

1. `sign-in.tsx` validates email + password with Zod, then calls `supabase.auth.signInWithPassword`
   (straight to Supabase Auth, the only call that doesn't go through the server).
2. The session (access + refresh token) is stored in AsyncStorage; `lib/auth.tsx` listens for changes.
3. `_layout.tsx` uses `Stack.Protected`: signed out → only the sign-in screen exists; signed in → the
   app screens. Tokens refresh automatically while the app is in the foreground.

## 4. Opening a group's meetup list (a read)

**App.** `index.tsx` calls `useResource('groups', api.myGroups)`, then for the chosen group
`useResource('group:<id>', () => api.groupMeetups(id))`. `useResource` loads whenever the screen gains
focus, keeps old data visible while refreshing, and ignores out-of-date responses.
`api.ts → request()` adds `Authorization: Bearer <token>`, a 15 s timeout, and parses the reply with
`ListMeetupsResponse`.

**Server.** `GET /groups/:groupId/meetups`:
1. `auth.ts` verifies the token against the project's public keys (JWKS): signature, issuer, audience,
   expiry, `role = authenticated`, `sub` is a UUID. Anything else → **401**.
2. `GroupIdParams` checks the id is a UUID → otherwise **400**.
3. `asMember(…, 'authenticated', …)` opens a transaction and runs
   `set_config('role','authenticated')` + `set_config('request.jwt.claims', <claims>)`. From here on
   `auth.uid()` is the member and every RLS policy applies, exactly as for the REST API.
4. `queries.groupMeetups` runs **one** query: `groups` left-joined to `meetups`. RLS shows the group row
   only to its members, so:
   - no row → not your group → **404** (same as a group that does not exist);
   - one row with no meetup → your group, empty list;
   - otherwise the meetups, soonest first.
5. `toSummary` shapes each row and computes the `viewer` flags (`isCreator`, `hasRsvp`, `canRsvp`,
   `canCancel`, `canEdit`).
6. `send()` parses the result with `ListMeetupsResponse` (strips anything not in the contract), responds,
   and logs one line: method, path, status, ms, member id.

**App.** Renders the list; loading, empty and error states come from the shared components.

## 5. Meetup detail and the map

`GET /meetups/:id` works the same way, with **one** query that returns the meetup plus its attendees as a
JSON array (`display_name` only, joined from `users` through the column grant). The response's
`meetingPoint` is `{ kind: 'exact', name, lat, lng }`: every group member sees the exact point (the
product decision). `MeetupMap` renders exactly what the server sent: a pin at that point. The app never
receives a home location, so it cannot show one.

## 6. RSVP (a write)

**App.** `meetups/[id]/index.tsx` → `useAction(…).run('rsvp')` (ignores double taps) → `api.rsvp(id)` →
`POST /meetups/:id/rsvp` with no body.

**Server.**
1. Verify the JWT; validate `MeetupIdParams` and `EmptyBody` (a body such as `{ "userId": … }` → **400**:
   you can only RSVP for yourself).
2. `asMember(…, 'meetup_writer', …)`: the write role, still with the member's identity.
3. `insert into rsvps (meetup_id) values ($1) on conflict (meetup_id, user_id) do nothing`.
   `user_id` is not in the column list; it defaults to `auth.uid()`.
4. In Postgres, in order:
   - trigger `tg_rsvps_integrity` locks the meetup row (`FOR SHARE`) and checks: meetup exists and
     the caller is a member (else "meetup not found" → **404**, identical for outsiders and unknown ids),
     not cancelled (→ **409** `meetup_cancelled`), not started (→ **409** `meetup_started`);
   - RLS `rsvps_insert_self`: `user_id = auth.uid()` and the meetup is visible;
   - the unique constraint makes a repeat RSVP a no-op (**200**, still one row).
5. Commit → `{ meetupId, attending: true }`.

**App.** Re-fetches the detail, so the badge, "You're going", the attendee list and the map all show the
server's current view. If the RSVP failed because the meetup changed meanwhile (cancelled, started, gone),
the screen reloads it.

**Race with a cancel.** The `FOR SHARE` lock conflicts with the cancel's row lock, so an RSVP and a cancel
are serialised: either the RSVP lands first, or it sees `cancelled`. Timestamps use `clock_timestamp()`,
so an accepted RSVP is always stamped before the cancel.

Withdraw (`DELETE /meetups/:id/rsvp`) deletes only `where user_id = <member>`; RLS `rsvps_delete_self`
enforces the same. It works on cancelled meetups.

## 7. Cancel (creator only)

`POST /meetups/:id/cancel` runs `update meetups set status = 'cancelled' where id = $1 and status = 'scheduled'`
as `meetup_writer`. RLS `meetups_update_creator` (`created_by = auth.uid()`) means a non-creator's update
touches **0 rows**. The server then explains the 0 rows without leaking anything:

| Caller | Response |
|---|---|
| can't see the meetup (outsider) | **404**, same body as a random id |
| member, not the creator | **403** `forbidden` (they can already see who created it) |
| creator, already cancelled | **200**, no-op |

The `tg_meetups_integrity` trigger stamps `cancelled_at` and freezes the row: no reopen, no edits.
Cancelled meetups stay visible to the group, marked, with attendees kept.

Create (`POST /meetups`) and edit (`PATCH /meetups/:id`, bonus) follow the same path: Zod first, then the
insert/update as `meetup_writer`, with `created_by` defaulting to `auth.uid()` and the triggers enforcing
a future start.

## 8. What an outsider gets

Taylor (in no group):

- **App:** "You're not in a walking group yet"; a direct link to a meetup shows "This meetup isn't available".
- **Server:** every read is **404** with the same body as for a random id; every write is **404**.
- **REST API directly** (bypassing the app and server): `meetups` → `[]`, `rsvps` → `[]`,
  `users?select=home_lat` → **403**, any insert/update/delete → **403**.

## 9. Why a home location can never leave

1. **Database:** API roles are granted `select (id, display_name)` on `users`, nothing else. Asking for
   `home_lat`, `*`, or an embedded `users(*)` → permission denied.
2. **Code:** nothing in `server/src`, `app/src`, `packages/contract/src` or the post-starter migrations
   mentions the columns (a test checks this).
3. **Output:** responses are parsed with the contract's schemas, which drop any unknown field.
4. **App:** never asks for location permission; nothing is derived from a home.

## 10. Errors, end to end

| Origin | Server response | App shows |
|---|---|---|
| no / bad / expired token | 401 `unauthorized` | signs out, sign-in screen says the session expired |
| fails the contract | 400 `validation_error` + per-field `issues` | message under the matching field |
| not visible / doesn't exist | 404 `not_found` | "This meetup isn't available" |
| member, not creator | 403 `forbidden` | message; buttons were hidden anyway |
| cancelled / started | 409 `meetup_cancelled` / `meetup_started` | message, detail reloads |
| server unreachable | (no response) | "Can't reach the meetups server…" + Try again |
| too slow (> 15 s) | (aborted) | "The server took too long…" |
| anything unexpected | 500 `internal`, no internals | generic message |

## 11. How the tests map onto this

| Layer | Proven by |
|---|---|
| Constraints, triggers, migrations from empty | `tests/offline/migrations.check.mjs` (in-process Postgres) |
| RLS + grants per persona | `tests/offline/access.check.mjs` (offline and on the hosted DB, rolled back) |
| REST API directly with real tokens | `tests/offline/postgrest.check.mjs` |
| Contract rules | `packages/contract/test/contract.test.ts` |
| Token verification | `tests/api/auth.test.ts` |
| Run-as-member really switches role | `tests/api/db.test.ts` |
| Every endpoint, four identities, multi-group map data | `tests/api/endpoints.test.ts`, `access-matrix.test.ts` |
| Map + home-location privacy | `tests/api/privacy.test.ts` |
| Duplicate RSVPs, RSVP vs cancel | `tests/api/concurrency.test.ts` |
