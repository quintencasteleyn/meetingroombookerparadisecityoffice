import { useEffect, useMemo, useState } from 'react'
import type { DateTime } from 'luxon'
import { ChevronLeft, ChevronRight, Plus, Users } from 'lucide-react'
import { Button } from '../components/ui'
import WeekGrid from '../components/WeekGrid'
import BookingDialog from '../components/BookingDialog'
import BookingDetails from '../components/BookingDetails'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useBookings, useColleagues, useLocalPreference, useMediaQuery, useNow, useRooms } from '../lib/hooks'
import type { Booking } from '../lib/types'
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  WORK_DAYS,
  currentQuarterStart,
  currentWeekStart,
  fromIso,
  isWeekend,
  lastBookableDay,
  nowInBrussels,
  weekLabel,
  weekStartOf,
} from '../lib/time'

function relativeWeek(weekStart: DateTime): string {
  const diff = Math.round(weekStart.diff(weekStartOf(nowInBrussels()), 'weeks').weeks)
  if (diff === 0) return 'This week'
  if (diff === 1) return 'Next week'
  if (diff === -1) return 'Last week'
  return diff > 0 ? `In ${diff} weeks` : `${-diff} weeks ago`
}

/** Monday = 0 … Friday = 4; on weekends the week starts fresh on Monday. */
function todayIndex(): number {
  const now = nowInBrussels()
  return isWeekend(now) ? 0 : now.weekday - 1
}

/** Suggested slot for the "New booking" button: the next free-ish hour. */
function suggestedSlot(): { start: DateTime; end: DateTime } {
  let start = currentQuarterStart().plus({ minutes: 15 })
  if (start.hour < DAY_START_HOUR) start = start.set({ hour: DAY_START_HOUR, minute: 0 })
  if (start.hour >= DAY_END_HOUR - 1) start = start.plus({ days: 1 }).set({ hour: 9, minute: 0 })
  while (isWeekend(start)) start = start.plus({ days: 1 }).set({ hour: 9, minute: 0 })
  const dayEnd = start.set({ hour: DAY_END_HOUR, minute: 0 })
  const end = start.plus({ hours: 1 }) > dayEnd ? dayEnd : start.plus({ hours: 1 })
  return { start, end }
}

export default function CalendarPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const now = useNow()
  const wide = useMediaQuery('(min-width: 900px)')
  const [weekStart, setWeekStart] = useState(() => currentWeekStart())
  const [roomFilter, setRoomFilter] = useLocalPreference<string>('pcr-room-filter', 'all')
  const [mobileDay, setMobileDay] = useState(() => todayIndex())
  const { rooms } = useRooms()
  const colleagues = useColleagues()
  const { bookings, loading, reload } = useBookings(weekStart, weekStart.plus({ weeks: 1 }))

  const [creating, setCreating] = useState<{ roomId: number; start: DateTime; end: DateTime } | null>(null)
  const [viewing, setViewing] = useState<Booking | null>(null)
  const [editing, setEditing] = useState<Booking | null>(null)

  const thisWeek = currentWeekStart()
  const isThisWeek = weekStart.hasSame(thisWeek, 'day')
  const maxWeek = weekStartOf(lastBookableDay())
  const days = useMemo(() => Array.from({ length: WORK_DAYS }, (_, i) => weekStart.plus({ days: i })), [weekStart])

  useEffect(() => {
    setMobileDay(isThisWeek ? todayIndex() : 0)
  }, [weekStart, isThisWeek])

  const visibleRooms = useMemo(() => {
    const picked = rooms.filter((r) => String(r.id) === roomFilter)
    return picked.length ? picked : rooms
  }, [rooms, roomFilter])

  const visibleBookings = useMemo(
    () => bookings.filter((b) => visibleRooms.some((r) => r.id === b.room_id)),
    [bookings, visibleRooms],
  )

  const myUpcoming = useMemo(
    () =>
      bookings.filter((b) => b.user_id === profile?.id && b.status === 'confirmed' && fromIso(b.ends_at) > now).length,
    [bookings, profile?.id, now],
  )

  function openNewBooking() {
    const { start, end } = suggestedSlot()
    setCreating({ roomId: visibleRooms[0]?.id ?? rooms[0]?.id ?? 1, start, end })
  }

  const gridDays = wide ? days : [days[mobileDay] ?? days[0]]

  return (
    <div className="mx-auto max-w-[1500px] px-3 pb-6 pt-4 sm:px-5">
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={() => setWeekStart(thisWeek)} disabled={isThisWeek}>
            Today
          </Button>
          <button
            onClick={() => setWeekStart((w) => w.minus({ weeks: 1 }))}
            className="grid size-8 place-items-center rounded-lg text-fg hover:bg-surface-2"
            aria-label="Previous week"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            onClick={() => setWeekStart((w) => w.plus({ weeks: 1 }))}
            disabled={weekStart >= maxWeek}
            className="grid size-8 place-items-center rounded-lg text-fg hover:bg-surface-2 disabled:opacity-35"
            aria-label="Next week"
            title={weekStart >= maxWeek ? 'Rooms can be booked up to 3 months ahead' : undefined}
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight sm:text-xl">{weekLabel(weekStart)}</h1>
          <p className="text-xs text-muted">
            Week {weekStart.weekNumber} · {relativeWeek(weekStart)}
            {loading && ' · loading…'}
          </p>
        </div>

        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
          <label className="relative flex-1 sm:flex-none">
            <span className="sr-only">Show room</span>
            <span
              className="pointer-events-none absolute left-3 top-1/2 size-2.5 -translate-y-1/2 rounded-full"
              style={{
                background:
                  roomFilter === 'all'
                    ? 'conic-gradient(' + rooms.map((r) => r.color).join(',') + ')'
                    : visibleRooms[0]?.color,
              }}
            />
            <select
              value={visibleRooms.length === 1 && rooms.length > 1 ? roomFilter : 'all'}
              onChange={(e) => setRoomFilter(e.target.value)}
              className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-8 text-sm font-medium text-fg focus:border-primary focus:outline-none sm:w-60"
            >
              <option value="all">All rooms</option>
              {rooms.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" size="sm" className="h-9" icon={<Plus className="size-4" />} onClick={openNewBooking}>
            New booking
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        {visibleRooms.map((r) => (
          <span key={r.id} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: r.color }} />
            <span className="font-medium text-fg">{r.name}</span>
            <span className="inline-flex items-center gap-0.5">
              <Users className="size-3" />
              {r.capacity}
            </span>
          </span>
        ))}
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          <span className="h-2.5 w-4 rounded-sm bg-primary" /> Solid = your bookings
        </span>
        <span className="hidden lg:inline">· Click or drag in the calendar to book a slot</span>
        {myUpcoming > 0 && <span className="ml-auto hidden sm:inline">You have {myUpcoming} upcoming booking{myUpcoming === 1 ? '' : 's'} this week</span>}
      </div>

      {/* Day picker on phones */}
      {!wide && (
        <div className="mb-3 grid grid-cols-5 gap-1">
          {days.map((d, i) => {
            const isToday = d.hasSame(now, 'day')
            const count = visibleBookings.filter(
              (b) => b.status === 'confirmed' && fromIso(b.starts_at).hasSame(d, 'day'),
            ).length
            return (
              <button
                key={d.toISODate()}
                onClick={() => setMobileDay(i)}
                className={`flex flex-col items-center rounded-xl py-1.5 text-xs ${
                  i === mobileDay ? 'bg-primary text-on-primary shadow-sm' : 'bg-surface text-fg border border-line'
                }`}
              >
                <span className={i === mobileDay ? 'opacity-85' : isToday ? 'font-semibold text-primary' : 'text-muted'}>
                  {d.toFormat('ccc')}
                </span>
                <span className="text-base font-semibold leading-tight">{d.day}</span>
                <span className={`mt-0.5 size-1 rounded-full ${count ? (i === mobileDay ? 'bg-current' : 'bg-primary') : ''}`} />
              </button>
            )
          })}
        </div>
      )}

      {profile && (
        <WeekGrid
          days={gridDays}
          rooms={visibleRooms}
          allRooms={rooms}
          bookings={visibleBookings}
          userId={profile.id}
          now={now}
          onSelect={setCreating}
          onOpen={setViewing}
          onBlocked={(message) => toast(message, 'info')}
        />
      )}

      {creating && (
        <BookingDialog
          key={`${creating.roomId}-${creating.start.toISO()}`}
          initial={creating}
          rooms={rooms}
          colleagues={colleagues}
          onClose={() => setCreating(null)}
          onSaved={reload}
        />
      )}

      {viewing && (
        <BookingDetails
          booking={viewing}
          rooms={rooms}
          colleagues={colleagues}
          weekBookings={bookings}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing)
            setViewing(null)
          }}
          onChanged={reload}
        />
      )}

      {editing && (
        <BookingDialog
          booking={editing}
          initial={{ roomId: editing.room_id, start: fromIso(editing.starts_at), end: fromIso(editing.ends_at) }}
          rooms={rooms}
          colleagues={colleagues}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  )
}
