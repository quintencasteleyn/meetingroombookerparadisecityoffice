-- =====================================================================
-- Paradise City Office — holiday planner
--
-- Run this once in Supabase → SQL Editor → "New query" → Run.
--
--   * Every colleague is a full-time employee or a freelancer
--     (profiles.work_type). They choose when they sign up (or the first
--     time they log in); after that only an admin can change it.
--   * The employee list (staff) holds every full-time employee, also the
--     ones without an account, with their Sodeco worker number.
--     Everyone on the list is automatically a full-time employee.
--   * absences: days off. Freelancers add their own in the app.
--     Full-time employees' days off come in from Sodeco every night.
--   * app_settings: the weekly "who's off" email and the Sodeco sync status.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

alter table public.profiles
  add column work_type text check (work_type in ('employee', 'freelancer'));

create table public.staff (
  email text primary key,
  full_name text not null check (char_length(full_name) between 1 and 100),
  -- The worker number in Sodeco Prisma, used to match absences to people.
  sodeco_worker_id text check (char_length(sodeco_worker_id) between 1 and 40),
  -- Only needed when the group has more than one employer number in Sodeco.
  sodeco_employer text check (char_length(sodeco_employer) between 1 and 40),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index staff_sodeco_worker_idx
  on public.staff (coalesce(sodeco_employer, ''), sodeco_worker_id)
  where sodeco_worker_id is not null;

create table public.absences (
  id uuid primary key default gen_random_uuid(),
  person_email text not null,
  start_date date not null,
  end_date date not null,
  -- 'am' / 'pm' = only the morning / afternoon of a single day;
  -- 'half' = half a day when Sodeco doesn't say which half.
  day_part text not null default 'full' check (day_part in ('full', 'am', 'pm', 'half')),
  status text not null default 'approved' check (status in ('approved', 'requested')),
  source text not null default 'manual' check (source in ('manual', 'sodeco')),
  -- Sodeco's own id for the absence, so the nightly sync can update it.
  external_id text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint absences_date_order check (end_date >= start_date),
  constraint absences_half_day_single check (day_part = 'full' or start_date = end_date),
  constraint absences_source_external_key unique (source, external_id)
);

create index absences_dates_idx on public.absences (start_date, end_date);
create index absences_person_idx on public.absences (person_email);

-- One row with the app-wide settings.
create table public.app_settings (
  id boolean primary key default true check (id),
  digest_enabled boolean not null default true,
  -- Empty = everyone (all accounts + everyone on the employee list).
  digest_recipients text[] not null default '{}',
  -- Monday of the week the last weekly email was about (prevents sending twice).
  digest_last_week date,
  digest_last_sent_at timestamptz,
  digest_last_sent_count integer,
  -- Until the Sodeco connection is live, full-time employees can be
  -- allowed to add their own days off too.
  employees_add_own boolean not null default false,
  sodeco_last_sync_at timestamptz,
  sodeco_last_sync_ok boolean,
  sodeco_last_sync_message text
);

insert into public.app_settings default values;

-- ---------------------------------------------------------------------
-- Helper functions used by the security rules
-- ---------------------------------------------------------------------

create or replace function public.my_email()
returns text
language sql stable security definer set search_path = ''
as $$
  select email from public.profiles where id = auth.uid() and not blocked;
$$;

-- Can the signed-in colleague add and change their own days off?
create or replace function public.can_manage_own_absences()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and not p.blocked
      and (
        p.work_type = 'freelancer'
        or (p.work_type = 'employee' and (select s.employees_add_own from public.app_settings s))
      )
  );
$$;

-- ---------------------------------------------------------------------
-- New accounts: same domains as before, now also with the work status.
-- Everyone on the employee list is a full-time employee.
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  allowed_domains constant text[] := array['paradisecity.be', 'touquetmusicbeach.com'];
  admin_email constant text := 'quinten@paradisecity.be';
  v_email text := lower(new.email);
  v_work_type text := new.raw_user_meta_data ->> 'work_type';
begin
  if not (split_part(v_email, '@', 2) = any (allowed_domains)) then
    raise exception 'Only @paradisecity.be or @touquetmusicbeach.com email addresses can create an account.';
  end if;

  if v_work_type is null or v_work_type not in ('employee', 'freelancer') then
    v_work_type := null;
  end if;
  if exists (select 1 from public.staff s where s.email = v_email and s.active) then
    v_work_type := 'employee';
  end if;

  insert into public.profiles (id, email, full_name, role, work_type)
  values (
    new.id,
    v_email,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(v_email, '@', 1)), 100),
    case when v_email = admin_email then 'admin' else 'member' end,
    v_work_type
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Work status rules
--   * A colleague picks it once; after that only an admin changes it.
--   * Someone on the employee list is always a full-time employee.
-- ---------------------------------------------------------------------

create or replace function public.profiles_work_type_rules()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_on_list boolean;
  -- Edge Functions (service role) act for an admin; auth.uid() is then empty.
  v_by_admin boolean := auth.uid() is null or public.is_admin();
begin
  if new.work_type is not distinct from old.work_type then
    return new;
  end if;

  v_on_list := exists (select 1 from public.staff s where s.email = new.email and s.active);
  if v_on_list and new.work_type is distinct from 'employee' then
    if v_by_admin then
      raise exception '% is on the employee list, so they are a full-time employee. Remove them from the list first.', new.full_name;
    end if;
    new.work_type := 'employee';
    return new;
  end if;

  if not v_by_admin and old.work_type is not null then
    raise exception 'Your status is already set. Ask an admin to change it.';
  end if;
  return new;
end;
$$;

create trigger profiles_work_type_rules
  before update of work_type on public.profiles
  for each row execute function public.profiles_work_type_rules();

-- A deleted account takes the days off it added for itself along.
create or replace function public.profiles_after_delete()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.absences where person_email = old.email and source = 'manual';
  return null;
end;
$$;

create trigger profiles_after_delete
  after delete on public.profiles
  for each row execute function public.profiles_after_delete();

-- ---------------------------------------------------------------------
-- Employee list rules
-- ---------------------------------------------------------------------

create or replace function public.staff_before_write()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.email := lower(btrim(coalesce(new.email, '')));
  new.full_name := btrim(coalesce(new.full_name, ''));
  new.sodeco_worker_id := nullif(btrim(new.sodeco_worker_id), '');
  new.sodeco_employer := nullif(btrim(new.sodeco_employer), '');
  if new.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'This is not a valid email address: %', new.email;
  end if;
  if new.full_name = '' then
    raise exception 'Please enter a name for %.', new.email;
  end if;
  return new;
end;
$$;

create trigger staff_before_write
  before insert or update on public.staff
  for each row execute function public.staff_before_write();

create or replace function public.staff_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.active then
    update public.profiles
    set work_type = 'employee'
    where email = new.email and work_type is distinct from 'employee';
  end if;
  return null;
end;
$$;

create trigger staff_after_write
  after insert or update on public.staff
  for each row execute function public.staff_after_write();

-- ---------------------------------------------------------------------
-- Days-off rules (checked on every insert/update)
-- ---------------------------------------------------------------------

create or replace function public.absences_before_write()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  tz constant text := 'Europe/Brussels';
  v_today date := (now() at time zone tz)::date;
begin
  new.person_email := lower(btrim(coalesce(new.person_email, '')));

  if tg_op = 'UPDATE' then
    -- These never change after creation.
    new.id := old.id;
    new.source := old.source;
    new.external_id := old.external_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  end if;
  new.updated_at := now();

  if new.person_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Days off need a valid email address.';
  end if;
  if new.end_date < new.start_date then
    raise exception 'The last day is before the first day.';
  end if;
  if new.day_part <> 'full' and new.start_date <> new.end_date then
    raise exception 'A morning or afternoon off has to be a single day.';
  end if;

  -- Sodeco is the judge of its own data; these limits are for the app.
  if new.source = 'manual' then
    if new.end_date - new.start_date > 366 then
      raise exception 'Add at most one year of days off in one go.';
    end if;
    if new.end_date < v_today - 366 then
      raise exception 'Days off more than a year ago can''t be added.';
    end if;
    if new.start_date > v_today + 731 then
      raise exception 'Days off can be planned at most two years ahead.';
    end if;
    if exists (
      select 1 from public.absences a
      where a.person_email = new.person_email
        and a.source = 'manual'
        and a.id <> new.id
        and daterange(a.start_date, a.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
        -- A morning and an afternoon on the same day are fine together.
        and not (a.day_part in ('am', 'pm') and new.day_part in ('am', 'pm') and a.day_part <> new.day_part)
    ) then
      raise exception 'These dates overlap with days off that are already planned.';
    end if;
  end if;

  return new;
end;
$$;

create trigger absences_before_write
  before insert or update on public.absences
  for each row execute function public.absences_before_write();

-- ---------------------------------------------------------------------
-- Settings rules
-- ---------------------------------------------------------------------

create or replace function public.app_settings_before_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  select coalesce(array_agg(distinct r order by r), '{}') into new.digest_recipients
  from (select lower(btrim(x)) as r from unnest(coalesce(new.digest_recipients, '{}')) as x) s
  where r <> '';
  if cardinality(new.digest_recipients) > 50 then
    raise exception 'Add at most 50 addresses. Use a group address (like a distribution list) for more people.';
  end if;
  if exists (select 1 from unnest(new.digest_recipients) r where r !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'One of the email addresses is not valid.';
  end if;
  return new;
end;
$$;

create trigger app_settings_before_update
  before update on public.app_settings
  for each row execute function public.app_settings_before_update();

-- The weekly email claims its week before sending, so the same week is
-- never sent twice (e.g. when the schedule and an admin send at once).
-- Only the Edge Function (service role) may call this.
create or replace function public.claim_digest_week(p_week date, p_previous date)
returns boolean
language sql security definer set search_path = ''
as $$
  with claimed as (
    update public.app_settings
    set digest_last_week = p_week
    where id and digest_last_week is not distinct from p_previous
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke execute on function public.claim_digest_week(date, date) from public, anon, authenticated;
grant execute on function public.claim_digest_week(date, date) to service_role;

-- ---------------------------------------------------------------------
-- Everyone in the planner: accounts and the employee list together.
-- ---------------------------------------------------------------------

create or replace function public.holiday_people()
returns table (email text, full_name text, work_type text, has_account boolean)
language sql stable security definer set search_path = ''
as $$
  select coalesce(p.email, s.email),
         coalesce(p.full_name, s.full_name),
         case when s.email is not null then 'employee' else p.work_type end,
         p.id is not null
  from (select * from public.staff where active) s
  full join (select * from public.profiles where not blocked) p on p.email = s.email
  where public.is_active_member()
  order by 2;
$$;

revoke execute on function public.holiday_people() from public, anon;
grant execute on function public.holiday_people() to authenticated;

-- ---------------------------------------------------------------------
-- Security (row level security + column privileges)
-- ---------------------------------------------------------------------

alter table public.staff enable row level security;
alter table public.absences enable row level security;
alter table public.app_settings enable row level security;

revoke all on public.staff from anon, authenticated;
revoke all on public.absences from anon, authenticated;
revoke all on public.app_settings from anon, authenticated;

-- Colleagues choose their own status once (the trigger above guards it).
grant update (work_type) on public.profiles to authenticated;

-- Employee list: only admins see and manage it. Colleagues see the names
-- through holiday_people(), without the Sodeco numbers.
grant select, insert, update, delete on public.staff to authenticated;

create policy "Admins manage the employee list" on public.staff
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Days off: everyone sees all of them. Freelancers add and change their own,
-- admins add and change anyone's. Sodeco days off are only changed by the sync.
grant select, insert, delete on public.absences to authenticated;
grant update (start_date, end_date, day_part) on public.absences to authenticated;

create policy "Members can see days off" on public.absences
  for select to authenticated
  using (public.is_active_member());

create policy "Members add their own days off, admins anyone's" on public.absences
  for insert to authenticated
  with check (
    source = 'manual'
    and status = 'approved'
    and external_id is null
    and (
      public.is_admin()
      or (person_email = public.my_email() and public.can_manage_own_absences())
    )
  );

create policy "Owners and admins change days off" on public.absences
  for update to authenticated
  using (
    source = 'manual'
    and (public.is_admin() or (person_email = public.my_email() and public.can_manage_own_absences()))
  )
  with check (
    source = 'manual'
    and (public.is_admin() or (person_email = public.my_email() and public.can_manage_own_absences()))
  );

create policy "Owners and admins remove days off" on public.absences
  for delete to authenticated
  using (
    source = 'manual'
    and (public.is_admin() or (person_email = public.my_email() and public.can_manage_own_absences()))
  );

-- Settings: everyone can read them, only admins change them.
grant select on public.app_settings to authenticated;
grant update (digest_enabled, digest_recipients, employees_add_own) on public.app_settings to authenticated;

create policy "Members can see the settings" on public.app_settings
  for select to authenticated
  using (public.is_active_member());

create policy "Admins change the settings" on public.app_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Live updates: the holiday planner refreshes when someone adds days off.
-- ---------------------------------------------------------------------

alter publication supabase_realtime add table public.absences;
