-- =====================================================================
-- Meetups and RSVPs: tables, constraints, indexes, integrity triggers.
--
-- Column names follow seed PART 2 (created_by, meeting_point_*), so the
-- reference meetups load without remapping.
--
-- This migration holds the data invariants that must be true no matter who
-- writes (app user, endpoint, service role, or owner):
--   * a new meetup starts in the future
--   * the creator / an attendee is a member of the meetup's group
--   * status only moves scheduled -> cancelled; a cancelled meetup is frozen
--   * id, group and creator of a meetup never change
--   * no RSVP to a cancelled meetup or one that has started
--
-- Who may read or write what (RLS policies, grants) is the next migration.
-- RLS is switched on here with no policies, so both tables deny by default,
-- matching the starter.
-- =====================================================================

-- ---------------------------------------------------------------------
-- meetups
-- ---------------------------------------------------------------------
create table public.meetups (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references public.groups (id) on delete cascade,
  -- Defaults to the caller; the endpoint never takes it from the request body.
  created_by          uuid not null default auth.uid()
                      references public.users (id) on delete cascade,

  title               text not null
                      check (char_length(title) between 1 and 80 and btrim(title) <> ''),
  starts_at           timestamptz not null,

  -- Meeting point: a public place. Unrelated to any user's home location.
  meeting_point_name  text not null
                      check (char_length(meeting_point_name) between 1 and 120
                             and btrim(meeting_point_name) <> ''),
  meeting_point_lat   double precision not null
                      check (meeting_point_lat between -90 and 90),
  meeting_point_lng   double precision not null
                      check (meeting_point_lng between -180 and 180),

  status              text not null default 'scheduled'
                      check (status in ('scheduled', 'cancelled')),
  cancelled_at        timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint meetups_cancelled_at_matches_status
    check ((status = 'cancelled') = (cancelled_at is not null))
);

-- Group list, soonest first.
create index meetups_group_id_starts_at_idx on public.meetups (group_id, starts_at);
create index meetups_created_by_idx on public.meetups (created_by);

comment on table public.meetups is
  'Group walking meetups. Meeting points are public places, never home locations.';

-- ---------------------------------------------------------------------
-- rsvps
-- ---------------------------------------------------------------------
create table public.rsvps (
  id          uuid primary key default gen_random_uuid(),
  meetup_id   uuid not null references public.meetups (id) on delete cascade,
  -- Defaults to the caller; a member can only RSVP for themselves (RLS).
  user_id     uuid not null default auth.uid()
              references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),

  -- One RSVP per member per meetup. The endpoint inserts with
  -- ON CONFLICT DO NOTHING so a repeat RSVP is not an error.
  constraint rsvps_one_per_member unique (meetup_id, user_id)
);

-- Covers "my RSVPs" lookups; (meetup_id, user_id) is covered by the unique index.
create index rsvps_user_id_idx on public.rsvps (user_id);

-- ---------------------------------------------------------------------
-- Integrity triggers
-- All functions pin search_path to '' and fully qualify names.
-- ---------------------------------------------------------------------

create function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger meetups_set_updated_at
  before update on public.meetups
  for each row execute function public.tg_set_updated_at();

-- Meetup invariants on insert and update.
--
-- Future start: always on insert. On update, whenever starts_at changes,
-- except for the database owner / service role: test setup may move a
-- meetup into the past to simulate a started one, which the spec allows
-- ("insert or update one directly as the database owner"). Every app or
-- endpoint role (authenticated, meetup_writer, ...) is held to the rule.
create function public.tg_meetups_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.starts_at <= now() then
      raise exception 'starts_at must be in the future'
        using errcode = 'check_violation';
    end if;

    if new.status <> 'scheduled' or new.cancelled_at is not null then
      raise exception 'a new meetup must be scheduled'
        using errcode = 'check_violation';
    end if;

    if not exists (
      select 1 from public.group_memberships gm
      where gm.group_id = new.group_id and gm.user_id = new.created_by
    ) then
      raise exception 'creator must be a member of the group'
        using errcode = 'check_violation';
    end if;

    return new;
  end if;

  -- UPDATE
  if new.id <> old.id or new.group_id <> old.group_id or new.created_by <> old.created_by then
    raise exception 'id, group_id and created_by cannot change'
      using errcode = 'check_violation';
  end if;

  if old.status = 'cancelled' then
    -- Cancelling is final: no reopen and no edits.
    raise exception 'meetup is cancelled and cannot be changed'
      using errcode = 'check_violation';
  end if;

  if new.status = 'cancelled' then
    new.cancelled_at := now();
  elsif new.cancelled_at is not null then
    raise exception 'cancelled_at is set only by cancelling'
      using errcode = 'check_violation';
  end if;

  if new.starts_at is distinct from old.starts_at
     and current_user not in ('postgres', 'supabase_admin', 'service_role')
     and new.starts_at <= now() then
    raise exception 'starts_at must be in the future'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger meetups_integrity
  before insert or update on public.meetups
  for each row execute function public.tg_meetups_integrity();

-- RSVP invariants on insert. Locks the meetup row (FOR SHARE) so an RSVP
-- cannot slip in concurrently with a cancel: the cancel's UPDATE waits for
-- this transaction, or this check sees the cancelled status.
--
-- SECURITY DEFINER because it must read the meetup and membership rows
-- regardless of the caller's RLS visibility; it returns nothing but an
-- error, and the error text says nothing about the meetup's contents.
create function public.tg_rsvps_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
begin
  select mt.group_id, mt.status, mt.starts_at
    into m
    from public.meetups mt
   where mt.id = new.meetup_id
     for share;

  if not found then
    -- The FK would also catch this; raise the same shape either way.
    raise exception 'meetup not found' using errcode = 'foreign_key_violation';
  end if;

  -- A non-member gets exactly the same error as for a meetup that does not
  -- exist, so an RSVP attempt is not an oracle for "this meetup id is real".
  if not exists (
    select 1 from public.group_memberships gm
    where gm.group_id = m.group_id and gm.user_id = new.user_id
  ) then
    raise exception 'meetup not found' using errcode = 'foreign_key_violation';
  end if;

  if m.status = 'cancelled' then
    raise exception 'meetup is cancelled' using errcode = 'check_violation';
  end if;

  if m.starts_at <= now() then
    raise exception 'meetup has already started' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Trigger functions are not callable as RPC, but keep EXECUTE tight anyway.
revoke execute on function public.tg_rsvps_integrity() from public, anon, authenticated;

create trigger rsvps_integrity
  before insert on public.rsvps
  for each row execute function public.tg_rsvps_integrity();

-- RSVP rows are never updated: withdraw is a delete, re-RSVP is an insert.
create function public.tg_rsvps_no_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'rsvps are not updatable' using errcode = 'check_violation';
end;
$$;

create trigger rsvps_no_update
  before update on public.rsvps
  for each row execute function public.tg_rsvps_no_update();

-- ---------------------------------------------------------------------
-- Row-level security: ON, no policies yet (deny by default).
-- Policies and grants: 20261030110000_access_control.sql
-- ---------------------------------------------------------------------
alter table public.meetups enable row level security;
alter table public.rsvps   enable row level security;
