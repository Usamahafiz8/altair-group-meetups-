-- =====================================================================
-- Edit rules (bonus a). Creator-only update is already the RLS policy
-- meetups_update_creator; a cancelled meetup is already frozen and a changed
-- start must be in the future (meetups_integrity). This adds:
--
--   * a meetup that has already started cannot be edited (title, time,
--     meeting point). Cancelling it is still allowed.
--
-- Owner / service role are exempt so test setup can shape fixtures.
-- =====================================================================

create function public.tg_meetups_no_edit_after_start()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
     and old.starts_at <= now()
     and (new.title is distinct from old.title
          or new.starts_at is distinct from old.starts_at
          or new.meeting_point_name is distinct from old.meeting_point_name
          or new.meeting_point_lat is distinct from old.meeting_point_lat
          or new.meeting_point_lng is distinct from old.meeting_point_lng) then
    raise exception 'meetup has already started' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger meetups_no_edit_after_start
  before update on public.meetups
  for each row execute function public.tg_meetups_no_edit_after_start();
