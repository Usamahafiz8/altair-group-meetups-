# Altair — Group Meetups

The group-meetups slice of a community app for dog owners: members of neighbourhood walking groups post
meetups, RSVP, and see where to meet on a map. Supabase Postgres (row-level security), a Zod-validated
TypeScript endpoint server, and an Expo React Native app (Android).

```
app/ (Expo, Android) ──HTTPS + member JWT──▶ server/ (Node, Hono) ──as the member, under RLS──▶ Supabase Postgres
        │  sign-in only                         validates with packages/contract (Zod)            supabase/migrations
        └──────────────────────────▶ Supabase Auth
```

- **Database** (`supabase/`): starter schema + `meetups`, `rsvps`, RLS policies, integrity triggers.
  The app's role is read-only; writes are only possible through the endpoint server's role.
- **Contract** (`packages/contract/`): Zod schemas for every request and response, imported by the server
  and the app.
- **Server** (`server/`): verifies the Supabase JWT, validates, runs each request as the member under RLS.
- **App** (`app/`): sign-in, group meetup list, create, detail with map / RSVP / withdraw / cancel, edit (bonus).
- **Tests** (`tests/`): access matrix for the four identities, multi-group, map data, privacy, concurrency.

Docs: **[submission note](docs/NOTE.md)** · **[how it works](docs/HOW_IT_WORKS.md)** · [decisions, refuse-first, pushback](docs/DECISIONS.md) · [security review](docs/SECURITY_REVIEW.md) ·
[API contract](docs/CONTRACT.md) · [test report](docs/TEST_REPORT.md) · [QA report](docs/QA_REPORT.md) ·
[server](server/README.md) · [app](app/README.md)

## Prerequisites

- Node.js 20+ (developed on 24) and npm 10+ (developed on 11), Git
- A Supabase project (the free tier works; no Docker or Supabase CLI install needed)
- For the app: Android Studio emulator (or an Android device) with **Expo Go for SDK 58**

## 1. Install

```bash
git clone <repo-url> altair-meetups && cd altair-meetups
npm install
```

## 2. Configure

1. Create a new Supabase project and wait until it is ready.
2. `cp .env.example .env` and fill in, from the project's **Connect** dialog / API settings:
   - `SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`: `https://<project-ref>.supabase.co`
   - `SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`: the anon (public) key
   - `DATABASE_URL`: the **Session pooler** connection string, password URL-encoded (`@` → `%40`)
   - `EXPO_PUBLIC_API_URL`: `http://10.0.2.2:8787` on the Android emulator, `http://<your-LAN-IP>:8787` on a device

The service-role key is not used anywhere in this repo.

## 3. Database: migrations + seed

```bash
npm run db:status   # dry run: lists the 5 migrations and the seed file to apply
npm run db:push     # applies them to the project in DATABASE_URL
```

This runs `supabase db push --db-url $DATABASE_URL --include-seed` with a pinned CLI (via npx). The seed
(`supabase/seed.sql`) creates the eight test accounts, the two groups and the three reference meetups. It
runs once per project; later pushes apply new migrations only.

Check sign-in works (bash, with `.env` loaded via `set -a; . ./.env; set +a`):

```bash
curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" -d '{"email":"sam@example.test","password":"altair-fixture-pass"}'
# -> JSON with an access_token
```

## 4. Tests

```bash
npm test                    # contract unit tests, offline DB checks, hosted API/access/privacy suites (~4 min)
npm run test:hosted-checks  # persona matrix on the hosted DB in a rolled-back transaction + raw REST API checks
npm run typecheck           # contract, server, tests, app
```

The hosted suites create their own `[test]` meetups as the database owner and delete them afterwards; the
seed data is only read. The started-meetup tests move a fixture into the past as the owner, as the spec
allows.

## 5. Run

```bash
npm run server   # terminal 1: endpoint server on :8787  (curl http://127.0.0.1:8787/health)
npm run app      # terminal 2: Metro; opens Expo Go on the running Android emulator
```

Sign in with any seed account; every password is `altair-fixture-pass`:

| Account | Groups | Role in the reference meetups |
|---|---|---|
| avery@example.test | Maple | creator of "Saturday morning loop" |
| jordan@example.test | Maple | RSVP'd to Saturday; creator of "Weeknight short walk" |
| sam@example.test | Maple | member, not RSVP'd |
| riley@example.test | Maple + Riverside | RSVP'd to Saturday only |
| morgan@example.test | Riverside | creator of "Riverside sunrise walk" |
| casey@example.test | Riverside | RSVP'd to Riverside sunrise walk |
| quinn@example.test | Riverside | member, not RSVP'd |
| taylor@example.test | none | outsider: sees nothing |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `db:push` / server: `hostname resolving error` for `db.<ref>.supabase.co` | Use the Session pooler string for `DATABASE_URL` (the direct host is IPv6-only) |
| Server refuses to start: "use the Session pooler (port 5432)" | `DATABASE_URL` is the Transaction pooler string (6543); copy the **Session** pooler string instead |
| Server: `EADDRINUSE :8787` | Another server is still running; stop it or change `API_PORT` (and `EXPO_PUBLIC_API_URL`) |
| App: "Can't reach the meetups server" | Server not running, or `EXPO_PUBLIC_API_URL` wrong for your device; restart `npm run app` after editing `.env` |
| App: "App not configured" | `EXPO_PUBLIC_*` missing in `.env`; restart Metro |
| Emulator: laptop keyboard does not type | Set `hw.keyboard = yes` in `~/.android/avd/<avd>.avd/config.ini`, then cold boot |
| Expo Go, first launch after a cold boot: "runtime not ready … EventEmitter" | Tap reload; the emulator was still starting |
| `npm install`: "tarball … seems to be corrupted" | `npm cache verify`, then install again |

## Project status

Required slice complete (database, endpoints, tests, app, map). Bonus (a) edit is built and tested.
Product decision: every group member sees the exact meeting point — reasoning in
[DECISIONS.md](docs/DECISIONS.md).
