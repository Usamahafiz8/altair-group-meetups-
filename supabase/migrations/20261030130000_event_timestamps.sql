-- =====================================================================
-- Record when things actually happened, not when their transaction began.
--
-- Found by the RSVP-vs-cancel race test. now() is the transaction START
-- time. A cancel whose transaction started first, but whose UPDATE then
-- waited on an RSVP's FOR SHARE lock, was stamped earlier than an RSVP that
-- was legitimately accepted before the cancel took effect. Access was never
-- wrong (the lock serialises them); the audit timestamps were.
--
--   * cancelled_at := clock_timestamp(). A BEFORE UPDATE row trigger runs
--     after the row lock is acquired, so this is after every RSVP that held
--     the lock has committed.
--   * rsvps.created_at defaults to clock_timestamp(): the moment of insert.
--
-- With both, every RSVP that exists on a cancelled meetup has
-- created_at < cancelled_at. Business rules still compare against now().
-- The function body is otherwise identical to 20261030100000.
-- =====================================================================

alter table public.rsvps alter column created_at set default clock_timestamp();

create or replace function public.tg_meetups_integrity()
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
    new.cancelled_at := clock_timestamp();
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
