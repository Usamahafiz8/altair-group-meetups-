# QA Report

## Phase 6 — app, manual run on the Android emulator (2026-10-30)

Environment: AVD `altair_pixel` (Pixel 7, Android 15, google_apis x86_64), Expo Go 58.0.5, Metro via
`npm run app`, API via `npm run server`, hosted Supabase. Driven with `adb` taps and checked against the
UI hierarchy and screenshots.

| # | Scenario | Result |
|---|---|---|
| 1 | Sign in, empty form | "Enter a valid email address", "Enter your password" under the fields |
| 2 | Sign in, wrong password | "Email or password is incorrect." |
| 3 | Sign in as Sam | List of Maple meetups, soonest first, place + attendee count |
| 4 | Session persists across app restart | Still signed in after reopening |
| 5 | Detail as Sam (member, not RSVP'd) | Title, time, organiser, place name, Google map with pin at the exact point, RSVP button, attendees Jordan + Riley |
| 6 | RSVP | "You're going" badge + notice, Withdraw button, attendees 3 incl. "Sam Okafor (you)" |
| 7 | Withdraw | Back to RSVP button, 2 attendees |
| 8 | Back from detail | Returns to the list (refreshed on focus) |
| 9 | Create, empty submit | Error under title, place, latitude, longitude + "Please fix the highlighted fields." |
| 10 | Create, valid (map tap sets coordinates) | Field errors clear while typing; lands on the new meetup's detail; Back goes to the list, not the form |
| 11 | Creator view | "Organised by Sam Okafor (you)", Edit + Cancel shown, empty attendees "No one has RSVP'd yet." |
| 12 | Edit with no changes | "Nothing has changed." (no request sent) |
| 13 | Edit title | Saved, detail shows the new title |
| 14 | Cancel | Confirm dialog (Keep it / Cancel meetup); then "Cancelled" badge, "Cancelled on …", no RSVP/Edit/Cancel, "It no longer takes RSVPs."; list marks it Cancelled |
| 15 | Sign out | Confirmation dialog, back to sign-in |
| 16 | Taylor (outsider) | "You're not in a walking group yet" with Check again |
| 17 | Taylor deep-links to "Saturday morning loop" by id | "This meetup isn't available" — no title, place or attendees |
| 18 | Malformed meetup id in the link | "Meetup not found" (no request sent) |
| 19 | Riley (two groups) | Group picker with both groups; Maple shows "You're going" on Saturday loop; Riverside shows only its meetup |
| 20 | API server stopped | "Couldn't load this — Can't reach the meetups server…" with Try again |
| 21 | API back, Try again | Recovers and loads the list |

The meetup created during this run was deleted afterwards; the hosted DB holds only the seed data.

### Defects found in the run and fixed

| Defect | Fix |
|---|---|
| Group picker (horizontal ScrollView) stretched to fill the screen; chips floated mid-screen, list pushed down | `flexGrow: 0` on the picker |
| Validation messages started lowercase ("title must not be empty") | Capitalised in the form's error mapping (contract text unchanged) |
| Placeholders looked like filled-in values (e.g. "40.000000") | Prefixed with "e.g." |

Found while writing the screens (before the run):

| Defect | Fix |
|---|---|
| Two copies of React (19.3.0 pinned by the app, 19.3.1 pulled by libraries); RN's renderer requires 19.3.0 exactly | Root `overrides: { react: "19.3.0" }`, lockfile regenerated, one copy; all suites re-run green |
| Create screen read `action.error` right after `await run()`, which is the previous render's value, so a failed submit would have shown no error | `useAction.run` returns `{ ok, data } \| { ok, error }`; callers use the returned outcome |

### Observations (not app defects)

- First launch right after an emulator cold boot showed "runtime not ready: Cannot read property
  'EventEmitter' of undefined" while Android's System UI was itself not responding. Expo Go version
  matches SDK 58 (58.0.5); reload fixed it and it did not recur.
- Emulator keyboard input needed `hw.keyboard = yes` in the AVD config.
- One `uiautomator` dump right after a Back press listed the create form's fields although the screen
  showed the list (confirmed by screenshot and by the next Back exiting the app); later dumps were clean.

### Automated checks after the app changes

`npm test` green (contract 51, offline 44 + 77, hosted API 104); `npm run typecheck` green for contract,
server, tests and app; `expo export --platform android` bundles (3.9 MB Hermes); the bundle contains the
anon key and API URL only.

## Phase 8 — final QA from a clean start (2026-10-30)

### Clean-start run (README followed literally)

| Step | Result |
|---|---|
| `git clone` into an empty folder | no `.env` in the clone (correct); copying `.env` is the only manual step |
| `npm install` (from lockfile) | 92 s; exactly one `react@19.3.0`; runtime `zod@4.6.7` (Expo CLI's internal zod 3 is tooling only) |
| `npm run db:status` | works from the clone, reports up to date |
| README sign-in `curl` | `access_token` returned |
| `npm test`, `npm run test:hosted-checks`, `npm run typecheck` | all green (after the fixes below), run twice back to back |
| `npm run server` + `npm run app` from the clone | server healthy; Metro bundled 1,466 modules; app opened on the emulator with the saved session |
| `expo export --platform android` | 3.9 MB Hermes bundle; contains the anon key and API URL only |

**Not done: a from-zero database rebuild of this project.** I wrote a guarded reset (it aborted unless
the database held only this slice's objects and the 8 seed users), but the tool's safety check refused
to run a mass delete on the hosted database without the owner's explicit go-ahead. From-zero is covered
by: the very first `db push` (day 1) ran against a genuinely empty project, and the offline check applies
every migration and the seed to an empty Postgres on every `npm test`. To repeat it, point `.env` at a
new free project and run `npm run db:push`.

### Repository hygiene

| Check | Result |
|---|---|
| Secret scan of the **entire git history** (anon key, DB password, DB URL, project ref, any JWT) | none found; `.env.example` is the only tracked env file |
| `.env.example` | removed three variables nothing reads (incl. the service-role key) |
| `expo-doctor` | 20/20 checks passed |
| `npm audit` | 8 findings, all in Expo build tooling: `zod` < 4.6.6 nested inside `@expo/cli` (our runtime zod is 4.6.7, outside the range), `deepmerge` ≤ 4.3.1 via `@expo/config` (no patched release exists). `npm audit fix --force` would downgrade to Expo SDK 54 and break the app. Accepted, build-time only |

### Server robustness (fuzz, 22 hostile requests against the running server)

Array / null / 5,000-deep JSON, `__proto__` and `constructor` keys, NUL bytes, lone surrogates, numeric
strings, `1e400`, year 10000, SQL-shaped ids and dates, wrong content type, unknown method, 5,000-char id,
path traversal, 7 KB bearer token, `alg: none` token, `userId` in an RSVP body, array cancel body, empty
edit. **First run: 19/22**: NUL → 500 (×2) and a lone surrogate accepted. **After the fix: 22/22** clean
4xx envelopes, nothing written, zero server errors logged.

### Latency (dev machine → eu-north-1 pooler, raw round trip 177 ms)

| | before | after |
|---|---|---|
| `asMember` + trivial query | 921 ms (5 round trips) | 515 ms (3) |
| group list, sequential p50 | 1,504 ms | 573 ms |
| detail, sequential p50 | 1,156 ms | 531 ms |
| detail, 30 concurrent, p50 / p95 | 3,865 / 5,332 ms | 2,476 / 3,014 ms (queueing on the 10-connection pool) |

Changes: list and detail are one query each; the per-request role setup is pipelined with the first query;
prepared statements on (the Session pooler supports them; the server now refuses a Transaction-pooler
URL at startup with a clear message). The remaining cost is distance: a server deployed in the database's
region pays ~1 ms per round trip instead of 177 ms.

### Defects found in Phase 8 (all fixed, all regression-tested)

1. Test harness hit Supabase Auth's sign-in rate limit on back-to-back runs → one sign-in per run.
2. NUL / control characters → 500; unpaired surrogates stored as U+FFFD → contract rejects them, server backstop.
3. **Security regression introduced by my own optimisation and caught by the suite**: lazily pipelined
   role setup ran handler queries as the owner (RLS bypassed). Fixed with `.execute()`; the existing
   role test had a blind spot (wrong handler shape), now closed and mutation-checked.
4. Docs: README migration count was wrong (6 → 5); service-role key wrongly described as used by tests.

### Housekeeping

- A mistyped scratch path created an empty folder chain `D:\Users\usama\AppData\…` (no data; the stray
  file was removed). Removing `D:\Users` itself was blocked as a protected path; delete it manually.
