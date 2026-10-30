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
