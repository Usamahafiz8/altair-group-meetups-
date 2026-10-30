import type { Group, MeetupDetail, MeetupSummary, Person } from '@altair/contract';
import type { Tx } from './db.js';

// All reads run inside asMember(), so RLS decides which rows exist. Columns are
// listed explicitly: users is only ever read as (id, display_name), which is
// also all the API roles are granted.

type MeetupRow = {
  id: string;
  group_id: string;
  title: string;
  starts_at: Date;
  status: 'scheduled' | 'cancelled';
  cancelled_at: Date | null;
  meeting_point_name: string;
  meeting_point_lat: number;
  meeting_point_lng: number;
  created_by: string;
  creator_name: string | null;
  attendee_count: number;
  has_rsvp: boolean;
  not_started: boolean;
};

const meetupColumns = (tx: Tx) => tx`
  m.id, m.group_id, m.title, m.starts_at, m.status, m.cancelled_at,
  m.meeting_point_name, m.meeting_point_lat, m.meeting_point_lng,
  m.created_by, u.display_name as creator_name,
  (select count(*) from public.rsvps r where r.meetup_id = m.id)::int as attendee_count,
  exists (select 1 from public.rsvps r where r.meetup_id = m.id and r.user_id = auth.uid()) as has_rsvp,
  m.starts_at > now() as not_started
`;

function toSummary(row: MeetupRow, memberId: string): MeetupSummary {
  const isCreator = row.created_by === memberId;
  const scheduled = row.status === 'scheduled';
  return {
    id: row.id,
    groupId: row.group_id,
    title: row.title,
    startsAt: row.starts_at.toISOString(),
    status: row.status,
    cancelledAt: row.cancelled_at ? row.cancelled_at.toISOString() : null,
    // Product decision: every member of the group sees the exact point.
    meetingPoint: {
      kind: 'exact',
      name: row.meeting_point_name,
      lat: row.meeting_point_lat,
      lng: row.meeting_point_lng,
    },
    // The creator's name resolves for fellow members; if they have since left
    // every shared group, RLS hides it and we say so rather than drop the row.
    createdBy: { id: row.created_by, displayName: row.creator_name ?? 'Former member' },
    attendeeCount: row.attendee_count,
    viewer: {
      isCreator,
      hasRsvp: row.has_rsvp,
      canRsvp: scheduled && row.not_started && !row.has_rsvp,
      canCancel: isCreator && scheduled,
      canEdit: isCreator && scheduled && row.not_started,
    },
  };
}

export async function myGroups(tx: Tx): Promise<Group[]> {
  return tx<Group[]>`select g.id, g.name from public.groups g order by g.name, g.id`;
}

export async function groupVisible(tx: Tx, groupId: string): Promise<boolean> {
  const [row] = await tx`select 1 from public.groups where id = ${groupId}`;
  return Boolean(row);
}

export async function groupMeetups(tx: Tx, groupId: string, memberId: string): Promise<MeetupSummary[]> {
  const rows = await tx<MeetupRow[]>`
    select ${meetupColumns(tx)}
    from public.meetups m
    left join public.users u on u.id = m.created_by
    where m.group_id = ${groupId}
    order by m.starts_at, m.id`;
  return rows.map((r) => toSummary(r, memberId));
}

export async function meetupDetail(tx: Tx, meetupId: string, memberId: string): Promise<MeetupDetail | null> {
  const [row] = await tx<MeetupRow[]>`
    select ${meetupColumns(tx)}
    from public.meetups m
    left join public.users u on u.id = m.created_by
    where m.id = ${meetupId}`;
  if (!row) return null;
  const attendees = await tx<Person[]>`
    select r.user_id as id, coalesce(u.display_name, 'Former member') as "displayName"
    from public.rsvps r
    left join public.users u on u.id = r.user_id
    where r.meetup_id = ${meetupId}
    order by r.created_at, r.user_id`;
  return { ...toSummary(row, memberId), attendees };
}

// What the caller may know about a meetup, for explaining a write that
// changed nothing (0 rows): invisible -> not_found, visible -> forbidden etc.
export async function meetupFacts(tx: Tx, meetupId: string) {
  const [row] = await tx<{ created_by: string; status: string; not_started: boolean }[]>`
    select created_by, status, starts_at > now() as not_started
    from public.meetups where id = ${meetupId}`;
  return row ?? null;
}
