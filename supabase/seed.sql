-- =====================================================================
-- First Epic Workflow Challenge - Senior Full-Stack Engineer
-- Seed data (ALTAIR)
--
-- Original First Epic material built for this workflow challenge. Every name,
-- email, and coordinate is synthetic. Coordinates sit around an arbitrary
-- reference point (40.0000 N, 100.0000 W) in a fictional town; they are not
-- real addresses.
--
-- PART 1 writes to the Supabase auth tables (auth.users, auth.identities) so
--        the seed accounts can sign in, then loads the starter tables
--        (public.users, public.groups, public.group_memberships). Run it as
--        the database owner, after the schema starter: as supabase/seed.sql
--        on local Supabase, or in the hosted project's SQL editor.
-- PART 2 is the reference set of meetups and RSVPs. Your meetup and RSVP
--        tables do not exist yet, so PART 2 is commented out. Once your
--        migrations create those tables, adapt PART 2 to your column names
--        and load it. The VALUES are what matter, not the column names.
--
-- Every seed account signs in with password:  altair-fixture-pass
--
-- Personas (use them in your tests):
--   Avery Lin      Maple Street Walkers only       creator of "Saturday morning loop"
--   Jordan Price   Maple Street Walkers only       RSVP'd to "Saturday morning loop";
--                                                  creator of "Weeknight short walk"
--   Sam Okafor     Maple Street Walkers only       member, has NOT RSVP'd to anything
--   Riley Chen     BOTH groups                     RSVP'd to "Saturday morning loop" only
--   Morgan Ellis   Riverside Loop Walkers only     creator of "Riverside sunrise walk"
--   Casey Moreno   Riverside Loop Walkers only     RSVP'd to "Riverside sunrise walk"
--   Quinn Adler    Riverside Loop Walkers only     member, has NOT RSVP'd to anything
--   Taylor Brooks  NEITHER group (outsider)        must see nothing from either group
--
-- home_lat / home_lng are PRIVATE. They are seeded so you can prove they
-- never leak. They must never appear in any response, view, or map.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PART 1a: auth accounts (Supabase auth schema)
-- ---------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'avery@example.test', extensions.crypt('altair-fixture-pass', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Avery Lin"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'jordan@example.test', extensions.crypt('altair-fixture-pass', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Jordan Price"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'sam@example.test', extensions.crypt('altair-fixture-pass', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Sam Okafor"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'riley@example.test', extensions.crypt('altair-fixture-pass', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Riley Chen"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
   'morgan@example.test', extensions.crypt('altair-fixture-pass', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Morgan Ellis"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated',
   'casey@example.test', extensions.crypt('altair-fixture-pass', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Casey Moreno"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated',
   'taylor@example.test', extensions.crypt('altair-fixture-pass', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Taylor Brooks"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated',
   'quinn@example.test', extensions.crypt('altair-fixture-pass', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Quinn Adler"}',
   now(), now(), '', '', '', '');

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   '{"sub":"a1000000-0000-4000-8000-000000000001","email":"avery@example.test","email_verified":true}', 'email',
   now(), now(), now()),
  ('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002',
   '{"sub":"a1000000-0000-4000-8000-000000000002","email":"jordan@example.test","email_verified":true}', 'email',
   now(), now(), now()),
  ('a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003',
   '{"sub":"a1000000-0000-4000-8000-000000000003","email":"sam@example.test","email_verified":true}', 'email',
   now(), now(), now()),
  ('a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000004',
   '{"sub":"a1000000-0000-4000-8000-000000000004","email":"riley@example.test","email_verified":true}', 'email',
   now(), now(), now()),
  ('a1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000005',
   '{"sub":"a1000000-0000-4000-8000-000000000005","email":"morgan@example.test","email_verified":true}', 'email',
   now(), now(), now()),
  ('a1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000006',
   '{"sub":"a1000000-0000-4000-8000-000000000006","email":"casey@example.test","email_verified":true}', 'email',
   now(), now(), now()),
  ('a1000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000007',
   '{"sub":"a1000000-0000-4000-8000-000000000007","email":"taylor@example.test","email_verified":true}', 'email',
   now(), now(), now()),
  ('a1000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000008',
   '{"sub":"a1000000-0000-4000-8000-000000000008","email":"quinn@example.test","email_verified":true}', 'email',
   now(), now(), now());

-- ---------------------------------------------------------------------
-- PART 1b: app profiles (home_lat / home_lng are PRIVATE)
-- ---------------------------------------------------------------------
insert into public.users (id, display_name, home_lat, home_lng) values
  ('a1000000-0000-4000-8000-000000000001', 'Avery Lin', 40.004812, -99.993127),
  ('a1000000-0000-4000-8000-000000000002', 'Jordan Price', 40.007395, -99.988640),
  ('a1000000-0000-4000-8000-000000000003', 'Sam Okafor', 39.998263, -99.995418),
  ('a1000000-0000-4000-8000-000000000004', 'Riley Chen', 40.002957, -100.006284),
  ('a1000000-0000-4000-8000-000000000005', 'Morgan Ellis', 39.993481, -100.011736),
  ('a1000000-0000-4000-8000-000000000006', 'Casey Moreno', 39.989624, -100.004952),
  ('a1000000-0000-4000-8000-000000000007', 'Taylor Brooks', 40.010538, -100.014867),
  ('a1000000-0000-4000-8000-000000000008', 'Quinn Adler', 39.996107, -100.017392);

-- ---------------------------------------------------------------------
-- PART 1c: groups
-- ---------------------------------------------------------------------
insert into public.groups (id, name) values
  ('b2000000-0000-4000-8000-000000000001', 'Maple Street Walkers'),
  ('b2000000-0000-4000-8000-000000000002', 'Riverside Loop Walkers');

-- ---------------------------------------------------------------------
-- PART 1d: memberships (Riley Chen is in both; Taylor Brooks in neither)
-- ---------------------------------------------------------------------
insert into public.group_memberships (group_id, user_id) values
  ('b2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002'),
  ('b2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003'),
  ('b2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004'),
  ('b2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000004'),
  ('b2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000005'),
  ('b2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000006'),
  ('b2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000008');

-- =====================================================================
-- PART 2: reference meetups and RSVPs (adapt to your schema, then load)
--
-- Public meeting points in the fictional town (all public places):
--   North gate, Linden Park                 40.012046, -99.984517
--   Front steps, Elm Avenue Library         40.003318, -99.979762
--   Boathouse lot, Riverside Path          39.985239, -100.009683
--   Fountain plaza, Town Green              39.999134, -99.999461   (spare, for creating your own)
--
-- Start times are relative to when you load the seed (now() plus an
-- interval), so the reference meetups are always upcoming.
-- =====================================================================

-- insert into public.meetups
--   (id, group_id, created_by, title, starts_at,
--    meeting_point_name, meeting_point_lat, meeting_point_lng)
-- values
--   ('c3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
--    'Saturday morning loop', now() + interval '7 days',
--    'North gate, Linden Park', 40.012046, -99.984517),
--   ('c3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
--    'Weeknight short walk', now() + interval '10 days',
--    'Front steps, Elm Avenue Library', 40.003318, -99.979762),
--   ('c3000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000005',
--    'Riverside sunrise walk', now() + interval '8 days',
--    'Boathouse lot, Riverside Path', 39.985239, -100.009683);

-- insert into public.rsvps (meetup_id, user_id) values
--   ('c3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002'),   -- Jordan Price -> Saturday morning loop
--   ('c3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004'),   -- Riley Chen   -> Saturday morning loop
--   ('c3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000006');   -- Casey Moreno -> Riverside sunrise walk
--
-- "Weeknight short walk" intentionally has no RSVPs (an empty attendee list).
