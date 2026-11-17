-- =====================================================================
-- Paradise City Office — three groups of colleagues
--
-- Run this in Supabase → SQL Editor → "New query" → Run
-- (after 20261026000000_days_off_freelancers_only.sql). Running it a
-- second time is harmless.
--
-- Everyone belongs to one of three groups (profiles.work_type), chosen
-- when they sign up or the first time they sign in:
--   * employee        Full-time employee of Paradise City. Days off come
--                     from Sodiwe; nobody adds them by hand.
--   * freelancer      Freelancers and other: add their own days off.
--   * france_austria  French and Austrian team: add their own days off.
--
-- A full-time employee confirms who they are by picking their name from
-- the employee list ("Are you one of the following persons?"). That links
-- their account to their Sodiwe days off, also when the email address on
-- the list was a different one.
-- =====================================================================

alter table public.profiles drop constraint if exists profiles_work_type_check;
alter table public.profiles add constraint profiles_work_type_check
  check (work_type in ('employee', 'freelancer', 'france_austria'));

-- Does this person add their own days off? Freelancers and other, and the
-- French and Austrian team. (The name stays is_freelancer because the
-- security rules for days off use it.)
create or replace function public.is_freelancer(p_email text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
      select 1 from public.profiles p
      where p.email = lower(btrim(p_email))
        and p.work_type in ('freelancer', 'france_austria')
        and not p.blocked
    )
    and not exists (
      select 1 from public.staff s
      where s.email = lower(btrim(p_email)) and s.active
    );
$$;

-- ---------------------------------------------------------------------
-- New accounts: the group comes from the sign-up form. Someone on the
-- employee list is a full-time employee; someone who says they are, but
-- isn't on the list under this address, picks their name at first sign-in.
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

  if v_work_type is null or v_work_type not in ('employee', 'freelancer', 'france_austria') then
    v_work_type := null;
  end if;
  if exists (select 1 from public.staff s where s.email = v_email and s.active) then
    v_work_type := 'employee';
  elsif v_work_type = 'employee' then
    v_work_type := null;
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
-- "Are you one of the following persons?"
-- ---------------------------------------------------------------------

-- The names on the employee list that are still free to pick: nobody else
-- has an account with that entry's email address. Only for signed-in
-- colleagues; no email addresses or other details.
create or replace function public.claimable_staff()
returns table (worker_id text, full_name text)
language sql stable security definer set search_path = ''
as $$
  select s.sodeco_worker_id, s.full_name
  from public.staff s
  where public.is_active_member()
    and s.active
    and s.sodeco_worker_id is not null
    and (
      s.email = public.my_email()
      or not exists (select 1 from public.profiles p where p.email = s.email)
    )
  order by s.full_name;
$$;

-- The signed-in colleague says "that's me": their account takes over that
-- entry of the employee list (and its Sodiwe days off) and they become a
-- full-time employee. Only while they haven't chosen a group yet.
create or replace function public.claim_staff(p_worker_id text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me public.profiles;
  v_staff public.staff;
begin
  select * into v_me from public.profiles where id = auth.uid() and not blocked;
  if not found then
    raise exception 'Please sign in first.';
  end if;
  if v_me.work_type is not null then
    raise exception 'Your status is already set. Ask an admin to change it.';
  end if;

  select * into v_staff from public.staff
  where sodeco_worker_id = btrim(p_worker_id) and active;
  if not found then
    raise exception 'This person is not on the employee list.';
  end if;

  if v_staff.email <> v_me.email then
    if exists (select 1 from public.profiles p where p.email = v_staff.email) then
      raise exception '% already has an account. If that''s you, ask an admin.', v_staff.full_name;
    end if;
    if exists (select 1 from public.staff s where s.email = v_me.email) then
      raise exception 'Your email address is already on the employee list for someone else. Ask an admin.';
    end if;
    -- Move the entry (and the Sodiwe days off already copied) to this account.
    update public.absences set person_email = v_me.email
    where person_email = v_staff.email and source = 'sodeco';
    update public.staff set email = v_me.email where email = v_staff.email;
  end if;

  update public.profiles set work_type = 'employee'
  where id = v_me.id and work_type is distinct from 'employee';
end;
$$;

revoke execute on function public.claimable_staff() from public, anon;
revoke execute on function public.claim_staff(text) from public, anon;
grant execute on function public.claimable_staff() to authenticated;
grant execute on function public.claim_staff(text) to authenticated;
