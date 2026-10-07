import { DateTime, Settings } from 'luxon'

// Everything in the app is shown in Brussels time, whatever the device says.
export const TZ = 'Europe/Brussels'
Settings.defaultZone = TZ
Settings.defaultLocale = 'en-GB'

export const DAY_START_HOUR = 7
export const DAY_END_HOUR = 20
export const SLOT_MINUTES = 15
export const SLOTS_PER_DAY = ((DAY_END_HOUR - DAY_START_HOUR) * 60) / SLOT_MINUTES
export const MAX_MONTHS_AHEAD = 3
/** The calendar shows and books Monday to Friday only. */
export const WORK_DAYS = 5

export function nowInBrussels(): DateTime {
  return DateTime.now().setZone(TZ)
}

/** Monday 00:00 of the week containing `dt`. */
export function weekStartOf(dt: DateTime): DateTime {
  return dt.setZone(TZ).startOf('week')
}

export function isWeekend(dt: DateTime): boolean {
  return dt.weekday > WORK_DAYS
}

/** The week the calendar opens on: this week, or next week on Saturday and Sunday. */
export function currentWeekStart(): DateTime {
  const now = nowInBrussels()
  return weekStartOf(isWeekend(now) ? now.plus({ weeks: 1 }) : now)
}

export function lastBookableDay(): DateTime {
  return nowInBrussels().startOf('day').plus({ months: MAX_MONTHS_AHEAD })
}

/** Start of the current quarter hour (earliest time a new booking may start). */
export function currentQuarterStart(): DateTime {
  const now = nowInBrussels()
  return now.set({ minute: Math.floor(now.minute / SLOT_MINUTES) * SLOT_MINUTES, second: 0, millisecond: 0 })
}

export function dayStart(day: DateTime): DateTime {
  return day.set({ hour: DAY_START_HOUR, minute: 0, second: 0, millisecond: 0 })
}

export function slotTime(day: DateTime, slot: number): DateTime {
  return dayStart(day).plus({ minutes: slot * SLOT_MINUTES })
}

/** Quarter-hour index since 07:00 (can be fractional for "now"). */
export function slotOf(dt: DateTime): number {
  return dt.diff(dayStart(dt), 'minutes').minutes / SLOT_MINUTES
}

/** '07:00', '07:15', … '20:00' */
export const TIME_OPTIONS: string[] = Array.from({ length: SLOTS_PER_DAY + 1 }, (_, i) => {
  const minutes = DAY_START_HOUR * 60 + i * SLOT_MINUTES
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})

export function atTime(day: DateTime, hhmm: string): DateTime {
  const [hour, minute] = hhmm.split(':').map(Number)
  return day.set({ hour, minute, second: 0, millisecond: 0 })
}

export function fromIso(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: TZ })
}

export function fmtTime(dt: DateTime): string {
  return dt.toFormat('HH:mm')
}

export function fmtRange(startIso: string, endIso: string): string {
  return `${fmtTime(fromIso(startIso))}–${fmtTime(fromIso(endIso))}`
}

export function fmtDay(dt: DateTime): string {
  return dt.toFormat('ccc d LLL')
}

export function fmtLongDay(dt: DateTime): string {
  return dt.toFormat('cccc d LLLL yyyy')
}

export function durationLabel(minutes: number): string {
  if (minutes <= 0) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export function weekLabel(weekStart: DateTime): string {
  const end = weekStart.plus({ days: WORK_DAYS - 1 })
  const sameMonth = weekStart.month === end.month
  const range = sameMonth
    ? `${weekStart.toFormat('d')} – ${end.toFormat('d LLL yyyy')}`
    : weekStart.year === end.year
      ? `${weekStart.toFormat('d LLL')} – ${end.toFormat('d LLL yyyy')}`
      : `${weekStart.toFormat('d LLL yyyy')} – ${end.toFormat('d LLL yyyy')}`
  return range
}
