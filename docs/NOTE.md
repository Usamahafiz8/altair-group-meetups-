# Submission note: Altair group meetups

**Run instructions:** [README.md](../README.md) (clean start: install → configure `.env` → `npm run db:push`
→ `npm test` → `npm run server` + `npm run app`).
**AI tool:** Claude Code (model Claude Opus 5.5), one session. The exported, redacted log is submitted
alongside the repo (`submission/ai-session-log/`, produced by `scripts/export-ai-log.mjs`).

## What was built

Database (5 migrations, RLS, integrity triggers) · one Zod contract shared by server and app · Node/Hono
endpoint server that runs every query as the member under RLS · Expo app (sign-in, list, create, detail with
map, RSVP / withdraw / creator-only cancel, bonus edit) · 405 automated checks, including the four-identity
matrix, the multi-group map data and a history-wide secret scan. Bonus (a) edit: done. Bonus (b) live map:
not built (see "What I did not reach").

## Product decision

**Every group member sees the exact meeting point; outsiders see nothing.** Groups are small neighbours
who already walk together; meeting points are public by definition; a dog owner needs the place to decide
whether to go; and "approximate until RSVP" does not hold when any member can RSVP, read and withdraw.
I would switch to a grid-snapped approximate area for open or large groups; the contract and server are
shaped so that is a contained change. Full reasoning: [DECISIONS.md §1](DECISIONS.md).

## One thing I would refuse to build first

**Live location sharing before its privacy controls.** A walk starts at someone's front door, so a live
trail is a home location with extra steps. Opt-in per walk, no broadcast near the start/end point,
attendees only, nothing persisted, server-controlled channel access: those come first. [DECISIONS.md §3](DECISIONS.md)

## Pushback on the spec

1. "Approximate until RSVP" is undermined by "withdraw any time".
2. Free-text titles defeat place-name withholding.
3. A random per-meetup offset leaks the exact spot over repeated meetups at one place; grid snapping doesn't.
4. Withdraw after a meetup has started is unspecified (I allowed it).
5. Cancelled meetups keep advertising their meeting point indefinitely.
6. A creator leaving the group is unspecified.

Details: [DECISIONS.md §4](DECISIONS.md).

## What I directed

- **Process:** a phase-gated workbook (inspect → DB → RLS → contract → server → tests → app → map/privacy →
  QA → docs); each phase verified and committed before the next; no push without asking.
- **Environment calls:** hosted Supabase instead of Docker; Android emulator; both bonuses in scope.
- **Product call:** exact meeting point for all members (asked twice, kept, against the workbook's own
  "approximate" recommendation).
- **Standards for the app:** DRY code, every error handled, validation everywhere, think as the user; then
  "go deep in QA".
- **Corrections during the run:** the emulator could not take keyboard input (fixed via the AVD config);
  credentials pasted into a tracked file were moved to `.env` before any commit.

## What was caught and fixed along the way (all in the commit history)

| Caught by | Problem | Fix |
|---|---|---|
| Review before first push | RSVP error text revealed whether a meetup exists; future-start check would skip the endpoint's role | same "not found" for both; rule applies to every non-owner role |
| Design review | if the app role could write, the Zod endpoint would be bypassable | app role read-only; writes only via `meetup_writer` |
| First server run | contract package loaded as CommonJS, server crashed (typecheck had passed) | ESM package |
| Mutation check | "anon key → 401" test passed for the wrong reason | local-key verifier tests |
| Race test | `now()` stamps made an accepted RSVP look later than the cancel | `clock_timestamp()` migration + deterministic replay test |
| App build | two copies of React; a create screen that would have shown no error on failure | single React; actions return their outcome |
| Emulator QA | group picker stretched the screen; lowercase messages; value-like placeholders | fixed, re-checked |
| Clean-clone QA | test harness hit the Auth sign-in rate limit | one sign-in per run |
| Fuzzing | NUL byte → 500 | contract rejects control characters |
| Full suite | **my own latency optimisation ran queries as the owner (RLS bypassed)**; the role test had a blind spot | fixed, blind spot closed, mutation-checked |

## Reviewed or fixed by hand

> **Osama — complete this section yourself before submitting.** It must describe what *you* checked,
> questioned or changed, in your own words; reviewers weigh it heavily and it must match the log and the
> recording. Prompts: Which diffs did you read line by line (migrations? policies? `db.ts`?)? What did you
> push back on or overrule? What did you verify yourself on the emulator? Anything you changed by hand?

## What I did not reach

- **Bonus (b), live map with Realtime:** not built in this submission.
- **A from-zero rebuild of the same hosted project:** blocked by the tool's safety check on mass deletes.
  From-zero is covered by the first push into an empty project and the offline migration check on every
  `npm test`.
- **Load testing** beyond a 30-concurrent-request probe. Latency is dominated by distance to the database
  region (~177 ms per round trip from the dev machine; 3 round trips per request after optimisation).
- **iOS:** not run (Windows machine).

## Before submitting

- Rotate the Supabase database password (it appeared in the session; the exported log is redacted).
- Re-run `node scripts/export-ai-log.mjs` at the very end so the log includes the whole session.
- Set every link to "anyone with the link can view" and open each in a private window.
