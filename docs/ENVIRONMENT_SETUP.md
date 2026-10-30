# Environment Setup

## Tool inventory (recorded 2026-10-30, Windows 10 Home 19045)

| Tool | Version | Status |
|---|---|---|
| Node.js | 24.20.0 | installed |
| npm | 11.19.0 | installed |
| Git | 2.55.0.windows.5 | installed |
| Docker Desktop | — | **not installed** |
| WSL | Ubuntu, WSL 2 | installed (not used) |
| Supabase CLI | 2.122.0 | via `npx supabase@2.122.0` (no global install) |
| Expo | SDK 58 (`expo@58.0.21` latest on npm) | installed per-project in Phase 6 |
| Zod | 4.6.7 latest on npm | one major (4) on server and app |
| Android emulator | 37.2.12 | installed |
| AVD | `altair_pixel` — Pixel 7, Android 35, google_apis x86_64 | ready |
| adb | 1.0.41 (37.0.1) | installed |
| Deno | — | not needed (Node server chosen over Edge Functions) |

## Chosen path: hosted Supabase (README Path B)

Docker is not installed, so the database runs on a hosted Supabase free-tier project. Consequences:

- Migrations are applied with `npx supabase link` + `npx supabase db push` (the CLI needs no Docker for this).
- Seed PART 1 is run once in the SQL editor; PART 2 after our migrations.
- No free `db reset`; tests create and remove their own fixtures.
- The Android emulator reaches the local write server at `http://10.0.2.2:<API_PORT>`; the Supabase API is
  the public hosted URL.

## Environment variables

Copy `.env.example` to `.env` and fill it in from the hosted project settings. `.env` is gitignored.
Keys must not be pasted into the AI chat because the session log is part of the submission.

`DATABASE_URL` (server-only) is used by the DB scripts, the endpoint server and test setup. The
service-role key is not used anywhere (removed from `.env.example` in Phase 8). Only `EXPO_PUBLIC_*` values
reach the app bundle.

## Repository layout

```
altair-meetups/
  supabase/
    config.toml                         from `supabase init`
    migrations/20261001000000_starter.sql   starter, verbatim
    seed.sql                            seed, verbatim (PART 2 adapted in Phase 1)
  packages/contract/   shared Zod schemas            (Phase 3)
  server/              Node TS write endpoints       (Phase 4)
  tests/               access + contract tests       (Phase 5)
  app/                 Expo React Native app         (Phase 6)
  docs/                analysis, security, QA docs
```

## Setup steps completed in Phase 0

1. `git init -b main` in `altair-meetups/`.
2. `npx supabase@2.122.0 init` → `supabase/config.toml`, `supabase/.gitignore`.
3. Starter SQL copied verbatim to `supabase/migrations/20261001000000_starter.sql` (verified with `cmp`).
4. Seed copied verbatim to `supabase/seed.sql` (verified with `cmp`).
5. Root `package.json` (npm workspaces), `.gitignore`, `.env.example`.

## Hosted project status (2026-10-30)

- [x] `.env` created (gitignored; `.env.example` holds placeholders only)
- [x] Direct DB host `db.<ref>.supabase.co` is **IPv6-only** on the free tier and does not resolve from
      this machine, so `DATABASE_URL` uses the **Session pooler** (IPv4):
      `postgresql://postgres.<ref>:<url-encoded-password>@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`
- [x] `npx supabase@2.122.0 db push --db-url "$DATABASE_URL" --include-seed` applied all migrations and the
      seed (no `supabase link` / access token needed). Server: Postgres 17.11.
- [x] Remote state verified: 3 scheduled upcoming meetups (2/1/0 RSVPs), 9 policies, 3 migrations recorded.
- [x] `npm run check:access:remote -w tests`: 77/77 on the hosted DB (rolled back).
- [x] Anon key + service role key in `.env`; sign-in smoke test as sam@example.test returns an `access_token`
- [x] `npm run check:postgrest -w tests`: 28/28 through the real REST API with real JWTs

Note: pushed migrations are immutable from here; changes go in new migration files.

## Known environment risk

The parent folder path contains spaces and an en dash (`ALTAIR – FIRST EPIC WORKFLOW CHALLENGE`). If
Metro or another tool mis-handles it, move `altair-meetups/` to a plain path; nothing depends on its location.
