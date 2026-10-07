import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { DateTime } from 'luxon'
import { Hourglass, Repeat } from 'lucide-react'
import type { Booking, Room } from '../lib/types'
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  SLOTS_PER_DAY,
  currentQuarterStart,
  fmtRange,
  fmtTime,
  fromIso,
  lastBookableDay,
  slotOf,
  slotTime,
} from '../lib/time'
import { readableOn } from '../lib/theme'

export const HOUR_PX = 56
const QUARTER_PX = HOUR_PX / 4
const GRID_HEIGHT = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX
const DEFAULT_SLOTS = 4 // a single click selects one hour

interface Props {
  days: DateTime[]
  rooms: Room[]
  allRooms: Room[]
  bookings: Booking[]
  userId: string
  now: DateTime
  onSelect: (selection: { roomId: number; start: DateTime; end: DateTime }) => void
  onOpen: (booking: Booking) => void
  onBlocked: (message: string) => void
}

interface Drag {
  day: DateTime
  roomId: number
  anchor: number
  current: number
  lower: number
  upper: number
  touch: boolean
  x: number
  y: number
  moved: boolean
}

function roomShortName(room: Room): string {
  return room.name.split(' (')[0]
}

function slotSpan(b: Booking): [number, number] {
  const start = Math.max(0, Math.round(slotOf(fromIso(b.starts_at))))
  const end = Math.min(SLOTS_PER_DAY, Math.round(slotOf(fromIso(b.ends_at))))
  return [start, end]
}

export default function WeekGrid({ days, rooms, allRooms, bookings, userId, now, onSelect, onOpen, onBlocked }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hover, setHover] = useState<{ key: string; slot: number } | null>(null)
  const today = now.startOf('day')
  const lastDay = lastBookableDay()

  // Confirmed bookings fill the grid; your own waiting-list requests are drawn as dashed outlines.
  const [byCell, waitsByCell] = useMemo(() => {
    const confirmed = new Map<string, Booking[]>()
    const waits = new Map<string, Booking[]>()
    for (const b of bookings) {
      const key = `${fromIso(b.starts_at).toISODate()}|${b.room_id}`
      if (b.status === 'confirmed') confirmed.set(key, [...(confirmed.get(key) ?? []), b])
      else if (b.user_id === userId) waits.set(key, [...(waits.get(key) ?? []), b])
    }
    return [confirmed, waits]
  }, [bookings, userId])

  const waitingCount = useMemo(() => {
    const counts = new Map<string, number>()
    const waiting = bookings.filter((b) => b.status === 'waitlist')
    for (const b of bookings) {
      if (b.status !== 'confirmed') continue
      const n = waiting.filter(
        (w) => w.room_id === b.room_id && w.starts_at < b.ends_at && w.ends_at > b.starts_at,
      ).length
      if (n) counts.set(b.id, n)
    }
    return counts
  }, [bookings])

  const roomById = useMemo(() => new Map(allRooms.map((r) => [r.id, r])), [allRooms])

  // Scroll so the current time (or 08:00) is visible when the page opens.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const showsToday = days.some((d) => d.hasSame(today, 'day'))
    const target = showsToday ? Math.max(0, slotOf(now) * QUARTER_PX - HOUR_PX * 1.5) : HOUR_PX
    el.scrollTop = target
  }, [days[0]?.toISODate()])

  function firstAllowedSlot(day: DateTime): number {
    if (day < today || day > lastDay) return SLOTS_PER_DAY
    if (day > today) return 0
    return Math.max(0, Math.ceil(slotOf(currentQuarterStart()) - 0.001))
  }

  function slotFromEvent(e: ReactPointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect()
    return Math.min(SLOTS_PER_DAY - 1, Math.max(0, Math.floor((e.clientY - rect.top) / QUARTER_PX)))
  }

  function bounds(day: DateTime, roomId: number, anchor: number): [number, number] {
    const cell = byCell.get(`${day.toISODate()}|${roomId}`) ?? []
    let lower = firstAllowedSlot(day)
    let upper = SLOTS_PER_DAY
    for (const b of cell) {
      const [s, e] = slotSpan(b)
      if (e <= anchor) lower = Math.max(lower, e)
      if (s > anchor) upper = Math.min(upper, s)
    }
    return [lower, upper]
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>, day: DateTime, roomId: number) {
    if (e.button !== 0) return
    if (day > lastDay) {
      onBlocked('Rooms can be booked up to 3 months ahead.')
      return
    }
    const slot = slotFromEvent(e)
    if (slot < firstAllowedSlot(day)) {
      onBlocked("That time has already passed. Pick a slot later today or another day.")
      return
    }
    const [lower, upper] = bounds(day, roomId, slot)
    const touch = e.pointerType === 'touch'
    if (!touch) {
      e.currentTarget.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
    setDrag({ day, roomId, anchor: slot, current: slot, lower, upper, touch, x: e.clientX, y: e.clientY, moved: false })
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>, key: string) {
    if (!drag) {
      if (e.pointerType === 'mouse') {
        const slot = slotFromEvent(e)
        if (hover?.key !== key || hover.slot !== slot) setHover({ key, slot })
      }
      return
    }
    if (drag.touch) {
      if (Math.abs(e.clientX - drag.x) > 8 || Math.abs(e.clientY - drag.y) > 8) setDrag({ ...drag, moved: true })
      return
    }
    const slot = Math.min(drag.upper - 1, Math.max(drag.lower, slotFromEvent(e)))
    if (slot !== drag.current) setDrag({ ...drag, current: slot })
  }

  function onPointerUp() {
    if (!drag) return
    const d = drag
    setDrag(null)
    if (d.touch && d.moved) return
    let start = Math.min(d.anchor, d.current)
    let end = Math.max(d.anchor, d.current) + 1
    if (d.anchor === d.current) {
      start = d.anchor
      end = Math.min(d.anchor + DEFAULT_SLOTS, d.upper)
    }
    onSelect({ roomId: d.roomId, start: slotTime(d.day, start), end: slotTime(d.day, end) })
  }

  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i)
  const gridLines = {
    backgroundImage:
      'linear-gradient(to bottom, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line-soft) 1px, transparent 1px)',
    backgroundSize: `100% ${HOUR_PX}px, 100% ${HOUR_PX}px`,
    backgroundPosition: `0 0, 0 ${HOUR_PX / 2}px`,
  }
  const multiRoom = rooms.length > 1
  const narrow = multiRoom && days.length > 3
  const minColumn = multiRoom ? 46 * rooms.length : 110

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <div ref={scroller} className="max-h-[calc(100dvh-210px)] min-h-[360px] overflow-auto overscroll-contain">
        <div style={{ minWidth: 56 + days.length * minColumn }}>
          {/* Day headers */}
          <div className="sticky top-0 z-30 flex border-b border-line bg-surface">
            <div className="w-14 shrink-0" />
            {days.map((day) => {
              const isToday = day.hasSame(today, 'day')
              const isPast = day < today
              return (
                <div key={day.toISODate()} className="min-w-0 flex-1 border-l border-line">
                  <div className={`flex items-center justify-center gap-1.5 py-2 ${isPast ? 'opacity-55' : ''}`}>
                    <span className={`text-xs font-medium uppercase tracking-wide ${isToday ? 'text-primary' : 'text-muted'}`}>
                      {day.toFormat('ccc')}
                    </span>
                    <span
                      className={`grid size-7 place-items-center rounded-full text-sm font-semibold ${
                        isToday ? 'bg-primary text-on-primary' : 'text-fg'
                      }`}
                    >
                      {day.day}
                    </span>
                  </div>
                  {multiRoom && (
                    <div className="flex border-t border-line-soft">
                      {rooms.map((room) => (
                        <div
                          key={room.id}
                          title={room.name}
                          className="min-w-0 flex-1 truncate px-0.5 py-1 text-center text-[10px] font-semibold"
                          style={{ color: room.color }}
                        >
                          {roomShortName(room)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Grid body */}
          <div className="relative flex">
            <div className="relative w-14 shrink-0" style={{ height: GRID_HEIGHT }}>
              {hours.map((h, i) => (
                <div
                  key={h}
                  className={`absolute right-2 text-[11px] tabular-nums text-muted ${i === 0 ? 'translate-y-1' : '-translate-y-1/2'}`}
                  style={{ top: i * HOUR_PX }}
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {days.map((day) => {
              const isToday = day.hasSame(today, 'day')
              const firstSlot = firstAllowedSlot(day)
              const blockedHeight = Math.min(GRID_HEIGHT, firstSlot * QUARTER_PX)
              const nowTop = slotOf(now) * QUARTER_PX
              return (
                <div key={day.toISODate()} className="relative flex min-w-0 flex-1 border-l border-line">
                  {rooms.map((room, roomIndex) => {
                    const key = `${day.toISODate()}|${room.id}`
                    const cell = byCell.get(key) ?? []
                    const waits = waitsByCell.get(key) ?? []
                    const active = drag && !drag.touch && drag.roomId === room.id && drag.day.hasSame(day, 'day')
                    const selStart = active ? Math.min(drag.anchor, drag.current) : 0
                    const selEnd = active ? Math.max(drag.anchor, drag.current) + 1 : 0
                    const showHover = !drag && hover?.key === key && hover.slot >= firstSlot
                    return (
                      <div
                        key={room.id}
                        className={`relative min-w-0 flex-1 cursor-pointer touch-pan-y select-none ${
                          roomIndex > 0 ? 'border-l border-dashed border-line-soft' : ''
                        }`}
                        style={{ height: GRID_HEIGHT, ...gridLines }}
                        onPointerDown={(e) => onPointerDown(e, day, room.id)}
                        onPointerMove={(e) => onPointerMove(e, key)}
                        onPointerUp={onPointerUp}
                        onPointerCancel={() => setDrag(null)}
                        onPointerLeave={() => setHover((h) => (h?.key === key ? null : h))}
                      >
                        {blockedHeight > 0 && (
                          <div
                            className="absolute inset-x-0 top-0 cursor-not-allowed bg-[var(--line-soft)]"
                            style={{ height: blockedHeight }}
                          />
                        )}

                        {showHover && (
                          <div
                            className="pointer-events-none absolute inset-x-0.5 rounded-md border border-dashed border-primary/50 bg-primary/8 px-1 text-[10px] font-medium leading-[13px] text-primary"
                            style={{ top: hover.slot * QUARTER_PX, height: QUARTER_PX }}
                          >
                            {fmtTime(slotTime(day, hover.slot))}
                          </div>
                        )}

                        {cell.map((b) => {
                          const [s, e] = slotSpan(b)
                          const color = roomById.get(b.room_id)?.color ?? '#64748b'
                          const mine = b.user_id === userId
                          const height = (e - s) * QUARTER_PX - 2
                          const tiny = height < 26
                          const waiting = mine ? (waitingCount.get(b.id) ?? 0) : 0
                          return (
                            <button
                              key={b.id}
                              type="button"
                              onPointerDown={(ev) => ev.stopPropagation()}
                              onClick={() => onOpen(b)}
                              title={`${b.title}\n${fmtRange(b.starts_at, b.ends_at)} · ${b.owner?.full_name ?? ''}\n${roomById.get(b.room_id)?.name ?? ''}`}
                              className={`absolute inset-x-0.5 z-10 overflow-hidden rounded-md px-1.5 text-left leading-tight shadow-sm transition hover:z-20 hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary ${
                                mine ? 'cursor-pointer' : 'cursor-default'
                              }`}
                              style={{
                                top: s * QUARTER_PX + 1,
                                height,
                                background: mine ? color : `color-mix(in srgb, ${color} 17%, var(--surface))`,
                                color: mine ? readableOn(color) : 'var(--fg)',
                                borderLeft: mine ? undefined : `3px solid ${color}`,
                                paddingTop: tiny ? 0 : 3,
                              }}
                            >
                              {tiny ? (
                                <div className="truncate text-[10.5px] leading-[12px]">
                                  <span className="font-semibold">{b.title}</span>{' '}
                                  <span className="opacity-75">{fmtTime(fromIso(b.starts_at))}</span>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-start gap-1 text-[11.5px] font-semibold">
                                    <span className={`min-w-0 flex-1 ${narrow ? 'truncate' : 'line-clamp-2'}`}>{b.title}</span>
                                    {waiting > 0 && (
                                      <span className="mt-px inline-flex shrink-0 items-center opacity-80" title={`${waiting} waiting for this slot`}>
                                        <Hourglass className="size-3" />
                                        {!narrow && <span className="text-[10px]">{waiting}</span>}
                                      </span>
                                    )}
                                    {b.series_id && !narrow && <Repeat className="mt-px size-3 shrink-0 opacity-70" />}
                                  </div>
                                  <div className="truncate text-[10.5px] opacity-80">
                                    {narrow ? fmtTime(fromIso(b.starts_at)) : fmtRange(b.starts_at, b.ends_at)}
                                  </div>
                                  {height >= 52 && (
                                    <div className="truncate text-[10.5px] opacity-80">
                                      {mine ? 'You' : narrow ? b.owner?.full_name.split(' ')[0] : b.owner?.full_name}
                                    </div>
                                  )}
                                </>
                              )}
                            </button>
                          )
                        })}

                        {waits.map((b) => {
                          const [s, e] = slotSpan(b)
                          const color = roomById.get(b.room_id)?.color ?? '#64748b'
                          return (
                            <button
                              key={b.id}
                              type="button"
                              onPointerDown={(ev) => ev.stopPropagation()}
                              onClick={() => onOpen(b)}
                              title={`Waiting list: ${b.title}\n${fmtRange(b.starts_at, b.ends_at)}`}
                              className="absolute right-0.5 z-[15] w-[45%] cursor-pointer overflow-hidden rounded-md border-2 border-dashed px-1 text-left text-[10.5px] font-semibold leading-tight backdrop-blur-[1px] hover:z-20"
                              style={{
                                top: s * QUARTER_PX + 1,
                                height: (e - s) * QUARTER_PX - 2,
                                borderColor: color,
                                background: `color-mix(in srgb, ${color} 10%, var(--surface))`,
                                color: 'var(--fg)',
                              }}
                            >
                              <span className="flex items-center gap-0.5 truncate">
                                <Hourglass className="size-3 shrink-0" /> {narrow ? '' : 'Waiting'}
                              </span>
                            </button>
                          )
                        })}

                        {active && (
                          <div
                            className="pointer-events-none absolute inset-x-0.5 z-20 rounded-md border-2 border-primary bg-primary/20 px-1.5 py-0.5 text-[11px] font-semibold text-fg"
                            style={{ top: selStart * QUARTER_PX, height: (selEnd - selStart) * QUARTER_PX }}
                          >
                            {fmtTime(slotTime(day, selStart))}–{fmtTime(slotTime(day, selEnd))}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {isToday && nowTop >= 0 && nowTop <= GRID_HEIGHT && (
                    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: nowTop }}>
                      <div className="relative h-0.5 bg-red-500">
                        <div className="absolute -left-1.5 -top-[5px] size-3 rounded-full bg-red-500" />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
