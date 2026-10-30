// Location privacy (spec sections 7 and 8).
// Decision: every member of the group sees the exact meeting point (see
// docs/DECISIONS.md). These tests pin that behaviour and the home-location rule.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ListMeetupsResponse, MeetupResponse } from '@altair/contract';
import { api, cleanup, closeAll, fixtureMeetup, G, leaksHome, M } from './helpers';

beforeAll(cleanup);
afterAll(closeAll);

// Exactly the keys the contract allows, recursively: a response can carry
// nothing it was not designed to (no raw columns, no ids of other rows' owners).
const MEETUP_KEYS = ['attendeeCount', 'cancelledAt', 'createdBy', 'groupId', 'id', 'meetingPoint', 'startsAt', 'status', 'title', 'viewer'];
const shapeOf = (m: Record<string, unknown>) => ({
  top: Object.keys(m).sort(),
  meetingPoint: Object.keys(m.meetingPoint as object).sort(),
  createdBy: Object.keys(m.createdBy as object).sort(),
  viewer: Object.keys(m.viewer as object).sort(),
});

describe('map data', () => {
  it('before and after RSVP: the same exact point, only the viewer flags change', async () => {
    const id = await fixtureMeetup({ title: '[test] map-rsvp' });
    const before = MeetupResponse.parse((await api('sam', 'GET', `/meetups/${id}`)).body).meetup;
    expect((await api('sam', 'POST', `/meetups/${id}/rsvp`)).status).toBe(200);
    const after = MeetupResponse.parse((await api('sam', 'GET', `/meetups/${id}`)).body).meetup;

    const exact = { kind: 'exact', name: 'Fountain plaza, Town Green', lat: 39.999134, lng: -99.999461 };
    expect(before.meetingPoint).toEqual(exact);
    expect(after.meetingPoint).toEqual(exact);
    expect([before.viewer.hasRsvp, after.viewer.hasRsvp]).toEqual([false, true]);
  });

  it('outsider gets no map data at all (list 404, detail 404, nothing to render)', async () => {
    const list = await api('taylor', 'GET', `/groups/${G.maple}/meetups`);
    const detail = await api('taylor', 'GET', `/meetups/${M.saturday}`);
    expect([list.status, detail.status]).toEqual([404, 404]);
    expect(JSON.stringify([list.body, detail.body])).not.toMatch(/lat|lng|Linden|40\.012/);
  });
});

describe('response shape', () => {
  it('list and detail carry exactly the contract fields, nothing else', async () => {
    const list = await api('riley', 'GET', `/groups/${G.maple}/meetups`);
    for (const m of ListMeetupsResponse.parse(list.body).meetups) {
      // compare the raw body, not the parsed one: parsing would strip extras
      const raw = (list.body.meetups as Record<string, unknown>[]).find((x) => x.id === m.id)!;
      expect(shapeOf(raw)).toEqual({
        top: MEETUP_KEYS,
        meetingPoint: ['kind', 'lat', 'lng', 'name'],
        createdBy: ['displayName', 'id'],
        viewer: ['canCancel', 'canEdit', 'canRsvp', 'hasRsvp', 'isCreator'],
      });
    }
    const detail = (await api('riley', 'GET', `/meetups/${M.saturday}`)).body.meetup;
    expect(Object.keys(detail).sort()).toEqual([...MEETUP_KEYS, 'attendees'].sort());
    for (const a of detail.attendees) expect(Object.keys(a).sort()).toEqual(['displayName', 'id']);
  });

  it('no response for any persona contains a home location', async () => {
    const paths = ['/groups', ...[G.maple, G.riverside].map((g) => `/groups/${g}/meetups`), ...Object.values(M).map((m) => `/meetups/${m}`)];
    const bodies = [];
    for (const who of ['avery', 'jordan', 'sam', 'riley', 'morgan', 'casey', 'quinn', 'taylor'] as const) {
      const results = await Promise.all(paths.map((p) => api(who, 'GET', p)));
      bodies.push(...results.map((r) => r.body));
    }
    expect(bodies).toHaveLength(48);
    expect(leaksHome(bodies)).toBe(false);
  });
});

describe('static audit: nothing in this slice reads a home location', () => {
  const root = path.resolve(__dirname, '../..');
  const sources = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(p);
      return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
    });

  it.each(['server/src', 'app/src', 'packages/contract/src'])('%s never mentions home_lat / home_lng / homeLat', (dir) => {
    const files = sources(path.join(root, dir));
    expect(files.length).toBeGreaterThan(3);
    const hits = files.filter((f) => /home_?l(at|ng)|homeLocation/i.test(fs.readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('migrations never grant, select or expose home_lat / home_lng (only the starter defines them)', () => {
    const dir = path.join(root, 'supabase/migrations');
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.includes('_starter'))) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--.*$/gm, ''); // ignore comments
      expect({ f, hit: /home_l(at|ng)/.test(sql) }).toEqual({ f, hit: false });
    }
  });

  it('the app never requests location permission or the device position', () => {
    const files = sources(path.join(root, 'app/src')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(files).not.toMatch(/expo-location|showsUserLocation|getCurrentPosition|watchPosition/);
    const appJson = fs.readFileSync(path.join(root, 'app/app.json'), 'utf8');
    expect(appJson).not.toMatch(/ACCESS_(FINE|COARSE)_LOCATION|expo-location/);
  });
});
