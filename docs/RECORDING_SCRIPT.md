# Recording outline (10–15 min, voice-over, "why" not a click tour)

The brief requires: a live run of the slice, **the map before and after an RSVP**, and **an outsider who
cannot read the meetup or its attendees**. Imperfect delivery is fine; don't re-record for polish.

## Before you press record

- Close unrelated tabs and windows.
- Emulator booted (cold boot if the keyboard does not type), Expo Go installed.
- Terminal 1: `npm run server` (check `curl http://127.0.0.1:8787/health`).
- Terminal 2: `npm run app`; app open on the sign-in screen (sign out first if needed).
- A browser tab on the GitHub repo or the editor with `supabase/migrations/` open.
- Optional terminal 3 ready with the REST check below (anon key loaded from `.env`; never show `.env`).

## Segments

| Time | Show | Say (the *why*) |
|---|---|---|
| 0:00–1:00 | README architecture diagram | What the slice is. Three layers, and where each rule lives: Postgres decides who can see what, Zod decides what is valid, the app only decides which buttons to show. |
| 1:00–3:00 | `20261030110000_access_control.sql` | Two roles: the app's role is **read-only**, writes only via `meetup_writer`, so the Zod endpoint is the only way to write. Home location: RLS hides rows, not columns, so column grants expose only `id, display_name`. |
| 3:00–4:00 | `server/src/db.ts` `asMember` | Every request runs as the member under RLS, never as the service role. Tell the story: my latency optimisation once made queries run as the owner, the suite caught it (outsiders saw data), and the role test had a blind spot I closed. That's why the tests matter more than the code. |
| 4:00–6:30 | **App, Sam** (member, not RSVP'd): list → "Saturday morning loop" | Point at the **map before RSVP**: exact point and place name. Explain the product decision in one breath (small groups, public places, dog owners decide by distance, the RSVP→withdraw loophole). Tap **RSVP**: badge, "You're going", Sam in attendees. **Map after RSVP**: the same exact point, by decision; the server re-sent the detail and only the viewer state changed. Withdraw. |
| 6:30–8:00 | **App, Avery** (creator): create a meetup (validation errors first, then valid), edit it, cancel it (confirm) | Server-side rules the app can't bypass: future start, creator-only cancel, cancel is final, cancelled stays visible to the group. |
| 8:00–9:30 | **App, Taylor** (outsider): empty state; deep link `exp://10.0.2.2:8081/--/meetups/c3000000-0000-4000-8000-000000000001` | Taylor sees "This meetup isn't available", with no title, place or attendees, and the same response as a made-up id. |
| 9:30–10:30 | Terminal: Taylor's token against the REST API (below) | Even bypassing the app: meetups `[]`, attendees `[]`, home location 403, writes 403. |
| 10:30–12:00 | `npm test` output (pre-recorded run or the report) | The four identities, Riley's multi-group map data, creator-only cancel, no RSVP to cancelled/started, concurrency replay. 405 checks. |
| 12:00–14:00 | `docs/DECISIONS.md` | Refuse-first: live location before its privacy controls (walks start at front doors). Pushback: withdraw undermines approximate-until-RSVP; titles leak places; random offsets leak over repeated meetups. What I didn't reach: bonus (b), from-zero rebuild, load testing. |

## REST check for the outsider segment

```bash
set -a; . ./.env; set +a
T=$(curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" -d '{"email":"taylor@example.test","password":"altair-fixture-pass"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
R="$SUPABASE_URL/rest/v1"; H=(-H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $T")
curl -s "${H[@]}" "$R/meetups?select=title,meeting_point_name"; echo          # []
curl -s "${H[@]}" "$R/rsvps?select=*"; echo                                     # []
curl -s -o /dev/null -w "home_lat: %{http_code}\n" "${H[@]}" "$R/users?select=home_lat"   # 403
curl -s -o /dev/null -w "insert: %{http_code}\n" "${H[@]}" -H "Content-Type: application/json" \
  -X POST "$R/rsvps" -d '{"meetup_id":"c3000000-0000-4000-8000-000000000001"}'        # 403
```

(The command prints only results, never the token or keys. Don't `cat .env` on screen.)

## After recording

Leave the database as you found it: anything you created as Avery can stay (it's normal app data), or
remove it in the Supabase table editor.
