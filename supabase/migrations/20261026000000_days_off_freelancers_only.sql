-- =====================================================================
-- Paradise City Office — days off by hand only for freelancers
--
-- Run this once in Supabase → SQL Editor → "New query" → Run
-- (after 20261016000000_holiday_planner.sql).
--
--   * Full-time employees' days off come only from Sodiwe. Nobody adds,
--     changes or removes them by hand, not even an admin.
--   * Freelancers add their own days off; admins can do it for them.
--   * Days off that were added by hand for full-time employees are
--     removed, now and whenever someone becomes a full-time employee.
--   * The setting "let full-time employees add their own days off" is gone.
-- =====================================================================

-- Is this person a freelancer (and not on the employee list)?
create or replace function public.is_freelancer(p_email text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
      select 1 from public.profiles p
      where p.email = lower(btrim(p_email)) and p.work_type = 'freelancer' and not p.blocked
    )
    and not exists (
      select 1 from public.staff s
      where s.email = lower(btrim(p_email)) and s.active
    );
$$;

-- Can the signed-in colleague add and change their own days off?
create or replace function public.can_manage_own_absences()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_freelancer(public.my_email());
$$;

-- ---------------------------------------------------------------------
-- Security rules for days off
-- ---------------------------------------------------------------------

drop policy "Members add their own days off, admins anyone's" on public.absences;
drop policy "Owners and admins change days off" on public.absences;
drop policy "Owners and admins remove days off" on public.absences;

create policy "Freelancers add their own days off, admins a freelancer's" on public.absences
  for insert to authenticated
  with check (
    source = 'manual'
    and status = 'approved'
    and external_id is null
    and public.is_freelancer(person_email)
    and (public.is_admin() or person_email = public.my_email())
  );

create policy "Freelancers and admins change a freelancer's days off" on public.absences
  for update to authenticated
  using (
    source = 'manual'
    and public.is_freelancer(person_email)
    and (public.is_admin() or person_email = public.my_email())
  )
  with check (
    source = 'manual'
    and public.is_freelancer(person_email)
    and (public.is_admin() or person_email = public.my_email())
  );

create policy "Freelancers and admins remove a freelancer's days off" on public.absences
  for delete to authenticated
  using (
    source = 'manual'
    and public.is_freelancer(person_email)
    and (public.is_admin() or person_email = public.my_email())
  );

-- ---------------------------------------------------------------------
-- Full-time employees keep only their Sodiwe days off
-- ---------------------------------------------------------------------

delete from public.absences a
where a.source = 'manual' and not public.is_freelancer(a.person_email);

-- Someone put on the employee list loses the days off added by hand.
create or replace function public.staff_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.active then
    update public.profiles
    set work_type = 'employee'
    where email = new.email and work_type is distinct from 'employee';
    delete from public.absences where person_email = new.email and source = 'manual';
  end if;
  return null;
end;
$$;

-- So does someone whose status an admin changes to full-time employee.
create or replace function public.profiles_after_work_type_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.work_type = 'employee' and old.work_type is distinct from 'employee' then
    delete from public.absences where person_email = new.email and source = 'manual';
  end if;
  return null;
end;
$$;

create trigger profiles_after_work_type_change
  after update of work_type on public.profiles
  for each row execute function public.profiles_after_work_type_change();

-- ---------------------------------------------------------------------
-- The temporary switch for full-time employees is no longer needed.
-- ---------------------------------------------------------------------

alter table public.app_settings drop column employees_add_own;
