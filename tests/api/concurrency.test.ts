// Races the spec cares about, run with real parallel requests:
// - "RSVPing twice ... leaves one RSVP", even when the two arrive together
// - "no RSVPs to a cancelled meetup", even when the RSVP races the cancel
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asMember } from '../../server/src/db';
import { api, cleanup, closeAll, fixtureMeetup, owner, U } from './helpers';

const member = (id: string) => ({ id, claims: { sub: id, role: 'authenticated' } });

beforeAll(cleanup);
afterAll(closeAll);

describe('concurrency', () => {
  it('8 simultaneous RSVPs from one member: all succeed, exactly one row', async () => {
    const id = await fixtureMeetup({ title: '[test] dup-race' });
    const results = await Promise.all(Array.from({ length: 8 }, () => api('sam', 'POST', `/meetups/${id}/rsvp`)));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(await owner`select 1 from public.rsvps where meetup_id = ${id} and user_id = ${U.sam}`).toHaveLength(1);
  });

  it('RSVPs racing a cancel: every RSVP that landed was committed before the cancel', async () => {
    for (let round = 0; round < 3; round++) {
      const id = await fixtureMeetup({ creator: 'avery', title: `[test] cancel-race-${round}` });
      const [cancel, ...rsvps] = await Promise.all([
        api('avery', 'POST', `/meetups/${id}/cancel`),
        api('sam', 'POST', `/meetups/${id}/rsvp`),
        api('jordan', 'POST', `/meetups/${id}/rsvp`),
        api('riley', 'POST', `/meetups/${id}/rsvp`),
      ]);
      expect(cancel.status).toBe(200);
      for (const r of rsvps) expect([200, 409]).toContain(r.status);

      const [m] = await owner`select status, cancelled_at from public.meetups where id = ${id}`;
      expect(m!.status).toBe('cancelled');
      const late = await owner`select 1 from public.rsvps where meetup_id = ${id} and created_at > ${m!.cancelled_at}`;
      expect(late).toHaveLength(0);
      // each 200 corresponds to a stored RSVP, each 409 to none
      const stored = await owner<{ user_id: string }[]>`select user_id from public.rsvps where meetup_id = ${id}`;
      expect(stored.length).toBe(rsvps.filter((r) => r.status === 200).length);
    }
  });

  // Deterministic replay of the interleaving that the random race above first
  // exposed: the cancel's transaction STARTS first, the RSVP inserts first and
  // holds its FOR SHARE lock, the cancel's UPDATE waits, then both commit.
  // Before 20261030130000 the RSVP was stamped after cancelled_at.
  it('cancel blocked by an in-flight RSVP: RSVP kept, stamped before the cancel', async () => {
    const id = await fixtureMeetup({ creator: 'avery', title: '[test] race-replay' });
    let rsvpInserted!: () => void;
    const inserted = new Promise<void>((r) => (rsvpInserted = r));
    let allowCommit!: () => void;
    const commit = new Promise<void>((r) => (allowCommit = r));

    const cancel = asMember(owner, member(U.avery), 'meetup_writer', async (tx) => {
      await inserted; // this transaction began before the RSVP's
      const pending = tx`update public.meetups set status = 'cancelled' where id = ${id} returning id`;
      setTimeout(allowCommit, 500); // let the UPDATE queue on the RSVP's lock
      return pending;
    });
    await new Promise((r) => setTimeout(r, 300));
    const rsvp = asMember(owner, member(U.sam), 'meetup_writer', async (tx) => {
      await tx`insert into public.rsvps (meetup_id) values (${id})`;
      rsvpInserted();
      await commit;
    });
    await Promise.all([cancel, rsvp]);

    const [row] = await owner`
      select m.status, r.created_at < m.cancelled_at as rsvp_before_cancel
      from public.meetups m join public.rsvps r on r.meetup_id = m.id where m.id = ${id}`;
    expect(row).toEqual({ status: 'cancelled', rsvp_before_cancel: true });
  });
});
