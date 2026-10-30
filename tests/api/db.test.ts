// The endpoint connects as the owner; this proves every request really runs
// as the API role with the member's identity (so RLS applies), and that the
// role does not leak to the next query on the pooled connection.
import { afterAll, describe, expect, it } from 'vitest';
import { asMember, createSql } from '../../server/src/db';
import { U } from './helpers';

const sql = createSql(process.env.DATABASE_URL!);
afterAll(() => sql.end({ timeout: 5 }));
const member = { id: U.sam, claims: { sub: U.sam, role: 'authenticated' } };

describe('asMember', () => {
  it.each(['authenticated', 'meetup_writer'] as const)('runs as %s with auth.uid() = the member', async (role) => {
    const [row] = await asMember(sql, member, role, (tx) => tx`select current_user as role, auth.uid() as uid`);
    expect(row).toEqual({ role, uid: U.sam });
  });

  it('the role ends with the transaction (pooled connection is back to the owner)', async () => {
    await asMember(sql, member, 'meetup_writer', (tx) => tx`select 1`);
    const rows = await Promise.all(Array.from({ length: 10 }, () => sql`select current_user as role, auth.uid() as uid`));
    for (const [row] of rows) expect(row).toEqual({ role: 'postgres', uid: null });
  });

  it('a failed transaction also drops the role', async () => {
    await expect(asMember(sql, member, 'authenticated', (tx) => tx`select home_lat from public.users`)).rejects.toThrow(/permission denied/);
    const [row] = await sql`select current_user as role`;
    expect(row!.role).toBe('postgres');
  });
});
