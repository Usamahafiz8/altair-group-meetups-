// Smoke check of the real PostgREST path on the hosted project: sign in as
// seed personas through Supabase Auth, then hit the REST API with each JWT the
// way a hand-crafted client would. Read-only except for write attempts that
// must be refused (so nothing changes).
// Usage (repo root): npm run check:postgrest -w tests
import { reporter } from './harness.mjs';

const { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON } = process.env;
const r = reporter();
const SAT = 'c3000000-0000-4000-8000-000000000001';
const HOME = /home_l(at|ng)|40\.004812|40\.007395|39\.998263|40\.002957|39\.993481|39\.989624|40\.010538|39\.996107/;

async function signIn(name) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${name}@example.test`, password: 'altair-fixture-pass' }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`sign-in failed for ${name}`);
  return j.access_token;
}
const rest = async (token, path, init = {}) => {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
};

console.log('anonymous (anon key only)');
for (const t of ['meetups', 'rsvps', 'groups', 'users?select=display_name']) {
  const res = await rest(null, t);
  r.check(`anon ${t} -> refused (${res.status})`, res.status === 401 || res.status === 403);
}

const taylor = await signIn('taylor'), sam = await signIn('sam'), riley = await signIn('riley');

console.log('outsider Taylor');
r.check('meetups: []', (await rest(taylor, 'meetups?select=*')).text === '[]');
r.check('meetup SAT by id: []', (await rest(taylor, `meetups?id=eq.${SAT}&select=*`)).text === '[]');
r.check('rsvps: []', (await rest(taylor, 'rsvps?select=*')).text === '[]');
r.check('groups: []', (await rest(taylor, 'groups?select=*')).text === '[]');

console.log('member Sam');
const samMeetups = await rest(sam, 'meetups?select=id,title,status,starts_at,meeting_point_name,meeting_point_lat,meeting_point_lng&order=starts_at');
r.check('sees 2 Maple meetups soonest first', samMeetups.json?.length === 2 && samMeetups.json[0].id === SAT);
const att = await rest(sam, `rsvps?meetup_id=eq.${SAT}&select=user_id,users(display_name)`);
r.check('SAT attendees via embedded users(display_name)', JSON.stringify(att.json?.map((a) => a.users.display_name).sort()) === '["Jordan Price","Riley Chen"]');
r.check('my groups = Maple', (await rest(sam, 'groups?select=name')).text === '[{"name":"Maple Street Walkers"}]');

console.log('multi-group Riley');
r.check('sees 3 meetups across both groups', (await rest(riley, 'meetups?select=id')).json?.length === 3);
r.check('my groups = 2', (await rest(riley, 'groups?select=id')).json?.length === 2);

console.log('home location');
for (const [n, tok] of [['sam', sam], ['riley', riley], ['taylor', taylor]]) {
  const a = await rest(tok, 'users?select=home_lat,home_lng');
  r.check(`${n}: select home_lat,home_lng refused (${a.status})`, a.status >= 400 && !HOME.test(a.json?.message ?? ''));
  const b = await rest(tok, 'users?select=*');
  r.check(`${n}: select * refused (${b.status})`, b.status >= 400);
  const c = await rest(tok, `rsvps?select=users(*)`);
  r.check(`${n}: embedded users(*) refused (${c.status})`, c.status >= 400);
}
const allText = [samMeetups.text, att.text, (await rest(riley, 'meetups?select=*')).text, (await rest(riley, 'users?select=id,display_name')).text].join('');
r.check('no home coordinate in any readable payload', !HOME.test(allText));

console.log('app cannot write directly (must use the Zod endpoint)');
const post = await rest(sam, 'meetups', { method: 'POST', body: JSON.stringify({ group_id: 'b2000000-0000-4000-8000-000000000001', title: 'x', starts_at: new Date(Date.now() + 864e5).toISOString(), meeting_point_name: 'x', meeting_point_lat: 40, meeting_point_lng: -100 }) });
r.check(`POST meetups refused (${post.status})`, post.status === 401 || post.status === 403);
const rsvp = await rest(sam, 'rsvps', { method: 'POST', body: JSON.stringify({ meetup_id: SAT }) });
r.check(`POST rsvps refused (${rsvp.status})`, rsvp.status === 401 || rsvp.status === 403);
const avery = await signIn('avery');
const cancel = await rest(avery, `meetups?id=eq.${SAT}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
r.check(`creator PATCH cancel via REST refused (${cancel.status})`, cancel.status === 401 || cancel.status === 403);
const jordan = await signIn('jordan');
const del = await rest(jordan, `rsvps?meetup_id=eq.${SAT}`, { method: 'DELETE' });
r.check(`DELETE own rsvp via REST refused (${del.status})`, del.status === 401 || del.status === 403);
const asWriter = await rest(sam, 'meetups?select=id', { headers: { 'Accept-Profile': 'private' } });
r.check(`private schema not exposed (${asWriter.status})`, asWriter.status >= 400);

r.done();
