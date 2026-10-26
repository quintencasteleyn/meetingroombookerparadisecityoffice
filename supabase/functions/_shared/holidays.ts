// Days-off logic shared by the website and the weekly email, so both
// count days the same way. Plain TypeScript (no Deno or browser APIs);
// dates are 'YYYY-MM-DD' strings in Brussels time.

/** 'half' = half a day when Sodiwe doesn't say whether it's the morning or the afternoon. */
export type DayPart = 'full' | 'am' | 'pm' | 'half'
export type WorkType = 'employee' | 'freelancer'

export interface Absence {
  id: string
  person_email: string
  start_date: string
  end_date: string
  day_part: DayPart
  status: 'approved' | 'requested'
  source: 'manual' | 'sodeco'
}

export interface Person {
  email: string
  full_name: string
  work_type: WorkType | null
  has_account: boolean
}

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------

const DAY_MS = 86_400_000
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY_MS)
}

/** 1 = Monday … 7 = Sunday */
export function weekdayOf(iso: string): number {
  return ((new Date(toUtc(iso)).getUTCDay() + 6) % 7) + 1
}

export function mondayOf(iso: string): string {
  return addDays(iso, 1 - weekdayOf(iso))
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d)
  return days
}

/** 'Mon 19 Oct' */
export function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${WEEKDAYS[weekdayOf(iso) - 1]} ${d} ${MONTHS[m - 1]}`
}

/** 'Mon 19 – Wed 21 Oct', or 'Mon 30 Nov – Tue 1 Dec' across months. */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return dayLabel(from)
  const sameMonth = from.slice(0, 7) === to.slice(0, 7)
  const start = sameMonth ? `${WEEKDAYS[weekdayOf(from) - 1]} ${Number(from.slice(8))}` : dayLabel(from)
  return `${start} – ${dayLabel(to)}`
}

// ---------------------------------------------------------------------
// Belgian public holidays
// ---------------------------------------------------------------------

/** Easter Sunday (Gregorian calendar, Meeus/Jones/Butcher algorithm). */
function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const holidayCache = new Map<number, Map<string, string>>()

export function publicHolidays(year: number): Map<string, string> {
  const cached = holidayCache.get(year)
  if (cached) return cached
  const easter = easterSunday(year)
  const list: [string, string][] = [
    [`${year}-01-01`, "New Year's Day"],
    [addDays(easter, 1), 'Easter Monday'],
    [`${year}-05-01`, 'Labour Day'],
    [addDays(easter, 39), 'Ascension Day'],
    [addDays(easter, 50), 'Whit Monday'],
    [`${year}-07-21`, 'Belgian National Day'],
    [`${year}-08-15`, 'Assumption Day'],
    [`${year}-11-01`, "All Saints' Day"],
    [`${year}-11-11`, 'Armistice Day'],
    [`${year}-12-25`, 'Christmas Day'],
  ]
  const map = new Map(list)
  holidayCache.set(year, map)
  return map
}

export function publicHolidayName(iso: string): string | undefined {
  return publicHolidays(Number(iso.slice(0, 4))).get(iso)
}

export function isWorkingDay(iso: string): boolean {
  return weekdayOf(iso) <= 5 && !publicHolidayName(iso)
}

// ---------------------------------------------------------------------
// Days off per day
// ---------------------------------------------------------------------

/** Working days in [from, to] → the days off on that day. */
export function absencesByDay(absences: Absence[], from: string, to: string): Map<string, Absence[]> {
  const map = new Map<string, Absence[]>()
  for (const a of absences) {
    const start = a.start_date > from ? a.start_date : from
    const end = a.end_date < to ? a.end_date : to
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (!isWorkingDay(d)) continue
      const list = map.get(d)
      if (list) list.push(a)
      else map.set(d, [a])
    }
  }
  return map
}

/** Morning + afternoon (or two halves) on the same day = the full day. */
function mergePart(current: DayPart | undefined, next: DayPart): DayPart {
  if (!current) return next
  if (current === next && current !== 'half') return current
  return 'full'
}

export function partLabel(part: DayPart): string {
  return part === 'am' ? 'morning' : part === 'pm' ? 'afternoon' : part === 'half' ? 'half day' : 'full day'
}

// ---------------------------------------------------------------------
// Weekly summary (used by the weekly email)
// ---------------------------------------------------------------------

export interface PersonWeek {
  email: string
  name: string
  fullWeek: boolean
  days: { date: string; part: DayPart }[]
}

export interface WeekSummary {
  monday: string
  workingDays: string[]
  holidays: { date: string; name: string }[]
  people: PersonWeek[]
}

export function summarizeWeek(
  monday: string,
  absences: Absence[],
  nameOf: (email: string) => string,
): WeekSummary {
  const weekDays = eachDay(monday, addDays(monday, 4))
  const workingDays = weekDays.filter(isWorkingDay)
  const holidays = weekDays
    .filter((d) => publicHolidayName(d))
    .map((d) => ({ date: d, name: publicHolidayName(d)! }))

  const perPerson = new Map<string, Map<string, DayPart>>()
  for (const [date, list] of absencesByDay(absences, monday, addDays(monday, 4))) {
    for (const a of list) {
      const days = perPerson.get(a.person_email) ?? new Map<string, DayPart>()
      days.set(date, mergePart(days.get(date), a.day_part))
      perPerson.set(a.person_email, days)
    }
  }

  const people: PersonWeek[] = [...perPerson].map(([email, days]) => {
    const sorted = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, part]) => ({ date, part }))
    const fullWeek =
      workingDays.length > 0 && workingDays.every((d) => days.get(d) === 'full')
    return { email, name: nameOf(email), fullWeek, days: sorted }
  })
  people.sort((a, b) => a.name.localeCompare(b.name))

  return { monday, workingDays, holidays, people }
}

/** 'Full week', or the exact days: 'Mon 19 – Tue 20 Oct, Thu 22 Oct (morning)'. */
export function describeWeek(person: PersonWeek, workingDays: string[]): string {
  if (person.fullWeek) return 'Full week'
  const parts: string[] = []
  let run: string[] = []
  const flush = () => {
    if (run.length) parts.push(rangeLabel(run[0], run[run.length - 1]))
    run = []
  }
  const byDate = new Map(person.days.map((d) => [d.date, d.part]))
  for (const day of workingDays) {
    const part = byDate.get(day)
    if (part === 'full') {
      run.push(day)
      continue
    }
    flush()
    if (part) parts.push(`${dayLabel(day)} (${partLabel(part)})`)
  }
  flush()
  return parts.join(', ')
}
