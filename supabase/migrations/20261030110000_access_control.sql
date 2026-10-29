-- =====================================================================
-- Access control: grants, RLS policies, helper functions.
--
-- Two database roles touch the feature tables:
--
--   authenticated  The app, through PostgREST with the member's session.
--                  READ-ONLY. Every write from the app is refused here, so
--                  the Zod-validated endpoint is the only way to write.
--
--   meetup_writer  The write endpoint. The server verifies the member's JWT,
--                  then in one transaction does
--                    set local role meetup_writer;
--                    set_config('request.jwt.claims', <verified claims>, true);
--                  so auth.uid() is the member and every policy below still
--                  applies to the write. PostgREST's authenticator is not a
--                  member of this role, so the app cannot switch into it.
--
-- anon gets nothing. service_role (test setup only) keeps Supabase defaults.
--
-- Home location: users.home_lat / home_lng are never granted to any API
-- role. RLS filters rows, not columns, so column-level grants do that job.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers live in a schema PostgREST does not expose (not callable as RPC).
-- SECURITY DEFINER so policies can ask membership questions without
-- tripping RLS on group_memberships (which would otherwise recurse or hide
-- other members' rows). Each returns only a boolean about the caller.
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.is_group_member(target_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_memberships gm
    where gm.group_id = target_group and gm.user_id = auth.uid()
  );
$$;

-- True when the caller and target_user share at least one group.
-- Used so attendee / creator display names resolve for fellow members only.
create function private.shares_group_with(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_memberships mine
    join public.group_memberships theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid() and theirs.user_id = target_user
  );
$$;

revoke all on function private.is_group_member(uuid), private.shares_group_with(uuid) from public;

grant execute on function private.is_group_member(uuid), private.shares_group_with(uuid)
  to authenticated;

-- ---------------------------------------------------------------------
-- Write role = everything authenticated has (inherited: schema usage,
-- auth.uid(), the read grants and every "to authenticated" policy) plus the
-- write grants and write policies below. Nothing else is granted to it.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'meetup_writer') then
    create role meetup_writer nologin inherit;
  end if;
end
$$;

grant authenticated to meetup_writer;
-- The server connects as the project owner (postgres) and switches into
-- meetup_writer per transaction.
grant meetup_writer to postgres;

-- ---------------------------------------------------------------------
-- Table privileges. Start from nothing for the API roles, then grant the
-- minimum. (Supabase's default privileges grant ALL to anon/authenticated
-- on new public tables; undo that explicitly.)
-- ---------------------------------------------------------------------
revoke all on public.users, public.groups, public.group_memberships,
              public.meetups, public.rsvps
  from anon, authenticated;

-- Reads for the app. users: only id + display_name, never home_lat/home_lng.
grant select (id, display_name) on public.users to authenticated;
grant select on public.groups, public.group_memberships,
                public.meetups, public.rsvps to authenticated;

-- Writes for the endpoint role. Column lists keep id, created_by, user_id,
-- cancelled_at and timestamps out of the caller's hands: created_by and
-- user_id come from their auth.uid() defaults, the rest from defaults/triggers.
grant insert (group_id, title, starts_at,
              meeting_point_name, meeting_point_lat, meeting_point_lng)
  on public.meetups to meetup_writer;
grant update (status, title, starts_at,
              meeting_point_name, meeting_point_lat, meeting_point_lng)
  on public.meetups to meetup_writer;
grant insert (meetup_id) on public.rsvps to meetup_writer;
grant delete on public.rsvps to meetup_writer;

-- ---------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------

-- users: yourself, or someone who shares a group with you.
create policy users_select_self_or_comember on public.users
  for select to authenticated
  using (id = auth.uid() or private.shares_group_with(id));

-- groups: only groups you belong to ("my groups").
create policy groups_select_member on public.groups
  for select to authenticated
  using (private.is_group_member(id));

-- group_memberships: only your own membership rows.
create policy group_memberships_select_own on public.group_memberships
  for select to authenticated
  using (user_id = auth.uid());

-- meetups: members of the meetup's group read it (cancelled included).
create policy meetups_select_member on public.meetups
  for select to authenticated
  using (private.is_group_member(group_id));

-- meetups: create in a group you belong to, as yourself.
create policy meetups_insert_member on public.meetups
  for insert to meetup_writer
  with check (created_by = auth.uid() and private.is_group_member(group_id));

-- meetups: only the creator updates (cancel; edit for the bonus).
-- Reopen / edit-after-cancel / immutable fields are enforced by trigger.
create policy meetups_update_creator on public.meetups
  for update to meetup_writer
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- rsvps: readable when you can read the meetup (meetups RLS applies inside).
create policy rsvps_select_member on public.rsvps
  for select to authenticated
  using (exists (select 1 from public.meetups m where m.id = rsvps.meetup_id));

-- rsvps: RSVP only as yourself, only to a meetup you can see. Cancelled /
-- started / non-member are also rejected by the rsvps_integrity trigger.
create policy rsvps_insert_self on public.rsvps
  for insert to meetup_writer
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.meetups m where m.id = rsvps.meetup_id)
  );

-- rsvps: withdraw only your own RSVP (allowed on cancelled meetups too).
create policy rsvps_delete_self on public.rsvps
  for delete to meetup_writer
  using (user_id = auth.uid());
