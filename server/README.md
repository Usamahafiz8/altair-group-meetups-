# Endpoint server (`@altair/server`)

Small Node + TypeScript server (Hono) in front of Supabase Postgres. Every write in the slice goes
through it, validated by the shared Zod contract (`@altair/contract`); reads go through it too so the
app consumes one contract. API reference: [`docs/CONTRACT.md`](../docs/CONTRACT.md).

## Run

```bash
# from the repo root, with .env filled in (see .env.example)
npm install
npm run dev -w @altair/server     # watch mode
npm start -w @altair/server       # plain
curl http://127.0.0.1:8787/health # {"ok":true}
```

Listens on `0.0.0.0:$API_PORT` (default 8787) so the Android emulator reaches it at `http://10.0.2.2:8787`.

Needs `SUPABASE_URL` (to fetch the project's JWKS) and `DATABASE_URL` (Session pooler string; server-only).
It does **not** use the service role key.

## Request lifecycle

1. **Authenticate** (`src/auth.ts`): `Authorization: Bearer <access token>` verified locally with `jose`
   against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (ES256): signature, issuer, audience
   `authenticated`, expiry, `role === "authenticated"`, `sub` is a UUID. Anything else → 401.
2. **Validate** with the contract (`parse()` in `src/app.ts`): path params, then body. Strict schemas; an
   invalid request never reaches the database → 400 with per-field `issues`.
3. **Execute as the member** (`src/db.ts`): one transaction per request that first runs
   `set_config('role', 'authenticated' | 'meetup_writer', true)` and
   `set_config('request.jwt.claims', <verified claims>, true)`. `auth.uid()` is the member and RLS +
   triggers apply. Reads use `authenticated` (same read-only role as the REST API); writes use
   `meetup_writer`. The owner connection itself never runs a feature query.
4. **Map database refusals** (`src/errors.ts`): RLS/trigger errors → contract codes. A write that
   changed 0 rows is explained without leaking: invisible meetup → 404, visible to a non-creator → 403.
5. **Respond** through the response schema (`send()`): fields not in the contract are stripped.
6. **Log** one JSON line: method, path, status, ms, member id. No tokens, bodies or results.

## Endpoints

| | Path | DB role | Notes |
|---|---|---|---|
| GET | `/groups` | authenticated | my groups |
| GET | `/groups/:groupId/meetups` | authenticated | 404 if not your group |
| GET | `/meetups/:meetupId` | authenticated | detail, attendees, exact point, viewer flags |
| POST | `/meetups` | meetup_writer | `created_by` defaults to `auth.uid()` (not a column the role may set) |
| POST | `/meetups/:meetupId/cancel` | meetup_writer | creator only (RLS); repeat cancel is a no-op |
| POST | `/meetups/:meetupId/rsvp` | meetup_writer | `on conflict do nothing`; `user_id` defaults to `auth.uid()` |
| DELETE | `/meetups/:meetupId/rsvp` | meetup_writer | deletes only the caller's row; idempotent for members |
| PATCH | `/meetups/:meetupId` | meetup_writer | bonus edit: creator only, future start, not cancelled/started |

## Concurrency

- Duplicate RSVP: unique `(meetup_id, user_id)` + `on conflict do nothing`.
- RSVP vs cancel: the RSVP trigger locks the meetup row `FOR SHARE`, the cancel's update waits or the RSVP
  sees `cancelled`.
- Cancel is a single conditional `update … where status = 'scheduled'`.

## Tests

`npm test -w tests` (hosted DB; in-process app via `app.request`, real seed sessions):
`api/endpoints.test.ts` (42), `api/auth.test.ts` (14, local ES256 keys), `api/db.test.ts` (4).
