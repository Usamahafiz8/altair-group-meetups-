// Offline access-control check: grants + RLS, run as each seed persona.
//   role "authenticated" = the app through PostgREST (read-only)
//   role "meetup_writer" = the write endpoint after it has verified the JWT
// Usage (repo root): npm run check:access -w tests            (offline, PGlite)
//                    npm run check:access:remote -w tests     (hosted DB, rolled back)
import { setup, remote, as, reporter } from './harness.mjs';

const U = {
  avery: 'a1000000-0000-4000-8000-000000000001', jordan: 'a1000000-0000-4000-8000-000000000002',
  sam: 'a1000000-0000-4000-8000-000000000003', riley: 'a1000000-0000-4000-8000-000000000004',
  morgan: 'a1000000-0000-4000-8000-000000000005', casey: 'a1000000-0000-4000-8000-000000000006',
  taylor: 'a1000000-0000-4000-8000-000000000007', quinn: 'a1000000-0000-4000-8000-000000000008',
};
const MAPLE = 'b2000000-0000-4000-8000-000000000001', RIVER = 'b2000000-0000-4000-8000-000000000002';
const SAT = 'c3000000-0000-4000-8000-000000000001', WEEK = 'c3000000-0000-4000-8000-000000000002',
  RIV = 'c3000000-0000-4000-8000-000000000003';
const HOME_VALUES = ['40.004812', '-99.993127', '40.007395', '-99.98864', '39.998263', '-99.995418',
  '40.002957', '-100.006284', '39.993481', '-100.011736', '39.989624', '-100.004952',
  '40.010538', '-100.014867', '39.996107', '-100.017392'];

const r = reporter();
let db;
async function main(d) {
db = d;
const app = (who) => ({ role: 'authenticated', uid: U[who] });
const writer = (who) => ({ role: 'meetup_writer', uid: U[who] });
const rows = async (ctx, sql) => (await as(db, ctx, sql)).rows;
const count = async (ctx, sql) => (await rows(ctx, sql)).length;
const affected = async (ctx, sql) => (await as(db, ctx, sql)).affectedRows ?? 0;
const owner = (sql) => db.exec(sql);
const newMeetup = (title, extra = '') => `insert into public.meetups
  (group_id, title, starts_at, meeting_point_name, meeting_point_lat, meeting_point_lng${extra ? ', ' + extra.split('=')[0] : ''})
  values ('${MAPLE}', '${title}', now() + interval '2 days', 'Fountain plaza, Town Green', 39.999134, -99.999461${extra ? ', ' + extra.split('=')[1] : ''})
  returning id`;
const leaksHome = (data) => {
  const s = JSON.stringify(data);
  return /home_l(at|ng)/.test(s) || HOME_VALUES.some((v) => s.includes(v));
};

console.log('anonymous');
for (const t of ['meetups', 'rsvps', 'groups', 'group_memberships']) {
  await r.expectThrow(`anon cannot select ${t}`, () => as(db, { role: 'anon' }, `select * from public.${t}`), /permission denied/);
}
await r.expectThrow('anon cannot select users.display_name', () => as(db, { role: 'anon' }, 'select display_name from public.users'), /permission denied/);

console.log('outsider (Taylor) reads nothing');
r.check('meetups: 0', (await count(app('taylor'), 'select * from public.meetups')) === 0);
r.check('meetup by id: 0', (await count(app('taylor'), `select * from public.meetups where id = '${SAT}'`)) === 0);
r.check('rsvps / attendees: 0', (await count(app('taylor'), 'select * from public.rsvps')) === 0);
r.check('groups: 0', (await count(app('taylor'), 'select * from public.groups')) === 0);
r.check('memberships: 0', (await count(app('taylor'), 'select * from public.group_memberships')) === 0);
r.check('users: only self', JSON.stringify(await rows(app('taylor'), 'select id from public.users')) === JSON.stringify([{ id: U.taylor }]));
r.check('map data for SAT: none', (await count(app('taylor'), `select meeting_point_lat, meeting_point_lng from public.meetups where id = '${SAT}'`)) === 0);

console.log('group-scoped outsider (Morgan, Riverside only) reads nothing of Maple');
// Seed reads assert access properties, not exact rows: on the hosted DB, real
// use of the app adds meetups and RSVPs.
const onlyGroups = (ms, groups) => ms.every((m) => groups.includes(m.group_id));
const ids = (ms) => ms.map((m) => m.id);
const morganMs = await rows(app('morgan'), 'select id, group_id from public.meetups');
r.check('sees only Riverside meetups (incl. the seed one), nothing of Maple',
  onlyGroups(morganMs, [RIVER]) && ids(morganMs).includes(RIV) && !ids(morganMs).includes(SAT));
r.check('no SAT attendees', (await count(app('morgan'), `select * from public.rsvps where meetup_id = '${SAT}'`)) === 0);

console.log('member not RSVPd (Sam) / RSVPd (Jordan) / creator (Avery) — meetup, attendees, exact point');
for (const who of ['sam', 'jordan', 'avery']) {
  const ms = await rows(app(who), 'select id, group_id, status, meeting_point_name, meeting_point_lat, meeting_point_lng from public.meetups order by starts_at');
  r.check(`${who}: sees Maple meetups only, both seed ones, soonest first`,
    onlyGroups(ms, [MAPLE]) && ids(ms).indexOf(SAT) > -1 && ids(ms).indexOf(SAT) < ids(ms).indexOf(WEEK));
  const sat = ms.find((m) => m.id === SAT);
  r.check(`${who}: SAT exact point + name (decision: exact for all members)`,
    sat.meeting_point_name === 'North gate, Linden Park' && sat.meeting_point_lat === 40.012046 && sat.meeting_point_lng === -99.984517);
  const att = await rows(app(who), `select r.user_id, u.display_name from public.rsvps r join public.users u on u.id = r.user_id where r.meetup_id = '${SAT}' order by u.display_name`);
  const names = att.map((a) => a.display_name);
  r.check(`${who}: SAT attendees include Jordan and Riley (display names only)`,
    names.includes('Jordan Price') && names.includes('Riley Chen') && att.every((a) => Object.keys(a).sort().join() === 'display_name,user_id'));
}
r.check('sam: co-member names only (4 Maple members)', (await count(app('sam'), 'select id, display_name from public.users')) === 4);
r.check('sam: my groups = Maple', JSON.stringify(await rows(app('sam'), 'select id from public.groups')) === JSON.stringify([{ id: MAPLE }]));
r.check('sam: only own membership rows', (await count(app('sam'), 'select * from public.group_memberships')) === 1);

console.log('multi-group (Riley: Maple + Riverside, RSVPd to SAT only)');
const rileyMs = await rows(app('riley'), 'select id, group_id, meeting_point_lat, meeting_point_lng from public.meetups order by starts_at');
r.check('sees the seed meetups of both groups, nothing outside them',
  onlyGroups(rileyMs, [MAPLE, RIVER]) && [SAT, WEEK, RIV].every((id) => ids(rileyMs).includes(id)));
r.check('my groups = 2', (await count(app('riley'), 'select * from public.groups')) === 2);
r.check('map data: exact point for each meetup per decision, incl. non-RSVPd WEEK and RIV',
  rileyMs.every((m) => typeof m.meeting_point_lat === 'number' && typeof m.meeting_point_lng === 'number'));
r.check('attendees visible across both groups (SAT and RIV)',
  (await count(app('riley'), `select * from public.rsvps where meetup_id = '${SAT}'`)) >= 2 &&
  (await count(app('riley'), `select * from public.rsvps where meetup_id = '${RIV}'`)) >= 1);
const quinnMs = await rows(app('quinn'), 'select id, group_id from public.meetups');
r.check('Quinn (Riverside) still cannot see Maple even though Riley bridges groups',
  onlyGroups(quinnMs, [RIVER]) && ids(quinnMs).includes(RIV) && !ids(quinnMs).includes(SAT));
r.check('Quinn sees Riley (co-member) but not Avery', JSON.stringify((await rows(app('quinn'), 'select display_name from public.users order by 1')).map((x) => x.display_name)) === '["Casey Moreno","Morgan Ellis","Quinn Adler","Riley Chen"]');

console.log('home location never readable');
for (const who of ['sam', 'taylor', 'riley']) {
  await r.expectThrow(`${who}: select home_lat`, () => as(db, app(who), 'select home_lat from public.users'), /permission denied/);
  await r.expectThrow(`${who}: select *`, () => as(db, app(who), 'select * from public.users'), /permission denied/);
  await r.expectThrow(`${who} as writer: select home_lng`, () => as(db, writer(who), 'select home_lng from public.users'), /permission denied/);
}
const everything = [];
for (const who of Object.keys(U)) {
  everything.push(await rows(app(who), 'select * from public.meetups'));
  everything.push(await rows(app(who), 'select * from public.rsvps'));
  everything.push(await rows(app(who), 'select id, display_name from public.users'));
  everything.push(await rows(app(who), 'select * from public.groups'));
}
r.check('no readable row for any persona contains a home coordinate', !leaksHome(everything));

console.log('app role cannot write at all (writes only via the Zod endpoint)');
await r.expectThrow('app insert meetup', () => as(db, app('sam'), newMeetup('direct')), /permission denied/);
await r.expectThrow('app cancel meetup', () => as(db, app('avery'), `update public.meetups set status = 'cancelled' where id = '${SAT}'`), /permission denied/);
await r.expectThrow('app insert rsvp', () => as(db, app('sam'), `insert into public.rsvps (meetup_id) values ('${SAT}')`), /permission denied/);
await r.expectThrow('app delete rsvp', () => as(db, app('jordan'), `delete from public.rsvps where meetup_id = '${SAT}'`), /permission denied/);
await r.expectThrow('app delete meetup', () => as(db, app('avery'), `delete from public.meetups where id = '${SAT}'`), /permission denied/);
await r.expectThrow('app update users', () => as(db, app('sam'), `update public.users set display_name = 'x' where id = '${U.sam}'`), /permission denied/);

console.log('writer: create');
const created = await rows(writer('sam'), newMeetup('Sam walk'));
const samMeetup = created[0].id;
r.check('member creates; created_by comes from the JWT', (await db.query(`select created_by from public.meetups where id = '${samMeetup}'`)).rows[0].created_by === U.sam);
await r.expectThrow('cannot supply created_by', () => as(db, writer('sam'), newMeetup('spoof', `created_by='${U.avery}'`)), /permission denied/);
await r.expectThrow('cannot supply status', () => as(db, writer('sam'), newMeetup('spoof', `status='cancelled'`)), /permission denied/);
await r.expectThrow('outsider cannot create in Maple', () => as(db, writer('taylor'), newMeetup('x')), /row-level security|member/);
await r.expectThrow('Morgan cannot create in Maple', () => as(db, writer('morgan'), newMeetup('x')), /row-level security|member/);
await r.expectThrow('past start rejected', () => as(db, writer('sam'), newMeetup('x').replace("now() + interval '2 days'", "now() - interval '1 hour'")), /in the future/);
await r.expectThrow('writer cannot delete meetups', () => as(db, writer('sam'), `delete from public.meetups where id = '${samMeetup}'`), /permission denied/);

console.log('writer: cancel is creator-only');
r.check('member (Jordan) cancel affects 0 rows', (await affected(writer('jordan'), `update public.meetups set status = 'cancelled' where id = '${samMeetup}'`)) === 0);
r.check('outsider (Taylor) cancel affects 0 rows', (await affected(writer('taylor'), `update public.meetups set status = 'cancelled' where id = '${samMeetup}'`)) === 0);
r.check('still scheduled', (await db.query(`select status from public.meetups where id = '${samMeetup}'`)).rows[0].status === 'scheduled');
await as(db, writer('jordan'), `insert into public.rsvps (meetup_id) values ('${samMeetup}')`);
r.check('creator (Sam) cancel affects 1 row', (await affected(writer('sam'), `update public.meetups set status = 'cancelled' where id = '${samMeetup}'`)) === 1);
await r.expectThrow('creator cannot reopen', () => as(db, writer('sam'), `update public.meetups set status = 'scheduled' where id = '${samMeetup}'`), /cancelled and cannot be changed/);
await r.expectThrow('creator cannot edit cancelled', () => as(db, writer('sam'), `update public.meetups set title = 'x' where id = '${samMeetup}'`), /cancelled and cannot be changed/);
r.check('cancelled stays visible to members, marked', (await rows(app('avery'), `select status from public.meetups where id = '${samMeetup}'`))[0]?.status === 'cancelled');
r.check('cancelled: existing attendee still listed', (await count(app('avery'), `select * from public.rsvps where meetup_id = '${samMeetup}'`)) === 1);
r.check('cancelled: outsider still sees nothing', (await count(app('taylor'), `select * from public.meetups where id = '${samMeetup}'`)) === 0);
await r.expectThrow('no new RSVP to cancelled', () => as(db, writer('riley'), `insert into public.rsvps (meetup_id) values ('${samMeetup}')`), /cancelled/);
r.check('withdraw own RSVP on cancelled meetup', (await affected(writer('jordan'), `delete from public.rsvps where meetup_id = '${samMeetup}'`)) === 1);

console.log('writer: RSVP');
await as(db, writer('sam'), `insert into public.rsvps (meetup_id) values ('${SAT}') on conflict (meetup_id, user_id) do nothing`);
await as(db, writer('sam'), `insert into public.rsvps (meetup_id) values ('${SAT}') on conflict (meetup_id, user_id) do nothing`);
r.check('repeat RSVP leaves exactly one', (await db.query(`select count(*)::int n from public.rsvps where meetup_id = '${SAT}' and user_id = '${U.sam}'`)).rows[0].n === 1);
await r.expectThrow('cannot RSVP for someone else (user_id column)', () => as(db, writer('sam'), `insert into public.rsvps (meetup_id, user_id) values ('${WEEK}', '${U.avery}')`), /permission denied/);
await r.expectThrow('outsider RSVP -> not found', () => as(db, writer('taylor'), `insert into public.rsvps (meetup_id) values ('${SAT}')`), /meetup not found/);
await r.expectThrow('other-group RSVP -> not found', () => as(db, writer('morgan'), `insert into public.rsvps (meetup_id) values ('${SAT}')`), /meetup not found/);
await r.expectThrow('unknown meetup -> same not found', () => as(db, writer('sam'), `insert into public.rsvps (meetup_id) values ('c3000000-0000-4000-8000-0000000000ff')`), /meetup not found/);
await as(db, writer('riley'), `insert into public.rsvps (meetup_id) values ('${WEEK}')`);
r.check('Riley RSVP to WEEK does not touch RIV', (await count(app('riley'), `select * from public.rsvps where meetup_id = '${RIV}' and user_id = '${U.riley}'`)) === 0);

console.log('writer: withdraw is self-only');
r.check('Sam cannot withdraw Jordan', (await affected(writer('sam'), `delete from public.rsvps where meetup_id = '${SAT}' and user_id = '${U.jordan}'`)) === 0);
r.check('Taylor cannot withdraw anyone', (await affected(writer('taylor'), 'delete from public.rsvps')) === 0);
r.check('Jordan withdraws own', (await affected(writer('jordan'), `delete from public.rsvps where meetup_id = '${SAT}' and user_id = '${U.jordan}'`)) === 1);

console.log('started meetup (owner moves it into the past, as the spec allows)');
await owner(`update public.meetups set starts_at = now() - interval '10 minutes' where id = '${RIV}'`);
await r.expectThrow('no RSVP once started', () => as(db, writer('quinn'), `insert into public.rsvps (meetup_id) values ('${RIV}')`), /already started/);
await r.expectThrow('creator cannot move start into the past', () => as(db, writer('avery'), `update public.meetups set starts_at = now() - interval '1 day' where id = '${SAT}'`), /in the future/);

}

if (process.argv.includes('--remote')) await remote(process.env.DATABASE_URL, main);
else await main(await setup(process.argv[2]));
r.done();
