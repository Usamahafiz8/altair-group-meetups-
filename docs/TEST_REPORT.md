# Test Report

Run on 2026-10-30 against the hosted Supabase project (Postgres 17.11, eu-north-1), Windows 10, Node 24.20.

## How to run

```bash
npm install
npm test                    # contract unit tests + offline DB checks + hosted API/access suites
npm run test:hosted-checks  # access matrix on the hosted DB (rolled back) + raw REST API smoke run
npm run typecheck           # contract, server, tests, app
```

`npm test` needs `.env` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`). The hosted suites create
their own `[test]`-titled meetups as the database owner and delete them before and after each file; the
seed meetups are only read. After the run the database held exactly the three seed meetups (2/1/0 RSVPs).

## Results

| Suite | Where it runs | Tests | Result |
|---|---|---|---|
| `packages/contract/test/contract.test.ts` | unit | 62 | pass |
| `tests/offline/migrations.check.mjs` | PGlite (in-process Postgres) | 44 | pass |
| `tests/offline/access.check.mjs` | PGlite | 77 | pass |
| `tests/api/access-matrix.test.ts` | hosted DB + REST API | 41 | pass |
| `tests/api/endpoints.test.ts` | hosted DB | 44 | pass |
| `tests/api/auth.test.ts` | unit (local ES256 keys) | 14 | pass |
| `tests/api/db.test.ts` | hosted DB | 6 | pass |
| `tests/api/concurrency.test.ts` | hosted DB | 3 | pass |
| `tests/api/privacy.test.ts` | hosted DB + static source audit | 9 | pass |
| `access.check.mjs --remote` | hosted DB, one rolled-back transaction | 77 | pass |
| `tests/offline/postgrest.check.mjs` | hosted REST API, real JWTs | 28 | pass |
| **Total** | | **405** | **all pass** |

Counts are executed tests (parameterised cases counted individually). `npm test` exit 0 (vitest: 6 files,
117 tests, ~200 s, dominated by round trips to the hosted region); `npm run test:hosted-checks` exit 0.
Final Phase 8 runs were repeated back to back from a fresh `git clone`. One hosted-check run hit a
transient `read ECONNRESET` from the pooler mid-transaction; the immediate re-run passed 77/77.

## Coverage of the required scenarios (brief Part 1, spec §4–8)

The four identities are Taylor (outsider), Sam (member, not RSVP'd), Jordan (member, RSVP'd) and
Avery (creator), on a fresh fixture shaped like "Saturday morning loop".

| Requirement | Where |
|---|---|
| Outsider cannot read meetup (list, detail, REST) — 404 identical to a random id | access-matrix, endpoints, postgrest |
| Outsider cannot read attendees or meeting point (no names/coords in any payload) | access-matrix |
| Member / RSVP'd / creator read meetup, attendees (display names), exact point | access-matrix (endpoint **and** REST) |
| Users cannot access another group's data | access-matrix (Quinn, Sam, Casey), endpoints (Morgan) |
| **Multi-group (Riley)**: exactly 2 groups; map data per meetup by Riley's own status; equals a peer's view; RSVP to one meetup changes nothing for others; Riley bridging groups opens nothing | access-matrix |
| Creator-only cancel: Sam 403, Jordan 403, Taylor 404, Avery 200; REST cancel 403 for all four | access-matrix, endpoints |
| Cancelled stays visible + marked, attendees kept, outsider still blind | access-matrix, endpoints |
| Cancelled cannot be reopened (edit 409, REST PATCH 403, status unchanged) | access-matrix, endpoints, offline |
| RSVP valid member; repeat RSVP 200 with one row (also 8 in parallel) | endpoints, concurrency |
| Outsider / other-group RSVP → 404, nothing written | endpoints |
| No RSVP to cancelled (409) / started (409, set up by owner) | access-matrix, endpoints |
| Withdraw own; withdraw after cancel; cannot withdraw others; outsider 404 | access-matrix, endpoints |
| Server rejects past (and equal-to-now) start on create | contract, endpoints, offline |
| Home location never returned: column grants (403 on `home_lat`, `*`, embedded `users(*)`), every response body scanned for keys + all 16 seeded values | access-matrix, endpoints, postgrest, offline |
| App role cannot write directly; writes only through the Zod endpoint | access-matrix, postgrest, offline |
| Each request runs as the API role with the member's identity, for every query of a handler; role reset afterwards | db |
| Map data identical before/after RSVP; responses carry exactly the contract keys; no home-location reference in server / app / contract / migrations; app never requests device location | privacy |
| Control characters, NUL and unpaired surrogates rejected with 400, not 500 | contract, endpoints |
| Group with no meetups: member gets an empty list, others 404 | endpoints |
| Bonus edit: creator-only, future start, not cancelled, not started | endpoints |

## Defects found by the tests (and fixed)

| # | Found by | Defect | Fix |
|---|---|---|---|
| 1 | concurrency (random race) | `cancelled_at` / `rsvps.created_at` used `now()` (transaction **start**). An RSVP accepted before a cancel took effect could carry a later timestamp than the cancel. Access was never wrong; the audit trail was. Confirmed with a deterministic replay before fixing. | Migration `20261030130000_event_timestamps.sql` (`clock_timestamp()`); the replay is now a permanent test |
| 2 | mutation check, Phase 4 | End-to-end "anon key → 401" passed even with the role check deleted (the anon key fails on signature first) | Injectable key set + local-key unit tests; the mutation now fails 3 tests |
| 3 | Phase 2 review | Non-member RSVP error differed from unknown-id error (existence oracle) | Same `meetup not found` for both |
| 4 | clean-clone run (Phase 8) | "sign-in failed for riley": every test file signed all personas in again, so back-to-back full runs hit Supabase Auth's sign-in rate limit. The helper also dropped the HTTP status, so it could not be confirmed afterwards | One sign-in per persona per run (Vitest globalSetup) + backoff retry; failures now report status and error code |
| 5 | fuzzing (Phase 8) | NUL byte in title / place name returned **500** (Postgres text cannot store 0x00); an unpaired surrogate was accepted and stored as U+FFFD | Contract rejects control characters and unpaired surrogates; the server maps 22021 / 22P05 to 400 as a backstop |
| 7 | full suite after real app use | Tests assumed the shared hosted DB held exactly the seed rows; a meetup and RSVPs created in the app made "Sam sees exactly 2 meetups" fail, although access control was correct | Persona-role tests (incl. Riley's multi-group case, now with a distinct point per meetup) use fresh fixtures; seed reads assert access properties (only the caller's groups, seed rows present, soonest first). Suite re-run green with the extra app data present |
| 6 | full suite (Phase 8) | A latency optimisation pipelined the per-request role setup lazily. postgres.js sends a query when it is awaited, so handlers ran their first query **as the owner with no claims** (RLS bypassed). 28 tests failed, including outsiders receiving data | `.execute()` sends the role setup first. `db.test.ts` had **not** caught it (its handler returned the query instead of awaiting it); a new handler-shaped test fails on the broken version |

## Mutation checks (tests fail when the rule is broken)

| Mutation | Tests failing |
|---|---|
| Title max 80 → 81 | 1 (contract) |
| Create request not strict (accepts `createdBy`) | 4 (contract) |
| Verifier ignores `role` | 3 (auth) |
| Non-creator cancel returns 404 instead of 403 | 1 (endpoints) |
| Planted `home_lat` in the response builder | 1 (privacy static audit); the strip parse kept it off the wire |
| Role setup pipelined without `.execute()` | 2 (db, handler-shaped tests) |

## Not covered by automation

- The React Native screens and map (Phases 6–7): manual verification, recorded in `QA_REPORT.md`.
- Load testing beyond the 30-concurrent-request probe in `QA_REPORT.md`.
