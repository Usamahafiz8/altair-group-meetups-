# Shared Contract (`packages/contract`)

One Zod module, imported by the write/read server and by the React Native app. Zod `~4.6.7` is a
dependency of this package only, so both sides get the same major (npm workspaces hoist one copy).
The package ships TypeScript source (`main: src/index.ts`, no build step): the server runs it via `tsx`,
the app via Metro (Phase 6 adds the workspace root to Metro's `watchFolders`).

## Endpoints (paths in `src/routes.ts`)

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/groups` | — | `MyGroupsResponse` | caller's groups only |
| GET | `/groups/:groupId/meetups` | `GroupIdParams` | `ListMeetupsResponse` | soonest first, cancelled included |
| GET | `/meetups/:meetupId` | `MeetupIdParams` | `MeetupResponse` | detail + attendees + map point |
| POST | `/meetups` | `CreateMeetupRequest` | `MeetupResponse` (201) | creator = session user |
| POST | `/meetups/:meetupId/cancel` | `MeetupIdParams` + `EmptyBody` | `MeetupResponse` | creator only |
| POST | `/meetups/:meetupId/rsvp` | `MeetupIdParams` + `EmptyBody` | `RsvpResponse` | idempotent |
| DELETE | `/meetups/:meetupId/rsvp` | `MeetupIdParams` | `RsvpResponse` | own RSVP; allowed after cancel |
| PATCH | `/meetups/:meetupId` | `MeetupIdParams` + `EditMeetupRequest` | `MeetupResponse` | bonus (a), creator only |

Every request carries `Authorization: Bearer <Supabase access token>`.

## Request rules

| Field | Rule |
|---|---|
| ids | RFC 9562 UUID |
| `title` | trimmed, 1–80 chars |
| `startsAt` | ISO 8601 **with offset** (naive local times rejected), strictly after server `now()` |
| `meetingPoint.name` | trimmed, 1–120 chars |
| `meetingPoint.lat` / `lng` | finite number, −90..90 / −180..180 |

All request objects are **strict**: unknown keys (`createdBy`, `created_by`, `status`, `id`, `userId`,
anything inside `meetingPoint`) are a `validation_error`, not silently ignored. Cancel/RSVP/withdraw take
no body (`EmptyBody`); the member is always the session user.

The future-start rule uses `Date.now()` at parse time; on the server that is the server clock, which is
the authority. The database trigger re-checks against Postgres `now()`.

## Response rules

Response schemas use `z.object` (strip). The server parses its own output before sending, so any field
not named in the contract is dropped: a query mistake that selected a home location could not reach a
client. `MeetingPoint.kind` is `"exact"` (product decision: exact point for every group member) and gives
the app a stable discriminator.

`viewer` holds server-computed facts about the caller (`isCreator`, `hasRsvp`, `canRsvp`, `canCancel`)
so the app does not re-derive permissions — it only decides which buttons to show; the server enforces.

## Errors

```json
{ "error": { "code": "validation_error", "message": "Invalid request", "issues": [{ "path": "meetingPoint.lat", "message": "latitude must be between -90 and 90" }] } }
```

| code | HTTP | when |
|---|---|---|
| `validation_error` | 400 | schema failure |
| `unauthorized` | 401 | missing / invalid / expired token |
| `forbidden` | 403 | a group member who is not the creator tries to cancel / edit (they can already see the meetup) |
| `not_found` | 404 | no such meetup **or not visible to you** (outsiders) — never confirms existence |
| `meetup_cancelled` | 409 | RSVP to, or edit of, a cancelled meetup (cancelling again is a no-op 200 for the creator) |
| `meetup_started` | 409 | RSVP to, or edit of, a meetup that has started |
| `internal` | 500 | anything else (no internals in the message) |

## Tests

`npm test -w @altair/contract` — 51 tests: valid input, trimming, every length/range boundary, past and
equal-to-now start, naive datetime, NaN/Infinity, unexpected keys (incl. `createdBy`), non-object bodies,
path-param injection strings, edit rules, response stripping of `home_lat`/`home_lng`, error envelope.
Mutation check: loosening the title max or making the request non-strict fails 5 tests.
