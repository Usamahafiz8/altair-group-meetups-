# Decisions

## 1. Product decision: exact meeting point for every group member

**Question (spec §7):** should members who have not RSVP'd see the exact meeting point, or only an
approximate area until they RSVP?

**Decision: every member of the group sees the exact point and the place name. Outsiders see nothing.**

### Why, from the people using it

- **Who sees it is already narrow.** A meetup is visible only to the members of one small neighbourhood
  group, people who already walk together. The threat the approximate area defends against is a stranger
  learning where a walk will be; strangers are already excluded by the group boundary, which is enforced
  in Postgres and tested.
- **It is a public place, by definition.** The spec requires meeting points to be public places ("North
  gate, Linden Park"). The private location in this app is the home, and that is locked down separately
  (§8, below).
- **Deciding whether to go needs the place.** A dog owner decides by distance, terrain and whether their
  dog copes with the route: an older dog, a reactive dog, a buggy, a mobility issue. Hiding the place
  until after the commitment inverts the decision: RSVP first, find out it's 3 km away across a busy road,
  withdraw. That churn also misleads the organiser about who is coming.
- **The gate would not hold.** Any member can RSVP, read the exact point, and withdraw a second later —
  the spec requires withdraw to work. An approximate area would mostly stop honest members, not a curious
  one. Making it hold needs more than visibility rules (see pushback 1).
- **Attendance is the signal worth protecting, and it stays protected:** the attendee list is
  group-only, display names only, never a home location.

### What would change my mind

Groups that anyone can join without approval, groups of hundreds, or meetups for vulnerable members
(solo walkers at dawn). Then I would switch to an approximate area — and the design makes that a contained
change:

- the contract already models the meeting point as `{ kind: "exact", … }`; an `approximate` variant
  (`center`, `radiusM`, coarse label) slots in beside it and the app's map already renders by `kind`;
- the server builds the meeting point in one function (`toSummary` in `server/src/queries.ts`);
- the exact columns would get the same treatment the home location already has: column grants revoked
  from the API roles, exposed only through a definer function that returns the approximate area unless the
  caller has RSVP'd;
- the area would be **snapped to a grid** (cell centre, radius covering the cell, ≥ 300 m) rather than a
  random offset per meetup — see pushback 4.

### How it is enforced and tested

- Visibility is row-level security on `meetups` (members of `group_id` only), reached either through the
  endpoint server (running as role `authenticated` under RLS) or PostgREST directly. Both are tested.
- `tests/api/privacy.test.ts`: the map data is the same exact point before and after RSVP; outsiders get
  404 with no coordinates; list and detail responses carry exactly the contract's keys.
- Multi-group (Riley): `tests/api/access-matrix.test.ts` checks the map data per meetup against Riley's
  own status and against another member of that group.

## 2. Home location (spec §8)

- `users.home_lat/home_lng` are never granted to any API role: column-level grants expose only
  `(id, display_name)`. RLS cannot hide columns, so this is the mechanism that matters.
- No view, function, policy, endpoint or app file references them; a static test enforces this for
  `server/src`, `app/src`, `packages/contract/src` and every migration after the starter.
- Outbound responses are parsed with the contract's strip schemas: a field the contract does not name
  cannot leave the server (verified by planting `home_lat` in the response builder: the static audit fails,
  and the field never reaches the client).
- The app requests no location permission and never reads the device position; nothing is derived from a
  home (no "distance from home").
- Every API test suite scans every response body for the column names and all 16 seeded coordinates.

## 3. One thing I would refuse to build first

**Live location sharing during a walk (the brief's bonus b), before the privacy controls that make it
safe.**

A walk starts and ends at people's front doors. A live trail broadcast from the moment someone taps
"start" is a home location with extra steps — exactly what §8 forbids this feature to expose. I would
refuse to ship the live map until these exist, and build them first:

1. explicit per-walk opt-in, off by default, visible indicator while sharing;
2. sharing begins only after the walker is a set distance from where they started (and stops before
   they get back), so the first and last few hundred metres never leave the phone;
3. positions are broadcast to the meetup's attendees only, never persisted (no history, no replay);
4. the server, not the client, decides who may subscribe to a meetup's channel.

## 4. Pushback on the spec

1. **"Approximate until RSVP" is undermined by "withdraw any time".** Any member can RSVP → read → withdraw.
   If the approximate option is ever chosen, decide what withdrawing does to a revealed location (it
   cannot be un-revealed), and consider making the reveal visible to the organiser or rate-limiting
   RSVP/withdraw cycles. Otherwise the gate is mostly theatre.
2. **Free-text titles defeat place-name withholding.** "Linden Park north gate loop" in the title leaks the
   place the approximate option is meant to hide. Validation cannot catch it; it needs product guidance or
   a title rule.
3. **Withdrawing from a meetup that has already started is unspecified.** I allowed it (it only removes the
   caller's own row and keeps attendance honest), and said so in the code and tests.
4. **"Offset by a fixed amount stored per meetup" leaks over time.** Several meetups at the same park, each
   with a different random offset, produce circles whose intersection narrows down the exact spot. Grid
   snapping does not have this problem: the same place always maps to the same cell.
5. **Cancelled meetups keep their exact point visible forever.** Fine for this slice, but a cancelled or
   past walk has no reason to keep advertising a meeting place; I'd hide or expire it.
6. **The creator leaving the group is unspecified.** Their meetups stay visible to the group with the
   organiser shown as "Former member". Under the current policies they also lose the ability to see or
   cancel them (an UPDATE must also pass the SELECT policy, which requires membership). Membership changes
   are out of scope, so this follows from the policies but is not covered by a test.

## 5. Architecture decisions

| Decision | Why |
|---|---|
| Hosted Supabase (free tier) | Docker not available on the dev machine; migrations via `supabase db push --db-url` over the Session pooler (direct host is IPv6-only) |
| Node + Hono server over Edge Functions | Shares one Zod module with the app without Deno import planning (the README's own recommendation) |
| App role (`authenticated`) is read-only; writes only via `meetup_writer` | Makes "every write goes through the Zod endpoint" a database guarantee, not a convention |
| Server runs every query as the member (`set_config('role')` + verified claims) | RLS remains the authority for both reads and writes; no service-role writes |
| Reads also through the server | One contract for everything the app consumes; outbound strip parse is a second privacy layer |
| Integrity rules as triggers (future start, cancel is final, no RSVP to cancelled/started, membership) | Must hold for every writer, including scripts; RLS decides who, triggers decide what is valid |
| JWT verified locally against JWKS (ES256) | No auth round trip per request; role/issuer/audience/expiry all checked |
| `viewer` flags computed on the server | The app shows buttons from them; it never re-derives a permission rule |
| One shared form, one API client, two hooks in the app | Every screen gets identical validation, error handling, loading/empty/error states |
