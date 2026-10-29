# Project Analysis

Sources inspected: `altair-feature-spec.html`, `altair-schema-starter.zip` (identical to the extracted
`starter/` folder, verified with `diff -r`), `altair-seed-data.sql`, and the challenge brief PDF.

## Scope

One slice of a dog-owner community app: **group meetups, RSVPs, and the meetup map**. Database +
write endpoints + React Native app (one platform). Web client, sign-up, group management,
notifications/chat, recurring meetups and profile editing are out of scope.

## Functional requirements

| Area | Requirement | Source |
|---|---|---|
| Create meetup | Any member of a group can create one in that group | spec §4 |
| Fields | Group (creator must be member); title 1–80 chars after trim; start time with TZ, strictly in the future at create; meeting point name 1–120 chars + valid lat/lng; creator set by server from session; status `scheduled`/`cancelled` | spec §4 |
| List | Members list a group's meetups, soonest first; open detail | spec §4 |
| Cancel | Creator only, enforced server-side, tested. Final (no reopen). Cancelled stays visible, marked | spec §4, brief P1 |
| RSVP | Group member, for self only; one per member per meetup; repeat RSVP is not a user-visible error | spec §5 |
| RSVP blocks | No RSVP to a cancelled or already-started meetup | spec §5, brief P1 |
| Withdraw | Member withdraws own RSVP; allowed on cancelled meetups | spec §4–5 |
| Attendees | Detail shows display names of RSVP'd members | spec §5 |
| My groups | Read-only; returns only the caller's groups | spec §4 |
| Bonus (a) | Creator-only edit (title, start, meeting point); new start must be future; cancelled not editable; RLS + test + screen | spec §4, brief bonus |
| Bonus (b) | Realtime broadcast positions, animated avatars, interpolation, viewport culling, one-page latency/battery/load-test note | brief bonus |

## Security / access requirements (spec §6)

| | Meetup | Attendees | Meeting point | Cancel |
|---|---|---|---|---|
| Outsider | No | No | No | No |
| Member, not RSVP'd | Yes | Yes | **Open decision** | No |
| Member, RSVP'd | Yes | Yes | Exact | No |
| Creator | Yes | Yes | Exact | Yes |

- "No" = never leaves the server: not in list, detail, attendee query, map payload, **or error message**.
- Enforced in DB or on server, never by hiding in the app.
- Per-meetup evaluation: an RSVP to one meetup grants nothing for another (multi-group case: Riley).
- All access requires a signed-in user; anonymous access denied.

## Location privacy requirements

- **Home location** (`users.home_lat/home_lng`): never in any response, view, function, attendee list,
  map payload, or error; never on the map; nothing derived from it (e.g. distance from home).
- **Meeting point (open decision, spec §7):** if *approximate*: server-computed area, radius ≥ 300 m,
  centre ≠ exact point, exact coords **and place name** withheld until RSVP; view updates after RSVP
  without reinstall/sign-out. If *exact*: place name shown.

## API / contract requirements (spec §10, README §4)

- Writes (create, cancel, RSVP, withdraw, edit-bonus) go through an endpoint layer (Edge Function or
  small TS server) that validates with **shared Zod schemas**. Postgres functions allowed *behind* it;
  app → table/RPC writes directly do not qualify; SQL checks alone do not qualify.
- Reads may query Supabase directly under RLS with the user's session, or go through endpoints.
- Zod schemas in one place imported by both server and app; one Zod major on both sides.
- Server rejects invalid input with a clear error, regardless of the app.
- Sign-in directly via Supabase Auth. Service-role key never in the app.

## Mobile requirements (spec §9, brief P2)

- Sign-in with seed accounts.
- Group meetup list with loading / empty / error states; group chosen any simple way.
- Create meetup: title, start time, meeting point (name + map pick or typed coords), server errors shown.
- Detail: title, time, status, attendee list, map, RSVP action, creator-only cancel.
- Withdraw UI optional (endpoint + test required). Edit UI only for bonus.
- Map renders exactly what the server allows; updates after RSVP; loading/empty/error states.

## Mandatory tests (brief P1)

Four identities — outsider, member not RSVP'd, member RSVP'd, creator — covering:
creator-only cancel; no RSVP to a cancelled meetup; no RSVP to a started meetup (setup may write as DB
owner); the multi-group case **including what the map data returns**. Plus withdraw (spec §9).

## Part 3 deliverables (brief)

Note + run instructions (clean start); 10–15 min voice-over recording (live run, map before/after RSVP,
outsider blocked); exported AI session log; git repo with history.

## Ambiguities and working assumptions

| # | Ambiguity | Working assumption (to confirm in DECISIONS.md) |
|---|---|---|
| A1 | Withdraw after a meetup has started — not specified | Allowed (withdrawal only removes the caller's own data; no harm) |
| A2 | Cancelling an already-cancelled meetup | Idempotent success for the creator; still "not found" for others |
| A3 | Outsider requesting a meetup — 403 or 404? | 404 "not found" for both non-existent and not-visible, so errors leak nothing |
| A4 | "Current" start time | Rejected: `starts_at` must be strictly greater than server `now()` |
| A5 | Edit of start time on a meetup that has already started | Rejected (bonus only) |
| A6 | Should an RSVP still count if its meetup gets edited? | Yes; RSVPs survive edits |
| A7 | Meetup visibility if the creator later leaves the group | Out of scope (membership management is out of scope) |
| A8 | Free-text title may itself name the meeting place | Pushback item; not enforceable by validation |
| A9 | Group-membership check in a meetup's group at RSVP/withdraw time | RSVP requires current membership; withdraw requires only owning the RSVP |
