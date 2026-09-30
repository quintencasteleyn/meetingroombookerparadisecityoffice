import { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { AlertTriangle, CheckCircle2, Mail, Repeat, ArrowLeftRight, Users } from 'lucide-react'
import { Alert, Button, Dialog, Field, inputClass } from './ui'
import GuestInput from './GuestInput'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { friendlyError, notifyBookings, supabase } from '../lib/supabase'
import { BOOKING_COLUMNS, type Booking, type Colleague, type Frequency, type Room } from '../lib/types'
import {
  TIME_OPTIONS,
  TZ,
  currentQuarterStart,
  durationLabel,
  fmtDay,
  fmtRange,
  fmtTime,
  fromIso,
  lastBookableDay,
  nowInBrussels,
} from '../lib/time'
import { buildOccurrences, frequencyLabel, type Occurrence } from '../lib/recurrence'
import { askForSlotLink, askToSwitchRoomLink, contactOwnerLink } from '../lib/mailto'

interface Props {
  onClose: () => void
  onSaved: () => void
  rooms: Room[]
  colleagues: Colleague[]
  initial: { roomId: number; start: DateTime; end: DateTime }
  booking?: Booking
}

interface Conflict {
  occurrence: Occurrence
  booking: Booking
}

interface Availability {
  conflicts: Conflict[]
  freeRooms: Room[]
}

const FREQUENCIES: Frequency[] = ['none', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly']

function overlaps(a: Occurrence, b: Booking): boolean {
  return a.start < fromIso(b.ends_at) && a.end > fromIso(b.starts_at)
}

export default function BookingDialog({ onClose, onSaved, rooms, colleagues, initial, booking }: Props) {
  const { profile, isAdmin } = useAuth()
  const toast = useToast()
  const editing = Boolean(booking)
  const isSeries = Boolean(booking?.series_id)

  const [title, setTitle] = useState(booking?.title ?? '')
  const [roomId, setRoomId] = useState(initial.roomId)
  const [date, setDate] = useState(initial.start.toISODate()!)
  const [startTime, setStartTime] = useState(fmtTime(initial.start))
  const [endTime, setEndTime] = useState(fmtTime(initial.end))
  const [guests, setGuests] = useState<string[]>(booking?.guests ?? [])
  const [freq, setFreq] = useState<Frequency>('none')
  const [until, setUntil] = useState('')
  const [scope, setScope] = useState<'single' | 'following'>('single')
  const [override, setOverride] = useState(false)
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = nowInBrussels().startOf('day')
  const lastDay = lastBookableDay()
  const day = DateTime.fromISO(date, { zone: TZ })
  const untilDay = until ? DateTime.fromISO(until, { zone: TZ }) : null
  const room = rooms.find((r) => r.id === roomId)
  const earliest = day.hasSame(today, 'day') ? fmtTime(currentQuarterStart()) : '00:00'
  // An ongoing meeting may still be edited (e.g. extended) as long as its start stays the same.
  const keepsStart =
    (editing && date === initial.start.toISODate() && startTime === fmtTime(initial.start)) ||
    (editing && scope === 'following')

  const occurrences = useMemo(
    () => (day.isValid ? buildOccurrences(day, startTime, endTime, editing ? 'none' : freq, untilDay) : []),
    [date, startTime, endTime, freq, until, editing],
  )

  const problem = (() => {
    if (!day.isValid) return 'Pick a date.'
    if (day < today) return "You can't book in the past."
    if (day > lastDay) return `Rooms can be booked up to ${lastDay.toFormat('d LLL yyyy')} (3 months ahead).`
    if (endTime <= startTime) return 'The end time must be after the start time.'
    if (startTime < earliest && !keepsStart) return 'That start time has already passed.'
    if (!editing && freq !== 'none') {
      if (!untilDay?.isValid) return 'Pick an end date for the repeating booking.'
      if (untilDay <= day) return 'The end date must be after the first date.'
      if (untilDay > lastDay) return `Repeating bookings can run until ${lastDay.toFormat('d LLL yyyy')} at the latest.`
    }
    return null
  })()

  // Live availability check for the chosen room(s) and date(s).
  useEffect(() => {
    if (problem || occurrences.length === 0) {
      setAvailability(null)
      setChecking(false)
      return
    }
    setChecking(true)
    const timer = setTimeout(async () => {
      const first = occurrences[0].start
      const last = occurrences[occurrences.length - 1].end
      const { data, error: err } = await supabase
        .from('bookings')
        .select(BOOKING_COLUMNS)
        .is('cancelled_at', null)
        .lt('starts_at', last.toUTC().toISO()!)
        .gt('ends_at', first.toUTC().toISO()!)
      setChecking(false)
      if (err) return
      const existing = ((data as unknown as Booking[]) ?? []).filter(
        (b) =>
          b.id !== booking?.id &&
          !(scope === 'following' && booking?.series_id && b.series_id === booking.series_id),
      )
      const conflictsFor = (id: number) =>
        occurrences.flatMap((occurrence) =>
          existing.filter((b) => b.room_id === id && overlaps(occurrence, b)).map((b) => ({ occurrence, booking: b })),
        )
      setAvailability({
        conflicts: conflictsFor(roomId),
        freeRooms: rooms.filter((r) => r.id !== roomId && conflictsFor(r.id).length === 0),
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [problem, occurrences, roomId, scope])

  function changeStart(value: string) {
    const duration =
      TIME_OPTIONS.indexOf(endTime) - TIME_OPTIONS.indexOf(startTime) > 0
        ? TIME_OPTIONS.indexOf(endTime) - TIME_OPTIONS.indexOf(startTime)
        : 4
    setStartTime(value)
    const newEnd = TIME_OPTIONS[Math.min(TIME_OPTIONS.length - 1, TIME_OPTIONS.indexOf(value) + duration)]
    setEndTime(newEnd)
  }

  function changeFreq(value: Frequency) {
    setFreq(value)
    if (value !== 'none' && !until) {
      const suggestion = day.plus({ weeks: value === 'monthly' ? 12 : 4 })
      setUntil((suggestion > lastDay ? lastDay : suggestion).toISODate()!)
    }
  }

  const conflicts = availability?.conflicts ?? []
  const conflictDates = new Set(conflicts.map((c) => c.occurrence.start.toISO()))
  const multi = occurrences.length > 1
  const allTaken = multi && conflictDates.size === occurrences.length
  const blockedByConflict = conflicts.length > 0 && !override && (!multi || allTaken || editing)
  const minutes = (TIME_OPTIONS.indexOf(endTime) - TIME_OPTIONS.indexOf(startTime)) * 15
  const canSave = !saving && !problem && title.trim().length > 0 && !blockedByConflict && !checking

  async function save() {
    if (!canSave || !profile) return
    setSaving(true)
    setError(null)
    const cleanTitle = title.trim()
    const roomName = room?.name ?? 'the room'
    const owner = booking?.user_id ?? profile.id

    try {
      if (!editing) {
        const { data, error: err } = await supabase.rpc('create_bookings', {
          p_room_id: roomId,
          p_title: cleanTitle,
          p_guests: guests,
          p_slots: occurrences.map((o) => ({ starts_at: o.start.toUTC().toISO(), ends_at: o.end.toUTC().toISO() })),
          p_recurrence: multi ? { freq, until } : null,
          p_override: override,
        })
        if (err) throw err
        const result = data as { created: string[]; skipped: unknown[]; overridden: string[] }
        if (result.created.length === 0) {
          setError('All selected dates are already taken, so nothing was booked.')
          return
        }
        const skipped = result.skipped.length ? ` ${result.skipped.length} taken date(s) were skipped.` : ''
        toast(
          result.created.length === 1
            ? `${roomName} is booked for ${fmtDay(occurrences[0].start)}, ${startTime}–${endTime}.`
            : `${roomName} is booked on ${result.created.length} dates.${skipped}`,
        )
        if (guests.length) {
          void notifyBookings('created', result.created).then((ok) => {
            if (!ok) toast('The booking is saved, but the email to your guests could not be sent.', 'error')
          })
        }
        if (result.overridden.length) void notifyBookings('cancelled', result.overridden)
      } else if (scope === 'following' && booking) {
        const { data, error: err } = await supabase.rpc('update_series', {
          p_booking_id: booking.id,
          p_room_id: roomId,
          p_title: cleanTitle,
          p_guests: guests,
          p_start: startTime,
          p_end: endTime,
        })
        if (err) throw err
        const ids = (data as string[]) ?? []
        toast(`Updated ${ids.length} booking${ids.length === 1 ? '' : 's'} in this series.`)
        if (guests.length || owner !== profile.id) void notifyBookings('updated', ids)
      } else if (booking) {
        const start = occurrences[0].start
        const end = occurrences[0].end
        const { error: err } = await supabase
          .from('bookings')
          .update({
            room_id: roomId,
            title: cleanTitle,
            guests,
            starts_at: start.toUTC().toISO(),
            ends_at: end.toUTC().toISO(),
          })
          .eq('id', booking.id)
        if (err) throw err
        toast('Your changes are saved.')
        if (guests.length || owner !== profile.id) void notifyBookings('updated', [booking.id])
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  const firstConflict = conflicts[0]?.booking
  const conflictOwnedByOther = firstConflict && firstConflict.user_id !== profile?.id

  return (
    <Dialog
      open
      onClose={onClose}
      width="max-w-xl"
      title={editing ? 'Edit booking' : 'Book a room'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!canSave}>
            {editing ? 'Save changes' : multi ? `Book ${occurrences.length - (override ? 0 : conflictDates.size)} dates` : 'Book room'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label="Topic" hint="A short description, visible to all colleagues.">
          {(id) => (
            <input
              id={id}
              data-autofocus
              className={inputClass}
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekly marketing sync"
            />
          )}
        </Field>

        <Field label="Room">
          {(id) => (
            <select id={id} className={inputClass} value={roomId} onChange={(e) => setRoomId(Number(e.target.value))}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.capacity} people
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
          <Field label="Date" className="col-span-2 sm:col-span-1">
            {(id) => (
              <input
                id={id}
                type="date"
                className={inputClass}
                value={date}
                min={today.toISODate()!}
                max={lastDay.toISODate()!}
                disabled={editing && scope === 'following'}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            )}
          </Field>
          <Field label="From">
            {(id) => (
              <select id={id} className={inputClass} value={startTime} onChange={(e) => changeStart(e.target.value)}>
                {TIME_OPTIONS.slice(0, -1).map((t) => (
                  <option
                    key={t}
                    value={t}
                    disabled={t < earliest && !(editing && (scope === 'following' || t === fmtTime(initial.start)))}
                  >
                    {t}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="To" hint={durationLabel(minutes)}>
            {(id) => (
              <select id={id} className={inputClass} value={endTime} onChange={(e) => setEndTime(e.target.value)}>
                {TIME_OPTIONS.filter((t) => t > startTime).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        {!editing && (
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
            <Field label="Repeat">
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={freq}
                  onChange={(e) => changeFreq(e.target.value as Frequency)}
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {frequencyLabel(f, day.isValid ? day : today)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {freq !== 'none' && (
              <Field label="Until" hint={`${occurrences.length} date${occurrences.length === 1 ? '' : 's'}`}>
                {(id) => (
                  <input
                    id={id}
                    type="date"
                    className={inputClass}
                    value={until}
                    min={day.plus({ days: 1 }).toISODate()!}
                    max={lastDay.toISODate()!}
                    onChange={(e) => setUntil(e.target.value)}
                  />
                )}
              </Field>
            )}
          </div>
        )}

        <Field label="Guests (optional)" hint="Guests receive an email with the details and a calendar invite.">
          {(id) => (
            <GuestInput id={id} value={guests} onChange={setGuests} colleagues={colleagues} excludeEmail={profile?.email} />
          )}
        </Field>

        {editing && isSeries && (
          <fieldset className="rounded-lg border border-line p-3">
            <legend className="px-1 text-[13px] font-medium">
              <Repeat className="mr-1 inline size-3.5" />
              This is a repeating booking
            </legend>
            <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-5">
              <label className="flex items-center gap-2">
                <input type="radio" checked={scope === 'single'} onChange={() => setScope('single')} className="accent-[var(--primary)]" />
                Only this date
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={scope === 'following'}
                  onChange={() => {
                    setScope('following')
                    setDate(initial.start.toISODate()!)
                  }}
                  className="accent-[var(--primary)]"
                />
                This and all following dates
              </label>
            </div>
          </fieldset>
        )}

        {problem ? (
          <Alert tone="warning" icon={<AlertTriangle className="size-4 text-amber-500" />}>
            {problem}
          </Alert>
        ) : checking && !availability ? (
          <p className="text-sm text-muted">Checking availability…</p>
        ) : availability && conflicts.length === 0 ? (
          <Alert tone="success" icon={<CheckCircle2 className="size-4 text-emerald-500" />}>
            {multi ? `${room?.name} is free on all ${occurrences.length} dates.` : `${room?.name} is free at this time.`}
          </Alert>
        ) : availability && firstConflict ? (
          <Alert
            tone={multi && !allTaken ? 'warning' : 'error'}
            icon={<AlertTriangle className={`size-4 ${multi && !allTaken ? 'text-amber-500' : 'text-red-500'}`} />}
          >
            {multi ? (
              <>
                <p className="font-medium">
                  {conflictDates.size} of {occurrences.length} dates are already taken
                  {!override && !editing && !allTaken ? ' and will be skipped' : ''}:
                </p>
                <ul className="mt-1 space-y-0.5 text-[13px]">
                  {conflicts.slice(0, 5).map((c) => (
                    <li key={c.booking.id + c.occurrence.start.toISO()}>
                      {fmtDay(c.occurrence.start)} · {fmtRange(c.booking.starts_at, c.booking.ends_at)} ·{' '}
                      {c.booking.owner?.full_name} ({c.booking.title})
                    </li>
                  ))}
                  {conflicts.length > 5 && <li>…and {conflicts.length - 5} more</li>}
                </ul>
              </>
            ) : (
              <p>
                <span className="font-medium">{room?.name}</span> is already booked{' '}
                {fmtRange(firstConflict.starts_at, firstConflict.ends_at)} by{' '}
                <span className="font-medium">{firstConflict.owner?.full_name}</span> for “{firstConflict.title}”.
              </p>
            )}

            {availability.freeRooms.length > 0 && (
              <div className="mt-2.5">
                <p className="mb-1.5 text-[13px] text-muted">
                  {multi ? 'Free on all these dates:' : 'Free at this time:'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {availability.freeRooms.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRoomId(r.id)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[13px] font-medium hover:border-primary hover:text-primary"
                    >
                      <span className="size-2 rounded-full" style={{ background: r.color }} />
                      Switch to {r.name}
                      <span className="inline-flex items-center gap-0.5 text-muted">
                        <Users className="size-3" />
                        {r.capacity}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!multi && conflictOwnedByOther && profile && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <a
                  href={askToSwitchRoomLink(firstConflict, room, availability.freeRooms, profile.full_name)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[13px] font-medium hover:border-primary hover:text-primary"
                >
                  <ArrowLeftRight className="size-3.5" /> Ask {firstConflict.owner?.full_name.split(' ')[0]} to switch rooms
                </a>
                <a
                  href={askForSlotLink(firstConflict, room, profile.full_name)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[13px] font-medium hover:border-primary hover:text-primary"
                >
                  <Mail className="size-3.5" /> Ask for this slot
                </a>
                <a
                  href={contactOwnerLink(firstConflict, room, profile.full_name)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-muted hover:text-fg"
                >
                  Email {firstConflict.owner?.full_name.split(' ')[0]}
                </a>
              </div>
            )}

            {isAdmin && !editing && (
              <label className="mt-3 flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(e) => setOverride(e.target.checked)}
                  className="mt-0.5 accent-red-600"
                />
                <span>
                  <span className="font-medium">Admin: overrule</span> — cancel the existing booking
                  {conflicts.length > 1 ? 's' : ''} and book anyway. The owner{conflicts.length > 1 ? 's get' : ' gets'} an email.
                </span>
              </label>
            )}
          </Alert>
        ) : null}

        {error && (
          <Alert tone="error" icon={<AlertTriangle className="size-4 text-red-500" />}>
            {error}
          </Alert>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
