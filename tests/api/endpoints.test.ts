// Endpoint layer: authentication, contract validation, and the write rules,
// end to end against the hosted database under RLS.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, ListMeetupsResponse, MeetupResponse, MyGroupsResponse, RsvpResponse } from '@altair/contract';
import {
  api, cleanup, closeAll, createBody, fixtureGroup, fixtureMeetup, G, inDays, leaksHome, M, makeStarted, owner, U,
} from './helpers';

const seen: unknown[] = []; // every response body, scanned for home locations at the end
const call: typeof api = async (...args) => {
  const r = await api(...args);
  seen.push(r.body);
  return r;
};
const RANDOM_ID = 'c3000000-0000-4000-8000-00000000dead';

beforeAll(cleanup);
afterAll(closeAll);

describe('authentication', () => {
  it('health needs no session', async () => {
    expect((await call(null, 'GET', '/health')).status).toBe(200);
  });
  it.each([
    ['no Authorization header', undefined],
    ['garbage token', 'Bearer not-a-jwt'],
    ['wrong scheme', 'Basic abc'],
    ['the anon key (role anon) is not a member session', `Bearer ${process.env.SUPABASE_ANON_KEY}`],
  ])('%s -> 401', async (_n, rawAuth) => {
    const r = await call(null, 'GET', '/groups', undefined, rawAuth === undefined ? {} : { rawAuth });
    expect(r.status).toBe(401);
    expect(ApiError.parse(r.body).error.code).toBe('unauthorized');
  });
  it('a tampered token -> 401', async () => {
    const { token } = await import('./helpers');
    const t = await token('sam');
    const [h, p, s] = t.split('.');
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: U.avery })).toString('base64url');
    const r = await call(null, 'GET', '/groups', undefined, { rawAuth: `Bearer ${h}.${forged}.${s}` });
    expect(r.status).toBe(401);
  });
  it('writes need a session too', async () => {
    expect((await call(null, 'POST', '/meetups', createBody())).status).toBe(401);
    expect((await call(null, 'POST', `/meetups/${M.saturday}/rsvp`)).status).toBe(401);
  });
});

describe('reads', () => {
  it('my groups returns only the caller\'s groups', async () => {
    expect(MyGroupsResponse.parse((await call('sam', 'GET', '/groups')).body).groups.map((g) => g.id)).toEqual([G.maple]);
    expect(MyGroupsResponse.parse((await call('riley', 'GET', '/groups')).body).groups).toHaveLength(2);
    expect(MyGroupsResponse.parse((await call('taylor', 'GET', '/groups')).body).groups).toEqual([]);
  });

  it('group list: soonest first, members only', async () => {
    const r = await call('sam', 'GET', `/groups/${G.maple}/meetups`);
    expect(r.status).toBe(200);
    expect(ListMeetupsResponse.parse(r.body).meetups.map((m) => m.id)).toEqual([M.saturday, M.weeknight]);
  });

  it('a group with no meetups: empty list for its member, 404 for others', async () => {
    const g = await fixtureGroup(['sam']);
    const sam = await call('sam', 'GET', `/groups/${g}/meetups`);
    expect(sam.status).toBe(200);
    expect(ListMeetupsResponse.parse(sam.body).meetups).toEqual([]);
    expect((await call('taylor', 'GET', `/groups/${g}/meetups`)).status).toBe(404);
    expect((await call('avery', 'GET', `/groups/${g}/meetups`)).status).toBe(404);
  });

  it('group list for a group you are not in -> 404, same as a group that does not exist', async () => {
    const outsider = await call('taylor', 'GET', `/groups/${G.maple}/meetups`);
    const missing = await call('taylor', 'GET', `/groups/b2000000-0000-4000-8000-00000000dead/meetups`);
    expect(outsider.status).toBe(404);
    expect(outsider.body).toEqual(missing.body);
    expect((await call('morgan', 'GET', `/groups/${G.maple}/meetups`)).status).toBe(404);
  });

  it('detail: attendees and viewer flags per caller', async () => {
    const sam = MeetupResponse.parse((await call('sam', 'GET', `/meetups/${M.saturday}`)).body).meetup;
    expect(sam.attendees.map((a) => a.displayName).sort()).toEqual(['Jordan Price', 'Riley Chen']);
    expect(sam.meetingPoint).toEqual({ kind: 'exact', name: 'North gate, Linden Park', lat: 40.012046, lng: -99.984517 });
    expect(sam.createdBy.displayName).toBe('Avery Lin');
    expect(sam.viewer).toEqual({ isCreator: false, hasRsvp: false, canRsvp: true, canCancel: false, canEdit: false });

    const jordan = MeetupResponse.parse((await call('jordan', 'GET', `/meetups/${M.saturday}`)).body).meetup;
    expect(jordan.viewer).toMatchObject({ hasRsvp: true, canRsvp: false, canCancel: false });

    const avery = MeetupResponse.parse((await call('avery', 'GET', `/meetups/${M.saturday}`)).body).meetup;
    expect(avery.viewer).toMatchObject({ isCreator: true, canCancel: true, canEdit: true });
  });

  it('detail for an outsider is the same 404 as a meetup that does not exist', async () => {
    const outsider = await call('taylor', 'GET', `/meetups/${M.saturday}`);
    const missing = await call('taylor', 'GET', `/meetups/${RANDOM_ID}`);
    expect(outsider.status).toBe(404);
    expect(outsider.body).toEqual(missing.body);
    expect(JSON.stringify(outsider.body)).not.toMatch(/Saturday|Linden|Avery|Jordan|Riley/);
  });

  it('invalid ids -> 400 validation_error', async () => {
    for (const path of ['/meetups/not-a-uuid', '/groups/1/meetups', "/meetups/1'%20or%201=1"]) {
      const r = await call('sam', 'GET', path);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('validation_error');
    }
  });

  it('unknown route -> 404 envelope', async () => {
    expect((await call('sam', 'GET', '/nope')).body.error.code).toBe('not_found');
  });
});

describe('POST /meetups (create)', () => {
  it('a member creates; creator comes from the session', async () => {
    const r = await call('sam', 'POST', '/meetups', createBody({ title: '  [test] trimmed  ' }));
    expect(r.status).toBe(201);
    const m = MeetupResponse.parse(r.body).meetup;
    expect(m.createdBy.id).toBe(U.sam);
    expect(m.title).toBe('[test] trimmed');
    expect(m.status).toBe('scheduled');
    expect(m.viewer).toMatchObject({ isCreator: true, canCancel: true, canEdit: true });
    const [row] = await owner`select created_by from public.meetups where id = ${m.id}`;
    expect(row!.created_by).toBe(U.sam);
  });

  it('rejects a start time in the past', async () => {
    const r = await call('sam', 'POST', '/meetups', createBody({ startsAt: inDays(-1) }));
    expect(r.status).toBe(400);
    expect(r.body.error.issues).toEqual([{ path: 'startsAt', message: 'start time must be in the future' }]);
  });

  it.each([
    ['createdBy in body', { createdBy: U.avery }],
    ['status in body', { status: 'cancelled' }],
    ['81-char title', { title: 'x'.repeat(81) }],
    ['empty title', { title: '   ' }],
    ['latitude out of range', { meetingPoint: { name: 'x', lat: 91, lng: 0 } }],
    ['missing meeting point', { meetingPoint: undefined }],
    ['naive local time', { startsAt: '2031-01-01T08:00:00' }],
  ])('rejects %s -> 400', async (_n, patch) => {
    const r = await call('sam', 'POST', '/meetups', createBody(patch));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_error');
  });

  it('rejects text Postgres cannot store with a 400, not a 500 (found by fuzzing)', async () => {
    for (const title of ['[test] walk\u0000now', '[test] \ud800']) {
      const r = await call('sam', 'POST', '/meetups', createBody({ title }));
      expect(r.status).toBe(400);
      expect(r.body.error.issues[0].path).toBe('title');
    }
  });

  it('rejects malformed and missing bodies', async () => {
    expect((await call('sam', 'POST', '/meetups', undefined, { rawBody: '{oops' })).status).toBe(400);
    expect((await call('sam', 'POST', '/meetups')).status).toBe(400);
    expect((await call('sam', 'POST', '/meetups', undefined, { rawBody: JSON.stringify('x'.repeat(20_000)) })).status).toBe(400);
  });

  it('outsider / other-group member cannot create in Maple -> 404, nothing written', async () => {
    expect((await call('taylor', 'POST', '/meetups', createBody({ title: '[test] taylor' }))).status).toBe(404);
    expect((await call('morgan', 'POST', '/meetups', createBody({ title: '[test] morgan' }))).status).toBe(404);
    const rows = await owner`select 1 from public.meetups where title in ('[test] taylor', '[test] morgan')`;
    expect(rows).toHaveLength(0);
  });
});

describe('POST /meetups/:id/cancel (creator only)', () => {
  it('member who is not the creator -> 403; outsider -> 404; meetup unchanged', async () => {
    const id = await fixtureMeetup({ creator: 'avery', rsvps: ['jordan'] });
    expect((await call('jordan', 'POST', `/meetups/${id}/cancel`)).status).toBe(403);
    expect((await call('sam', 'POST', `/meetups/${id}/cancel`)).body.error.code).toBe('forbidden');
    const outsider = await call('taylor', 'POST', `/meetups/${id}/cancel`);
    expect(outsider.status).toBe(404);
    expect(outsider.body).toEqual((await call('taylor', 'POST', `/meetups/${RANDOM_ID}/cancel`)).body);
    const [row] = await owner`select status from public.meetups where id = ${id}`;
    expect(row!.status).toBe('scheduled');
  });

  it('creator cancels; it stays visible, marked, attendees kept; repeat is a no-op', async () => {
    const id = await fixtureMeetup({ creator: 'avery', rsvps: ['jordan'] });
    const r = await call('avery', 'POST', `/meetups/${id}/cancel`);
    expect(r.status).toBe(200);
    const m = MeetupResponse.parse(r.body).meetup;
    expect(m.status).toBe('cancelled');
    expect(m.cancelledAt).not.toBeNull();
    expect(m.viewer.canCancel).toBe(false);

    const asSam = MeetupResponse.parse((await call('sam', 'GET', `/meetups/${id}`)).body).meetup;
    expect(asSam.status).toBe('cancelled');
    expect(asSam.attendees.map((a) => a.id)).toEqual([U.jordan]);
    expect(asSam.viewer.canRsvp).toBe(false);
    expect((await call('taylor', 'GET', `/meetups/${id}`)).status).toBe(404);

    expect((await call('avery', 'POST', `/meetups/${id}/cancel`)).status).toBe(200);
  });

  it('cancel takes no body', async () => {
    const id = await fixtureMeetup({ creator: 'avery' });
    expect((await call('avery', 'POST', `/meetups/${id}/cancel`, { status: 'scheduled' })).status).toBe(400);
  });

  it('cannot be reopened through any endpoint (edit rejects a cancelled meetup)', async () => {
    const id = await fixtureMeetup({ creator: 'avery' });
    await call('avery', 'POST', `/meetups/${id}/cancel`);
    const r = await call('avery', 'PATCH', `/meetups/${id}`, { title: '[test] reopen?' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('meetup_cancelled');
    expect((await call('avery', 'PATCH', `/meetups/${id}`, { status: 'scheduled' })).status).toBe(400);
  });
});

describe('POST /meetups/:id/rsvp', () => {
  it('member RSVPs; repeating it is not an error and leaves one RSVP', async () => {
    const id = await fixtureMeetup();
    const first = await call('sam', 'POST', `/meetups/${id}/rsvp`);
    expect(first.status).toBe(200);
    expect(RsvpResponse.parse(first.body)).toEqual({ meetupId: id, attending: true });
    expect((await call('sam', 'POST', `/meetups/${id}/rsvp`)).status).toBe(200);
    const rows = await owner`select 1 from public.rsvps where meetup_id = ${id} and user_id = ${U.sam}`;
    expect(rows).toHaveLength(1);
    const detail = MeetupResponse.parse((await call('sam', 'GET', `/meetups/${id}`)).body).meetup;
    expect(detail.viewer).toMatchObject({ hasRsvp: true, canRsvp: false });
    expect(detail.attendees.map((a) => a.displayName)).toEqual(['Sam Okafor']);
  });

  it('outsider and other-group member -> 404 (same as unknown id)', async () => {
    const id = await fixtureMeetup();
    const t = await call('taylor', 'POST', `/meetups/${id}/rsvp`);
    expect(t.status).toBe(404);
    expect(t.body).toEqual((await call('taylor', 'POST', `/meetups/${RANDOM_ID}/rsvp`)).body);
    expect((await call('morgan', 'POST', `/meetups/${id}/rsvp`)).status).toBe(404);
    expect(await owner`select 1 from public.rsvps where meetup_id = ${id}`).toHaveLength(0);
  });

  it('cannot RSVP for someone else', async () => {
    const id = await fixtureMeetup();
    const r = await call('sam', 'POST', `/meetups/${id}/rsvp`, { userId: U.quinn });
    expect(r.status).toBe(400);
    expect(await owner`select 1 from public.rsvps where meetup_id = ${id}`).toHaveLength(0);
  });

  it('cancelled meetup -> 409 meetup_cancelled', async () => {
    const id = await fixtureMeetup({ creator: 'avery' });
    await call('avery', 'POST', `/meetups/${id}/cancel`);
    const r = await call('riley', 'POST', `/meetups/${id}/rsvp`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('meetup_cancelled');
  });

  it('started meetup -> 409 meetup_started', async () => {
    const id = await fixtureMeetup();
    await makeStarted(id);
    const r = await call('sam', 'POST', `/meetups/${id}/rsvp`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('meetup_started');
    expect(MeetupResponse.parse((await call('sam', 'GET', `/meetups/${id}`)).body).meetup.viewer.canRsvp).toBe(false);
  });
});

describe('DELETE /meetups/:id/rsvp (withdraw)', () => {
  it('withdraws only the caller\'s own RSVP; repeat is fine', async () => {
    const id = await fixtureMeetup({ rsvps: ['jordan', 'sam'] });
    const r = await call('sam', 'DELETE', `/meetups/${id}/rsvp`);
    expect(RsvpResponse.parse(r.body)).toEqual({ meetupId: id, attending: false });
    expect((await call('sam', 'DELETE', `/meetups/${id}/rsvp`)).status).toBe(200);
    const left = await owner`select user_id from public.rsvps where meetup_id = ${id}`;
    expect(left.map((x) => x.user_id)).toEqual([U.jordan]);
  });

  it('allowed after the meetup is cancelled', async () => {
    const id = await fixtureMeetup({ creator: 'avery', rsvps: ['jordan'] });
    await call('avery', 'POST', `/meetups/${id}/cancel`);
    expect((await call('jordan', 'DELETE', `/meetups/${id}/rsvp`)).status).toBe(200);
    expect(await owner`select 1 from public.rsvps where meetup_id = ${id}`).toHaveLength(0);
  });

  it('outsider -> 404 and nobody\'s RSVP is touched', async () => {
    const id = await fixtureMeetup({ rsvps: ['jordan'] });
    expect((await call('taylor', 'DELETE', `/meetups/${id}/rsvp`)).status).toBe(404);
    expect(await owner`select 1 from public.rsvps where meetup_id = ${id}`).toHaveLength(1);
  });
});

describe('PATCH /meetups/:id (bonus: edit)', () => {
  it('creator edits; non-creator member 403; outsider 404', async () => {
    const id = await fixtureMeetup({ creator: 'avery' });
    const r = await call('avery', 'PATCH', `/meetups/${id}`, {
      title: '[test] edited',
      meetingPoint: { name: 'North gate, Linden Park', lat: 40.012046, lng: -99.984517 },
    });
    expect(r.status).toBe(200);
    expect(MeetupResponse.parse(r.body).meetup).toMatchObject({ title: '[test] edited', meetingPoint: { name: 'North gate, Linden Park' } });
    expect((await call('jordan', 'PATCH', `/meetups/${id}`, { title: '[test] hijack' })).status).toBe(403);
    expect((await call('taylor', 'PATCH', `/meetups/${id}`, { title: '[test] hijack' })).status).toBe(404);
  });

  it('a changed start time must still be in the future', async () => {
    const id = await fixtureMeetup({ creator: 'avery' });
    expect((await call('avery', 'PATCH', `/meetups/${id}`, { startsAt: inDays(-1) })).status).toBe(400);
    const ok = await call('avery', 'PATCH', `/meetups/${id}`, { startsAt: inDays(9) });
    expect(ok.status).toBe(200);
  });

  it('a started meetup cannot be edited', async () => {
    const id = await fixtureMeetup({ creator: 'avery' });
    await makeStarted(id);
    const r = await call('avery', 'PATCH', `/meetups/${id}`, { title: '[test] late edit' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('meetup_started');
  });

  it('empty or unknown fields -> 400', async () => {
    const id = await fixtureMeetup({ creator: 'avery' });
    expect((await call('avery', 'PATCH', `/meetups/${id}`, {})).status).toBe(400);
    expect((await call('avery', 'PATCH', `/meetups/${id}`, { groupId: G.riverside })).status).toBe(400);
  });
});

describe('home location', () => {
  it('no response in this suite contains a home location', () => {
    expect(seen.length).toBeGreaterThan(50);
    expect(leaksHome(seen)).toBe(false);
  });
});
