import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { z } from 'zod';
import {
  ApiError,
  CreateMeetupRequest,
  EditMeetupRequest,
  EmptyBody,
  GroupIdParams,
  HTTP_STATUS,
  ListMeetupsResponse,
  MeetupIdParams,
  MeetupResponse,
  MyGroupsResponse,
  RsvpResponse,
  toIssues,
} from '@altair/contract';
import type { Member } from './auth.js';
import { asMember, type Sql, type Tx } from './db.js';
import { ApiFailure, fromDatabase } from './errors.js';
import * as q from './queries.js';
import type { Logger } from './log.js';

type Deps = {
  sql: Sql;
  verify: (authorization: string | undefined) => Promise<Member>;
  log: Logger;
};
type Env = { Variables: { member: Member } };

// ---- validation helpers: the shared contract is the only gate -------------

function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new ApiFailure('validation_error', 'Invalid request', toIssues(r.error));
  return r.data;
}

async function jsonBody(c: Context, { optional = false } = {}): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') return optional ? {} : undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiFailure('validation_error', 'Request body must be valid JSON');
  }
}

// Outbound: parse with the response schema (strip) before sending, so only
// contract fields leave the server.
function send<S extends z.ZodType>(c: Context, schema: S, value: z.input<S>, status: 200 | 201 = 200) {
  return c.json(schema.parse(value), status);
}

// ---- app -------------------------------------------------------------------

export function createApp({ sql, verify, log }: Deps) {
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    log.info('request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
      member: c.get('member')?.id,
    });
  });

  app.use('*', bodyLimit({
    maxSize: 16 * 1024,
    onError: () => {
      throw new ApiFailure('validation_error', 'Request body too large');
    },
  }));

  app.onError((err, c) => {
    const failure = err instanceof ApiFailure ? err : null;
    if (!failure) log.error('unhandled', { path: c.req.path, error: err instanceof Error ? err.message : String(err) });
    const code = failure?.code ?? 'internal';
    const body = ApiError.parse({
      error: {
        code,
        message: failure?.message ?? 'Something went wrong',
        ...(failure?.issues ? { issues: failure.issues } : {}),
      },
    });
    return c.json(body, HTTP_STATUS[code] as 400);
  });

  app.notFound(() => {
    throw new ApiFailure('not_found', 'Not found');
  });

  app.get('/health', (c) => c.json({ ok: true }));

  // Everything below requires a verified member session.
  app.use('*', async (c, next) => {
    c.set('member', await verify(c.req.header('authorization')));
    await next();
  });

  const read = <T>(c: Context<Env>, fn: (tx: Tx, m: Member) => Promise<T>) =>
    asMember(sql, c.get('member'), 'authenticated', (tx) => fn(tx, c.get('member')));

  const write = <T>(c: Context<Env>, fn: (tx: Tx, m: Member) => Promise<T>) =>
    asMember(sql, c.get('member'), 'meetup_writer', (tx) => fn(tx, c.get('member'))).catch((e) => {
      if (e instanceof ApiFailure) throw e;
      throw fromDatabase(e);
    });

  // A write that touched 0 rows: explain it without revealing anything to an
  // outsider. Invisible -> not_found. Visible but not the creator -> forbidden.
  async function explainNoop(tx: Tx, meetupId: string, memberId: string): Promise<never> {
    const facts = await q.meetupFacts(tx, meetupId);
    if (!facts) throw new ApiFailure('not_found', 'Meetup not found');
    if (facts.created_by !== memberId) throw new ApiFailure('forbidden', 'Only the creator can change this meetup');
    if (facts.status === 'cancelled') throw new ApiFailure('meetup_cancelled', 'This meetup has been cancelled');
    throw new ApiFailure('internal', 'Something went wrong');
  }

  async function detailOrNotFound(tx: Tx, meetupId: string, memberId: string) {
    const meetup = await q.meetupDetail(tx, meetupId, memberId);
    if (!meetup) throw new ApiFailure('not_found', 'Meetup not found');
    return meetup;
  }

  // ---- reads (role authenticated, RLS) ----

  app.get('/groups', async (c) => {
    const groups = await read(c, (tx) => q.myGroups(tx));
    return send(c, MyGroupsResponse, { groups });
  });

  app.get('/groups/:groupId/meetups', async (c) => {
    const { groupId } = parse(GroupIdParams, c.req.param());
    const meetups = await read(c, async (tx, m) => {
      if (!(await q.groupVisible(tx, groupId))) throw new ApiFailure('not_found', 'Group not found');
      return q.groupMeetups(tx, groupId, m.id);
    });
    return send(c, ListMeetupsResponse, { meetups });
  });

  app.get('/meetups/:meetupId', async (c) => {
    const { meetupId } = parse(MeetupIdParams, c.req.param());
    const meetup = await read(c, (tx, m) => detailOrNotFound(tx, meetupId, m.id));
    return send(c, MeetupResponse, { meetup });
  });

  // ---- writes (role meetup_writer, RLS + triggers) ----

  app.post('/meetups', async (c) => {
    const body = parse(CreateMeetupRequest, await jsonBody(c));
    const meetup = await write(c, async (tx, m) => {
      // created_by is not in the column list: it defaults to auth.uid().
      const [row] = await tx<{ id: string }[]>`
        insert into public.meetups
          (group_id, title, starts_at, meeting_point_name, meeting_point_lat, meeting_point_lng)
        values (${body.groupId}, ${body.title}, ${body.startsAt},
                ${body.meetingPoint.name}, ${body.meetingPoint.lat}, ${body.meetingPoint.lng})
        returning id`;
      return detailOrNotFound(tx, row!.id, m.id);
    });
    return send(c, MeetupResponse, { meetup }, 201);
  });

  app.post('/meetups/:meetupId/cancel', async (c) => {
    const { meetupId } = parse(MeetupIdParams, c.req.param());
    parse(EmptyBody, await jsonBody(c, { optional: true }));
    const meetup = await write(c, async (tx, m) => {
      const updated = await tx`
        update public.meetups set status = 'cancelled'
        where id = ${meetupId} and status = 'scheduled'
        returning id`;
      if (updated.length === 0) {
        const facts = await q.meetupFacts(tx, meetupId);
        // Cancelling an already-cancelled meetup again is a no-op for its creator.
        if (!(facts && facts.created_by === m.id && facts.status === 'cancelled')) {
          await explainNoop(tx, meetupId, m.id);
        }
      }
      return detailOrNotFound(tx, meetupId, m.id);
    });
    return send(c, MeetupResponse, { meetup });
  });

  app.patch('/meetups/:meetupId', async (c) => {
    const { meetupId } = parse(MeetupIdParams, c.req.param());
    const body = parse(EditMeetupRequest, await jsonBody(c));
    const meetup = await write(c, async (tx, m) => {
      const set: Record<string, unknown> = {};
      if (body.title !== undefined) set.title = body.title;
      if (body.startsAt !== undefined) set.starts_at = body.startsAt;
      if (body.meetingPoint) {
        set.meeting_point_name = body.meetingPoint.name;
        set.meeting_point_lat = body.meetingPoint.lat;
        set.meeting_point_lng = body.meetingPoint.lng;
      }
      // Column names come from the fixed keys above, never from the request.
      const updated = await tx`
        update public.meetups set ${tx(set)}
        where id = ${meetupId}
        returning id`;
      if (updated.length === 0) await explainNoop(tx, meetupId, m.id);
      return detailOrNotFound(tx, meetupId, m.id);
    });
    return send(c, MeetupResponse, { meetup });
  });

  app.post('/meetups/:meetupId/rsvp', async (c) => {
    const { meetupId } = parse(MeetupIdParams, c.req.param());
    parse(EmptyBody, await jsonBody(c, { optional: true }));
    await write(c, async (tx) => {
      // user_id is not in the column list: it defaults to auth.uid().
      // A repeat RSVP hits the unique constraint and does nothing.
      await tx`
        insert into public.rsvps (meetup_id) values (${meetupId})
        on conflict (meetup_id, user_id) do nothing`;
    });
    return send(c, RsvpResponse, { meetupId, attending: true });
  });

  app.delete('/meetups/:meetupId/rsvp', async (c) => {
    const { meetupId } = parse(MeetupIdParams, c.req.param());
    await write(c, async (tx, m) => {
      const deleted = await tx`
        delete from public.rsvps
        where meetup_id = ${meetupId} and user_id = ${m.id}
        returning id`;
      // Nothing to withdraw: fine for a member (idempotent), but an outsider
      // still learns nothing about whether the meetup exists.
      if (deleted.length === 0 && !(await q.meetupFacts(tx, meetupId))) {
        throw new ApiFailure('not_found', 'Meetup not found');
      }
    });
    return send(c, RsvpResponse, { meetupId, attending: false });
  });

  return app;
}
