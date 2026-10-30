import postgres from 'postgres';
import type { Member } from './auth.js';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

// The server connects as the project owner but never queries as it. Every
// request runs in its own transaction that first drops to an API role and
// sets the verified JWT claims, so auth.uid() is the member and RLS applies:
//
//   reads  -> role authenticated (the same read-only role the REST API uses)
//   writes -> role meetup_writer (authenticated + the write grants/policies)
export type DbRole = 'authenticated' | 'meetup_writer';

export function createSql(databaseUrl: string): Sql {
  return postgres(databaseUrl, {
    max: 10,
    prepare: true, // session pooler (port 5432): prepared statements are cached per connection
    idle_timeout: 20,
    onnotice: () => {},
  });
}

export async function asMember<T>(sql: Sql, member: Member, role: DbRole, fn: (tx: Tx) => Promise<T>) {
  return sql.begin(async (tx) => {
    // set_config(..., true) is SET LOCAL. `role` is typed as one of two
    // literals; claims are the verified token payload.
    // .execute() sends it NOW: postgres.js queries are lazy (sent on await),
    // and without it fn()'s first query went out first, as the owner with no
    // claims (RLS bypassed; caught by the access tests). Sent first, fn()'s
    // queries are pipelined behind it on the same connection, in order,
    // saving a network round trip per request.
    const context = tx`select set_config('role', ${role}, true),
                              set_config('request.jwt.claims', ${JSON.stringify(member.claims)}, true)`.execute();
    const result = fn(tx);
    await context;
    return result;
  }) as Promise<T>;
}
