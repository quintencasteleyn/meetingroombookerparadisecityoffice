-- =====================================================================
-- Paradise City Rooms — waiting list + Monday to Friday only
--
-- Run this once in Supabase → SQL Editor → "New query" → Run.
--
--   * When a room is taken, a colleague can join the waiting list for
--     that slot. As soon as the booking in the way is cancelled (or
--     moved), the first person waiting gets the room automatically.
--   * Rooms can only be booked Monday to Friday.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Waiting-list columns. Only confirmed bookings block a room.
-- ---------------------------------------------------------------------

alter table public.bookings
  add column status text not null default 'confirmed' check (status in ('confirmed', 'waitlist')),
  add column promoted_at timestamptz,
  add column promotion_notified_at timestamptz;

alter table public.bookings drop constraint bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap exclude using gist (
  room_id with =,
  tstzrange(starts_at, ends_at, '[)') with &&
) where (cancelled_at is null and status = 'confirmed');

-- ---------------------------------------------------------------------
-- Booking rules (same as before, plus weekdays only and the waiting list)
-- ---------------------------------------------------------------------

create or replace function public.bookings_before_write()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  tz constant text := 'Europe/Brussels';
  day_start constant time := '07:00';
  day_end constant time := '20:00';
  months_ahead constant interval := interval '3 months';
  local_start timestamp;
  local_end timestamp;
  times_changed boolean;
  clean_guests text[];
begin
  if tg_op = 'UPDATE' then
    -- These never change after creation.
    new.id := old.id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    new.series_id := old.series_id;
    new.recurrence := old.recurrence;

    if old.cancelled_at is not null then
      raise exception 'This booking has been cancelled and can no longer be changed.';
    end if;

    if new.cancelled_at is not null then
      -- Cancelling: record who and when, keep everything else as it was.
      new.cancelled_at := now();
      new.cancelled_by := coalesce(auth.uid(), new.cancelled_by);
      new.cancel_reason := left(nullif(btrim(new.cancel_reason), ''), 300);
      new.room_id := old.room_id;
      new.title := old.title;
      new.guests := old.guests;
      new.starts_at := old.starts_at;
      new.ends_at := old.ends_at;
      new.updated_at := now();
      return new;
    end if;

    new.cancelled_by := null;
    new.cancel_reason := null;
    times_changed := new.starts_at is distinct from old.starts_at
      or new.ends_at is distinct from old.ends_at
      or new.room_id is distinct from old.room_id;
  else
    new.user_id := coalesce(new.user_id, auth.uid());
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancel_reason := null;
    new.promoted_at := null;
    new.promotion_notified_at := null;
    new.created_at := now();
    times_changed := true;
  end if;

  new.updated_at := now();

  new.title := btrim(coalesce(new.title, ''));
  if char_length(new.title) = 0 then
    raise exception 'Please enter a topic for the meeting.';
  end if;
  if char_length(new.title) > 120 then
    raise exception 'The topic can be at most 120 characters.';
  end if;

  select coalesce(array_agg(distinct g), '{}') into clean_guests
  from (select lower(btrim(x)) as g from unnest(coalesce(new.guests, '{}')) as x) s
  where g <> '';
  if cardinality(clean_guests) > 30 then
    raise exception 'You can add at most 30 guests.';
  end if;
  if exists (select 1 from unnest(clean_guests) g where g !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'One of the guest email addresses is not valid.';
  end if;
  new.guests := clean_guests;

  if times_changed then
    local_start := new.starts_at at time zone tz;
    local_end := new.ends_at at time zone tz;

    if extract(epoch from new.starts_at)::bigint % 900 <> 0
       or extract(epoch from new.ends_at)::bigint % 900 <> 0 then
      raise exception 'Bookings must start and end on a quarter of an hour.';
    end if;

    if extract(isodow from local_start) > 5 then
      raise exception 'Rooms can be booked Monday to Friday.';
    end if;

    if local_start::date <> local_end::date
       or local_start::time < day_start
       or local_end::time > day_end then
      raise exception 'Rooms can be booked between 07:00 and 20:00.';
    end if;

    if new.ends_at <= now()
       or ((tg_op = 'INSERT' or new.starts_at is distinct from old.starts_at)
           and new.starts_at < now() - interval '15 minutes') then
      raise exception 'You can''t book a room in the past.';
    end if;

    if local_start::date > ((now() at time zone tz)::date + months_ahead)::date then
      raise exception 'Rooms can be booked at most 3 months ahead.';
    end if;
  end if;

  -- A waiting-list entry whose slot is free (anymore) is simply confirmed.
  if new.status = 'waitlist' and not exists (
    select 1 from public.bookings c
    where c.room_id = new.room_id
      and c.status = 'confirmed'
      and c.cancelled_at is null
      and c.id <> new.id
      and tstzrange(c.starts_at, c.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    new.status := 'confirmed';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- When a confirmed booking is cancelled, moved or deleted, give its slot
-- to the people waiting for it (first come, first served).
-- ---------------------------------------------------------------------

create or replace function public.bookings_promote_waitlist()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  if current_setting('app.skip_promotion', true) = 'on' then
    return null;
  end if;
  if old.status <> 'confirmed' or old.cancelled_at is not null then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if new.cancelled_at is null
       and new.room_id = old.room_id
       and new.starts_at = old.starts_at
       and new.ends_at = old.ends_at then
      return null;
    end if;
  end if;

  for w in
    select b.id
    from public.bookings b
    where b.status = 'waitlist'
      and b.cancelled_at is null
      and b.room_id = old.room_id
      and b.ends_at > now()
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(old.starts_at, old.ends_at, '[)')
    order by b.created_at
  loop
    update public.bookings b
    set status = 'confirmed', promoted_at = now()
    where b.id = w.id
      and not exists (
        select 1 from public.bookings c
        where c.room_id = b.room_id
          and c.status = 'confirmed'
          and c.cancelled_at is null
          and c.id <> b.id
          and tstzrange(c.starts_at, c.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')
      );
  end loop;
  return null;
end;
$$;

create trigger bookings_promote_waitlist
  after update or delete on public.bookings
  for each row execute function public.bookings_promote_waitlist();

-- ---------------------------------------------------------------------
-- Create one booking or a series. Taken dates are skipped, put on the
-- waiting list (p_waitlist), or overruled by the admin (p_override).
-- ---------------------------------------------------------------------

drop function public.create_bookings(smallint, text, text[], jsonb, jsonb, boolean);

create or replace function public.create_bookings(
  p_room_id smallint,
  p_title text,
  p_guests text[],
  p_slots jsonb,
  p_recurrence jsonb default null,
  p_override boolean default false,
  p_waitlist boolean default false
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_slot jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_series uuid;
  v_id uuid;
  v_status text;
  v_conflicts uuid[];
  v_created uuid[] := '{}';
  v_waitlisted uuid[] := '{}';
  v_overridden uuid[] := '{}';
  v_skipped jsonb := '[]';
begin
  if not public.is_active_member() then
    raise exception 'Your account is not allowed to book rooms.';
  end if;
  if p_override and not public.is_admin() then
    raise exception 'Only the admin can overrule other bookings.';
  end if;
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    raise exception 'Nothing to book.';
  end if;
  if jsonb_array_length(p_slots) > 200 then
    raise exception 'A series can have at most 200 dates.';
  end if;

  if jsonb_array_length(p_slots) > 1 then
    v_series := gen_random_uuid();
  end if;

  for v_slot in select value from jsonb_array_elements(p_slots) loop
    v_start := (v_slot ->> 'starts_at')::timestamptz;
    v_end := (v_slot ->> 'ends_at')::timestamptz;
    v_status := 'confirmed';

    select coalesce(array_agg(b.id), '{}') into v_conflicts
    from public.bookings b
    where b.room_id = p_room_id
      and b.status = 'confirmed'
      and b.cancelled_at is null
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v_start, v_end, '[)');

    if cardinality(v_conflicts) > 0 then
      if p_override then
        -- The overruling booking takes the slot; nobody waiting jumps in between.
        perform set_config('app.skip_promotion', 'on', true);
        update public.bookings
        set cancelled_at = now(),
            cancel_reason = 'Overruled by the admin for "' || btrim(p_title) || '"'
        where id = any (v_conflicts);
        perform set_config('app.skip_promotion', 'off', true);
        v_overridden := v_overridden || v_conflicts;
      elsif p_waitlist then
        v_status := 'waitlist';
      else
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('starts_at', v_start, 'ends_at', v_end));
        continue;
      end if;
    end if;

    insert into public.bookings (room_id, title, guests, starts_at, ends_at, series_id, recurrence, status)
    values (p_room_id, p_title, coalesce(p_guests, '{}'), v_start, v_end, v_series,
            case when v_series is not null then p_recurrence end, v_status)
    returning id, status into v_id, v_status;

    if v_status = 'waitlist' then
      v_waitlisted := v_waitlisted || v_id;
    else
      v_created := v_created || v_id;
    end if;
  end loop;

  return jsonb_build_object(
    'created', to_jsonb(v_created),
    'waitlisted', to_jsonb(v_waitlisted),
    'skipped', v_skipped,
    'overridden', to_jsonb(v_overridden)
  );
end;
$$;

revoke execute on function public.create_bookings(smallint, text, text[], jsonb, jsonb, boolean, boolean) from public, anon;
grant execute on function public.create_bookings(smallint, text, text[], jsonb, jsonb, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Changing a series: only confirmed bookings count as "already booked".
-- ---------------------------------------------------------------------

create or replace function public.update_series(
  p_booking_id uuid,
  p_room_id smallint,
  p_title text,
  p_guests text[],
  p_start time,
  p_end time
)
returns uuid[]
language plpgsql security invoker set search_path = ''
as $$
declare
  tz constant text := 'Europe/Brussels';
  v_booking public.bookings;
  v_taken text;
  v_ids uuid[];
begin
  select * into v_booking from public.bookings where id = p_booking_id and cancelled_at is null;
  if not found or v_booking.series_id is null then
    raise exception 'This recurring booking could not be found.';
  end if;

  select string_agg(to_char(s.starts_at at time zone tz, 'Dy DD Mon'), ', ' order by s.starts_at)
  into v_taken
  from public.bookings s
  where s.series_id = v_booking.series_id
    and s.cancelled_at is null
    and s.status = 'confirmed'
    and s.starts_at >= v_booking.starts_at
    and exists (
      select 1 from public.bookings o
      where o.room_id = p_room_id
        and o.cancelled_at is null
        and o.status = 'confirmed'
        and (o.series_id is distinct from v_booking.series_id)
        and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(
          ((s.starts_at at time zone tz)::date + p_start) at time zone tz,
          ((s.starts_at at time zone tz)::date + p_end) at time zone tz,
          '[)')
    );
  if v_taken is not null then
    raise exception 'The room is already booked on: %', v_taken;
  end if;

  with changed as (
    update public.bookings b
    set room_id = p_room_id,
        title = p_title,
        guests = coalesce(p_guests, '{}'),
        starts_at = ((b.starts_at at time zone tz)::date + p_start) at time zone tz,
        ends_at = ((b.starts_at at time zone tz)::date + p_end) at time zone tz
    where b.series_id = v_booking.series_id
      and b.cancelled_at is null
      and b.starts_at >= v_booking.starts_at
    returning b.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from changed;

  return v_ids;
end;
$$;
