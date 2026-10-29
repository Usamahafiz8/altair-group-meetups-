-- =====================================================================
-- First Epic Workflow Challenge - Senior Full-Stack Engineer
-- Schema starter (ALTAIR)
--
-- Original First Epic material built for this workflow challenge. Synthetic.
-- Target: Supabase (Postgres 15+). Uses the Supabase auth schema
-- (auth.users) that every Supabase project already has.
--
-- What this file gives you:
--   public.users              one app profile row per auth.users account
--   public.groups             neighborhood walking groups
--   public.group_memberships  many-to-many: which users belong to which groups
--
-- What this file does NOT give you (that is your work):
--   * meetup and RSVP tables
--   * any row-level security policies (RLS is switched on below for the
--     three starter tables, with no policies, so they deny by default)
--   * any views, functions, or endpoints
--
-- Apply it once, before your own migrations (see README.md).
-- =====================================================================

-- ---------------------------------------------------------------------
-- users: the app profile for each signed-up account
-- ---------------------------------------------------------------------
create table public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null
                check (char_length(display_name) between 1 and 60),

  -- PRIVATE. A member's home location. Collected at onboarding for other
  -- features that are out of scope here. It must never be exposed through
  -- the meetup feature: not in any response, view, or map, to anyone.
  home_lat      double precision
                check (home_lat between -90 and 90),
  home_lng      double precision
                check (home_lng between -180 and 180),

  created_at    timestamptz not null default now()
);

comment on column public.users.home_lat is
  'PRIVATE home latitude. Never expose through the meetup feature.';
comment on column public.users.home_lng is
  'PRIVATE home longitude. Never expose through the meetup feature.';

-- ---------------------------------------------------------------------
-- groups: small neighborhood walking groups
-- ---------------------------------------------------------------------
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null
              check (char_length(name) between 1 and 80),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- group_memberships: many-to-many between users and groups
-- ---------------------------------------------------------------------
create table public.group_memberships (
  group_id    uuid not null references public.groups (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_memberships_user_id_idx
  on public.group_memberships (user_id);

-- ---------------------------------------------------------------------
-- Row-level security: ON, with no policies. Deny by default.
-- Write the policies (or other server-side access) your slice needs.
-- ---------------------------------------------------------------------
alter table public.users             enable row level security;
alter table public.groups            enable row level security;
alter table public.group_memberships enable row level security;
