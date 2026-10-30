import { describe, expect, it } from 'vitest';
import {
  ApiError,
  CreateMeetupRequest,
  EditMeetupRequest,
  editMeetupRequest,
  EmptyBody,
  futureDateTime,
  MeetupDetail,
  MeetupIdParams,
  MeetupSummary,
  MyGroupsResponse,
  toIssues,
} from '../src';

const MAPLE = 'b2000000-0000-4000-8000-000000000001';
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const valid = () => ({
  groupId: MAPLE,
  title: 'Saturday morning loop',
  startsAt: inAnHour(),
  meetingPoint: { name: 'Fountain plaza, Town Green', lat: 39.999134, lng: -99.999461 },
});
const issuesOf = (r: { success: boolean; error?: unknown }) =>
  r.success ? [] : toIssues(r.error as never);

describe('CreateMeetupRequest', () => {
  it('accepts a valid request', () => {
    expect(CreateMeetupRequest.safeParse(valid()).success).toBe(true);
  });

  it('trims the title and place name', () => {
    const out = CreateMeetupRequest.parse({
      ...valid(),
      title: '  Loop  ',
      meetingPoint: { ...valid().meetingPoint, name: '  Gate  ' },
    });
    expect(out.title).toBe('Loop');
    expect(out.meetingPoint.name).toBe('Gate');
  });

  it.each([
    ['empty title', { title: '' }, 'title'],
    ['whitespace-only title', { title: '    ' }, 'title'],
    ['81-char title', { title: 'x'.repeat(81) }, 'title'],
    ['non-uuid group', { groupId: 'maple' }, 'groupId'],
    ['missing start', { startsAt: undefined }, 'startsAt'],
    ['naive local time (no zone)', { startsAt: '2030-01-01T08:00:00' }, 'startsAt'],
    ['not a date', { startsAt: 'next saturday' }, 'startsAt'],
  ])('rejects %s', (_n, patch, path) => {
    const r = CreateMeetupRequest.safeParse({ ...valid(), ...patch });
    expect(r.success).toBe(false);
    expect(issuesOf(r).map((i) => i.path)).toContain(path);
  });

  it('accepts exactly 80 chars after trimming', () => {
    expect(CreateMeetupRequest.safeParse({ ...valid(), title: ` ${'x'.repeat(80)} ` }).success).toBe(true);
  });

  it('rejects a start time in the past', () => {
    const r = CreateMeetupRequest.safeParse({ ...valid(), startsAt: '2020-01-01T00:00:00Z' });
    expect(issuesOf(r)).toEqual([{ path: 'startsAt', message: 'start time must be in the future' }]);
  });

  it('rejects a start time equal to now (strictly future)', () => {
    const now = Date.parse('2030-01-01T00:00:00Z');
    const schema = futureDateTime(() => now);
    expect(schema.safeParse('2030-01-01T00:00:00Z').success).toBe(false);
    expect(schema.safeParse('2030-01-01T00:00:01Z').success).toBe(true);
  });

  it('accepts an explicit offset', () => {
    const t = new Date(Date.now() + 86_400_000).toISOString().replace('Z', '+00:00');
    expect(CreateMeetupRequest.safeParse({ ...valid(), startsAt: t }).success).toBe(true);
  });

  it.each([
    ['place name empty', { name: '' }, 'meetingPoint.name'],
    ['place name 121 chars', { name: 'x'.repeat(121) }, 'meetingPoint.name'],
    ['lat 90.0001', { lat: 90.0001 }, 'meetingPoint.lat'],
    ['lat -91', { lat: -91 }, 'meetingPoint.lat'],
    ['lng 180.5', { lng: 180.5 }, 'meetingPoint.lng'],
    ['lat as string', { lat: '40' }, 'meetingPoint.lat'],
    ['lat NaN', { lat: Number.NaN }, 'meetingPoint.lat'],
    ['lng Infinity', { lng: Number.POSITIVE_INFINITY }, 'meetingPoint.lng'],
  ])('rejects meeting point with %s', (_n, patch, path) => {
    const r = CreateMeetupRequest.safeParse({ ...valid(), meetingPoint: { ...valid().meetingPoint, ...patch } });
    expect(issuesOf(r).map((i) => i.path)).toContain(path);
  });

  it('accepts boundary coordinates', () => {
    for (const [lat, lng] of [[90, 180], [-90, -180], [0, 0]]) {
      expect(CreateMeetupRequest.safeParse({ ...valid(), meetingPoint: { name: 'x', lat, lng } }).success).toBe(true);
    }
  });

  it.each([
    ['createdBy', { createdBy: 'a1000000-0000-4000-8000-000000000001' }],
    ['created_by', { created_by: 'a1000000-0000-4000-8000-000000000001' }],
    ['status', { status: 'cancelled' }],
    ['id', { id: 'c3000000-0000-4000-8000-000000000001' }],
  ])('rejects unexpected key %s (creator never comes from the body)', (key, patch) => {
    const r = CreateMeetupRequest.safeParse({ ...valid(), ...patch });
    expect(r.success).toBe(false);
    expect(JSON.stringify(issuesOf(r))).toContain(key);
  });

  it.each([
    ['NUL byte', 'walk\u0000now'],
    ['newline', 'line one\nline two'],
    ['tab', 'a\tb'],
    ['DEL', 'a\u007fb'],
    ['unpaired high surrogate', 'walk \ud800'],
    ['unpaired low surrogate', '\udc00 walk'],
  ])('rejects %s in title and place name', (_n, text) => {
    expect(issuesOf(CreateMeetupRequest.safeParse({ ...valid(), title: text })).map((i) => i.path)).toContain('title');
    const place = CreateMeetupRequest.safeParse({ ...valid(), meetingPoint: { ...valid().meetingPoint, name: text } });
    expect(issuesOf(place).map((i) => i.path)).toContain('meetingPoint.name');
  });

  it.each(['Café walk 🐕', 'Ünter den Linden', 'Парк', 'حديقة', '公园散步'])('accepts real-world text %j', (title) => {
    expect(CreateMeetupRequest.safeParse({ ...valid(), title }).success).toBe(true);
  });

  it('rejects unexpected keys inside meetingPoint', () => {
    const r = CreateMeetupRequest.safeParse({ ...valid(), meetingPoint: { ...valid().meetingPoint, home_lat: 1 } });
    expect(r.success).toBe(false);
  });

  it.each([null, undefined, 'string', 42, []])('rejects non-object body %j', (body) => {
    expect(CreateMeetupRequest.safeParse(body).success).toBe(false);
  });
});

describe('path params and empty bodies (cancel / RSVP / withdraw)', () => {
  it('accepts a uuid meetupId', () => {
    expect(MeetupIdParams.safeParse({ meetupId: 'c3000000-0000-4000-8000-000000000001' }).success).toBe(true);
  });
  it.each(['1', 'abc', "c3000000' or 1=1 --", ''])('rejects meetupId %j', (meetupId) => {
    expect(MeetupIdParams.safeParse({ meetupId }).success).toBe(false);
  });
  it('accepts an empty body', () => {
    expect(EmptyBody.safeParse({}).success).toBe(true);
  });
  it('rejects a body that tries to RSVP for someone else', () => {
    expect(EmptyBody.safeParse({ userId: 'a1000000-0000-4000-8000-000000000002' }).success).toBe(false);
  });
});

describe('EditMeetupRequest (bonus)', () => {
  it('accepts a single field', () => {
    expect(EditMeetupRequest.safeParse({ title: 'New title' }).success).toBe(true);
  });
  it('rejects an empty edit', () => {
    expect(issuesOf(EditMeetupRequest.safeParse({}))[0]?.message).toBe('nothing to update');
  });
  it('rejects a changed start time in the past', () => {
    const r = editMeetupRequest(() => Date.parse('2030-01-01T00:00:00Z')).safeParse({ startsAt: '2029-12-31T23:00:00Z' });
    expect(issuesOf(r).map((i) => i.path)).toEqual(['startsAt']);
  });
  it.each([{ groupId: MAPLE }, { status: 'scheduled' }, { createdBy: MAPLE }])('rejects %j', (patch) => {
    expect(EditMeetupRequest.safeParse({ title: 'x', ...patch }).success).toBe(false);
  });
});

describe('responses', () => {
  const detail = {
    id: 'c3000000-0000-4000-8000-000000000001',
    groupId: MAPLE,
    title: 'Saturday morning loop',
    startsAt: '2030-01-01T08:00:00Z',
    status: 'scheduled',
    cancelledAt: null,
    meetingPoint: { kind: 'exact', name: 'North gate, Linden Park', lat: 40.012046, lng: -99.984517 },
    createdBy: { id: 'a1000000-0000-4000-8000-000000000001', displayName: 'Avery Lin' },
    attendeeCount: 2,
    viewer: { isCreator: false, hasRsvp: true, canRsvp: false, canCancel: false, canEdit: false },
    attendees: [{ id: 'a1000000-0000-4000-8000-000000000002', displayName: 'Jordan Price' }],
  };

  it('parses a meetup detail', () => {
    expect(MeetupDetail.parse(detail)).toEqual(detail);
  });

  it('strips fields not in the contract (a stray home location never goes out)', () => {
    const leaky = {
      ...detail,
      home_lat: 40.004812,
      createdBy: { ...detail.createdBy, home_lat: 40.004812, home_lng: -99.993127 },
      attendees: [{ ...detail.attendees[0], home_lng: -99.98864 }],
    };
    const out = JSON.stringify(MeetupDetail.parse(leaky));
    expect(out).not.toMatch(/home_l(at|ng)|40\.004812|-99\.993127|-99\.98864/);
  });

  it('summary has no attendee list', () => {
    expect('attendees' in MeetupSummary.parse(detail)).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(MeetupDetail.safeParse({ ...detail, status: 'reopened' }).success).toBe(false);
  });

  it('parses my groups', () => {
    expect(MyGroupsResponse.parse({ groups: [{ id: MAPLE, name: 'Maple Street Walkers' }] }).groups).toHaveLength(1);
  });

  it('parses the error envelope', () => {
    const e = { error: { code: 'validation_error', message: 'Invalid request', issues: [{ path: 'title', message: 'x' }] } };
    expect(ApiError.parse(e)).toEqual(e);
    expect(ApiError.safeParse({ error: { code: 'teapot', message: 'x' } }).success).toBe(false);
  });
});
