# App (`@altair/app`)

Expo SDK 58 / React Native 0.88, Expo Router, Android (emulator or Expo Go). Signs in with Supabase
Auth; every meetup read and write goes through the endpoint server and is checked against the shared
contract (`@altair/contract`).

## Run

```bash
# repo root, with .env filled in (EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_API_URL)
npm install
npm run server        # terminal 1: API on :8787
npm run app           # terminal 2: Metro + opens Expo Go on the running Android emulator
```

- `EXPO_PUBLIC_API_URL=http://10.0.2.2:8787` reaches the host from the Android emulator. On a physical
  device use the machine's LAN IP.
- The start script loads the repo-root `.env` (`node --env-file=../.env …`), so there is one env file.
  Only `EXPO_PUBLIC_*` values are bundled; a built bundle was checked to contain no service-role key,
  database password or URL.
- Emulator typing: the AVD needs `hw.keyboard = yes` in `~/.android/avd/<name>.avd/config.ini`
  (cold boot after changing it).
- If the very first launch after a cold boot shows "runtime not ready … EventEmitter", tap reload:
  Expo Go was still starting while the emulator was overloaded; it does not recur.

## Structure

```
src/app/                 routes (Expo Router)
  _layout.tsx            AuthProvider + Stack; Stack.Protected switches signed-in / signed-out screens
  sign-in.tsx            email + password, Zod-validated, seed-account shortcuts
  index.tsx              my groups (picker) + group meetup list
  meetups/new.tsx        create (MeetupForm)
  meetups/[id]/index.tsx detail: map, attendees, RSVP / withdraw / edit / cancel
  meetups/[id]/edit.tsx  bonus edit (MeetupForm, sends only changed fields)
src/lib/
  api.ts                 the one HTTP client: token, 15 s timeout, contract-checked responses, one ClientError type
  hooks.ts               useResource (focus-reload, stale-response safe), useAction (no double submit, returns outcome)
  auth.tsx               session state; expires the session on any 401
  supabase.ts / config.ts
src/components/          ui primitives, MeetupMap (view + picker), MeetupForm (create + edit), status badge
```

## Behaviour worth knowing

- **States:** every screen has loading, error (with retry) and empty states from the same components.
  Pull-to-refresh on the list and the detail. Screens reload on focus, so returning from create / edit /
  another screen shows fresh data; old data stays visible while refreshing.
- **Validation:** the form validates with the contract's own create schema (same rules and messages as the
  server); server `validation_error` issues are mapped onto the same fields. Other server errors appear
  above the submit button.
- **Permissions:** buttons follow server-computed `viewer` flags (`canRsvp`, `canCancel`, `canEdit`). The
  server enforces them; the app only decides what to show. Cancel asks for confirmation (it is final).
- **Stale state:** if an action fails because the meetup changed meanwhile (cancelled, started, gone), the
  detail reloads to the server's current view.
- **Session expiry:** any 401 signs out locally and the sign-in screen explains why.
- **Map:** shows exactly the point the server returns (`meetingPoint.kind === "exact"`), never a home
  location (the app never receives one). After RSVP the detail is re-fetched from the server.
