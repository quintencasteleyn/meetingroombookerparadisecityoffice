-- =====================================================================
-- Paradise City Rooms — allow a second email domain
--
-- Run this once in Supabase → SQL Editor → "New query" → Run.
-- From then on, both @paradisecity.be and @touquetmusicbeach.com
-- addresses can create an account.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  allowed_domains constant text[] := array['paradisecity.be', 'touquetmusicbeach.com'];
  admin_email constant text := 'quinten@paradisecity.be';
  v_email text := lower(new.email);
begin
  if not (split_part(v_email, '@', 2) = any (allowed_domains)) then
    raise exception 'Only @paradisecity.be or @touquetmusicbeach.com email addresses can create an account.';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    v_email,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(v_email, '@', 1)), 100),
    case when v_email = admin_email then 'admin' else 'member' end
  );
  return new;
end;
$$;
