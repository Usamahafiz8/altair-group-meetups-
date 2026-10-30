// The access rules for the four required identities (brief, Part 1), checked
// row by row against spec section 6, through BOTH ways a member can reach the
// data: the endpoint layer, and Supabase's REST API directly with their own
// session (which the app does not use, but anyone holding a token could).
//
//   outsider            Taylor  (no group)
//   member, not RSVP'd  Sam     (Maple)
//   member, RSVP'd      Jordan  (Maple, RSVP'd)
//   creator             Avery   (Maple, created it)
//
// Fixture: a Maple meetup created by Avery with Jordan's RSVP, i.e. the same
// shape as the seed's "Saturday morning loop", made fresh so cancelling it in
// these tests never touches the reference data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ListMeetupsResponse, MeetupResponse } from '@altair/contract';
import { api, cleanup, closeAll, fixtureMeetup, G, leaksHome, M, makeStarted, owner, token, U, type Persona } from './helpers';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
async function rest(who: Persona, path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${await token(who)}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const POINT = { kind: 'exact', name: 'Fountain plaza, Town Green', lat: 39.999134, lng: -99.999461 };
const responses: unknown[] = [];
let F: string;

beforeAll(async () => {
  await cleanup();
  F = await fixtureMeetup({ creator: 'avery', rsvps: ['jordan'], title: '[test] matrix' });
});
afterAll(async () => {
  expect(leaksHome(responses)).toBe(false);
  await closeAll();
});

const members = [
  ['member, not RSVPd (Sam)', 'sam', { isCreator: false, hasRsvp: false, canRsvp: true, canCancel: false, canEdit: false }],
  ['member, RSVPd (Jordan)', 'jordan', { isCreator: false, hasRsvp: true, canRsvp: false, canCancel: false, canEdit: false }],
  ['creator (Avery)', 'avery', { isCreator: true, hasRsvp: false, canRsvp: true, canCancel: true, canEdit: true }],
] as const;

describe('spec section 6 matrix — endpoint layer', () => {
  describe('outsider (Taylor): No / No / No / No', () => {
    it('meetup: not in any list, detail is a 404 identical to a random id', async () => {
      const list = await api('taylor', 'GET', `/groups/${G.maple}/meetups`);
      const detail = await api('taylor', 'GET', `/meetups/${F}`);
      const random = await api('taylor', 'GET', '/meetups/c3000000-0000-4000-8000-00000000beef');
      responses.push(list.body, detail.body);
      expect(list.status).toBe(404);
      expect(detail.status).toBe(404);
      expect(detail.body).toEqual(random.body);
    });
    it('attendee list and meeting point: nothing in any payload', () => {
      const all = JSON.stringify(responses);
      expect(all).not.toMatch(/Jordan|Avery|Fountain|39\.999134|matrix/);
    });
    it('cancel: refused (404), meetup unchanged', async () => {
      expect((await api('taylor', 'POST', `/meetups/${F}/cancel`)).status).toBe(404);
    });
  });

  describe.each(members)('%s', (_label, who, viewer) => {
    it('meetup (title, time, status): yes, in the list and the detail', async () => {
      const list = ListMeetupsResponse.parse((await api(who, 'GET', `/groups/${G.maple}/meetups`)).body);
      const item = list.meetups.find((m) => m.id === F);
      expect(item).toMatchObject({ title: '[test] matrix', status: 'scheduled' });
    });
    it('attendee list: yes (display names only)', async () => {
      const d = MeetupResponse.parse((await api(who, 'GET', `/meetups/${F}`)).body).meetup;
      responses.push(d);
      expect(d.attendees).toEqual([{ id: U.jordan, displayName: 'Jordan Price' }]);
    });
    it('meeting point: exact (product decision: exact for every member)', async () => {
      const d = MeetupResponse.parse((await api(who, 'GET', `/meetups/${F}`)).body).meetup;
      expect(d.meetingPoint).toEqual(POINT);
    });
    it('viewer flags match the role', async () => {
      const d = MeetupResponse.parse((await api(who, 'GET', `/meetups/${F}`)).body).meetup;
      expect(d.viewer).toEqual(viewer);
    });
  });

  it('cancel: Sam 403, Jordan 403, then Avery 200 — creator only', async () => {
    expect((await api('sam', 'POST', `/meetups/${F}/cancel`)).status).toBe(403);
    expect((await api('jordan', 'POST', `/meetups/${F}/cancel`)).status).toBe(403);
    const [before] = await owner`select status from public.meetups where id = ${F}`;
    expect(before!.status).toBe('scheduled');
    const r = await api('avery', 'POST', `/meetups/${F}/cancel`);
    expect(r.status).toBe(200);
    expect(MeetupResponse.parse(r.body).meetup.status).toBe('cancelled');
  });

  describe('after cancel', () => {
    it.each(['sam', 'jordan', 'avery'] as const)('%s still sees it, marked cancelled, attendees kept', async (who) => {
      const d = MeetupResponse.parse((await api(who, 'GET', `/meetups/${F}`)).body).meetup;
      expect(d.status).toBe('cancelled');
      expect(d.attendees.map((a) => a.id)).toEqual([U.jordan]);
      expect(d.viewer.canRsvp).toBe(false);
      expect(d.viewer.canCancel).toBe(false);
    });
    it('no new RSVP (Sam -> 409 meetup_cancelled)', async () => {
      const r = await api('sam', 'POST', `/meetups/${F}/rsvp`);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('meetup_cancelled');
    });
    it('outsider still sees nothing', async () => {
      expect((await api('taylor', 'GET', `/meetups/${F}`)).status).toBe(404);
    });
    it('cannot be reopened, even by the creator through any path', async () => {
      expect((await api('avery', 'PATCH', `/meetups/${F}`, { title: '[test] reopened' })).status).toBe(409);
      expect((await rest('avery', `meetups?id=eq.${F}`, { method: 'PATCH', body: JSON.stringify({ status: 'scheduled' }) })).status).toBe(403);
      const [row] = await owner`select status from public.meetups where id = ${F}`;
      expect(row!.status).toBe('cancelled');
    });
    it('Jordan can still withdraw', async () => {
      expect((await api('jordan', 'DELETE', `/meetups/${F}/rsvp`)).status).toBe(200);
    });
  });
});

describe('spec section 6 matrix — direct REST API with each member\'s own session', () => {
  let G2: string;
  beforeAll(async () => {
    G2 = await fixtureMeetup({ creator: 'avery', rsvps: ['jordan'], title: '[test] matrix-rest' });
  });

  it('outsider: meetup, attendees and meeting point all empty', async () => {
    for (const path of [`meetups?id=eq.${G2}&select=*`, `rsvps?meetup_id=eq.${G2}&select=*`, `meetups?id=eq.${G2}&select=meeting_point_lat,meeting_point_lng,meeting_point_name`]) {
      const r = await rest('taylor', path);
      expect(r.status).toBe(200);
      expect(r.body).toEqual([]);
    }
  });

  it.each(['sam', 'jordan', 'avery'] as const)('%s: meetup, attendees (display names) and exact point', async (who) => {
    const m = await rest(who, `meetups?id=eq.${G2}&select=title,status,meeting_point_name,meeting_point_lat,meeting_point_lng`);
    expect(m.body).toEqual([{ title: '[test] matrix-rest', status: 'scheduled', meeting_point_name: POINT.name, meeting_point_lat: POINT.lat, meeting_point_lng: POINT.lng }]);
    const a = await rest(who, `rsvps?meetup_id=eq.${G2}&select=user_id,users(display_name)`);
    expect(a.body).toEqual([{ user_id: U.jordan, users: { display_name: 'Jordan Price' } }]);
    responses.push(m.body, a.body);
  });

  it.each(['taylor', 'sam', 'jordan', 'avery'] as const)('%s cannot cancel, RSVP or withdraw through REST (writes are endpoint-only)', async (who) => {
    expect((await rest(who, `meetups?id=eq.${G2}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })).status).toBe(403);
    expect((await rest(who, 'rsvps', { method: 'POST', body: JSON.stringify({ meetup_id: G2 }) })).status).toBe(403);
    expect((await rest(who, `rsvps?meetup_id=eq.${G2}`, { method: 'DELETE' })).status).toBe(403);
    const [row] = await owner`select status, (select count(*)::int from public.rsvps where meetup_id = ${G2}) as n from public.meetups where id = ${G2}`;
    expect(row).toEqual({ status: 'scheduled', n: 1 });
  });

  it.each(['taylor', 'sam', 'jordan', 'avery'] as const)('%s cannot read any home location through REST', async (who) => {
    for (const path of ['users?select=home_lat,home_lng', 'users?select=*', `rsvps?meetup_id=eq.${G2}&select=users(*)`]) {
      const r = await rest(who, path);
      expect(r.status).toBe(403);
      expect(leaksHome(r.body)).toBe(false);
    }
  });
});

describe('multi-group member (Riley: Maple + Riverside, RSVPd to "Saturday morning loop" only)', () => {
  it('my groups: exactly the two groups', async () => {
    const r = await api('riley', 'GET', '/groups');
    expect(r.body.groups.map((g: { id: string }) => g.id).sort()).toEqual([G.maple, G.riverside]);
  });

  it('map data per meetup follows Riley\'s own status in that meetup', async () => {
    const maple = ListMeetupsResponse.parse((await api('riley', 'GET', `/groups/${G.maple}/meetups`)).body).meetups;
    const river = ListMeetupsResponse.parse((await api('riley', 'GET', `/groups/${G.riverside}/meetups`)).body).meetups;
    responses.push(maple, river);
    const byId = Object.fromEntries([...maple, ...river].map((m) => [m.id, m]));

    // RSVP'd: exact point
    expect(byId[M.saturday]!.viewer.hasRsvp).toBe(true);
    expect(byId[M.saturday]!.meetingPoint).toEqual({ kind: 'exact', name: 'North gate, Linden Park', lat: 40.012046, lng: -99.984517 });
    // Not RSVP'd, same group: the member view (exact, per decision); RSVP to Saturday grants nothing here
    expect(byId[M.weeknight]!.viewer.hasRsvp).toBe(false);
    expect(byId[M.weeknight]!.viewer.canRsvp).toBe(true);
    expect(byId[M.weeknight]!.meetingPoint).toEqual({ kind: 'exact', name: 'Front steps, Elm Avenue Library', lat: 40.003318, lng: -99.979762 });
    // Not RSVP'd, other group: the member view of that group
    expect(byId[M.riverside]!.viewer.hasRsvp).toBe(false);
    expect(byId[M.riverside]!.meetingPoint).toEqual({ kind: 'exact', name: 'Boathouse lot, Riverside Path', lat: 39.985239, lng: -100.009683 });
  });

  it('Riley\'s map data for a meetup equals what any other member of that group gets (no cross-group bonus)', async () => {
    for (const [id, peer] of [[M.weeknight, 'sam'], [M.riverside, 'quinn']] as const) {
      const riley = MeetupResponse.parse((await api('riley', 'GET', `/meetups/${id}`)).body).meetup;
      const other = MeetupResponse.parse((await api(peer, 'GET', `/meetups/${id}`)).body).meetup;
      expect(riley.meetingPoint).toEqual(other.meetingPoint);
      expect(riley.attendees).toEqual(other.attendees);
    }
  });

  it('Riley bridging both groups opens nothing between them', async () => {
    expect((await api('quinn', 'GET', `/meetups/${M.saturday}`)).status).toBe(404); // Riverside member, Maple meetup
    expect((await api('sam', 'GET', `/meetups/${M.riverside}`)).status).toBe(404); // Maple member, Riverside meetup
    expect((await api('casey', 'GET', `/groups/${G.maple}/meetups`)).status).toBe(404); // RSVP'd in Riverside, still nothing in Maple
  });

  it('Riley RSVPs to a Riverside meetup: only that meetup changes for Riley', async () => {
    const R = await fixtureMeetup({ creator: 'morgan', group: G.riverside, title: '[test] riverside' });
    expect((await api('riley', 'POST', `/meetups/${R}/rsvp`)).status).toBe(200);
    const river = ListMeetupsResponse.parse((await api('riley', 'GET', `/groups/${G.riverside}/meetups`)).body).meetups;
    expect(river.find((m) => m.id === R)!.viewer.hasRsvp).toBe(true);
    expect(river.find((m) => m.id === M.riverside)!.viewer.hasRsvp).toBe(false);
    const maple = ListMeetupsResponse.parse((await api('riley', 'GET', `/groups/${G.maple}/meetups`)).body).meetups;
    expect(maple.find((m) => m.id === M.weeknight)!.viewer.hasRsvp).toBe(false);
    // and it is invisible to the other group's members
    expect((await api('sam', 'GET', `/meetups/${R}`)).status).toBe(404);
  });
});

describe('started meetup (moved into the past by the owner, as the spec allows)', () => {
  it('no RSVP once started, members still see it, the creator cannot edit it', async () => {
    const S = await fixtureMeetup({ creator: 'avery', rsvps: ['jordan'], title: '[test] started' });
    await makeStarted(S);
    const r = await api('sam', 'POST', `/meetups/${S}/rsvp`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('meetup_started');
    const d = MeetupResponse.parse((await api('sam', 'GET', `/meetups/${S}`)).body).meetup;
    expect(d.viewer.canRsvp).toBe(false);
    const asCreator = MeetupResponse.parse((await api('avery', 'GET', `/meetups/${S}`)).body).meetup;
    expect(asCreator.viewer).toMatchObject({ canCancel: true, canEdit: false }); // can still cancel, not edit
    expect((await api('avery', 'PATCH', `/meetups/${S}`, { title: '[test] late' })).status).toBe(409);
    expect((await api('jordan', 'DELETE', `/meetups/${S}/rsvp`)).status).toBe(200); // withdraw still allowed
  });
});
