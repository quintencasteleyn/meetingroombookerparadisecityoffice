import { memo } from 'react'
import { addDays, publicHolidayName, weekdayOf, type Absence, type Person } from '../../lib/holidays'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MAX_CHIPS = 3

interface MonthGridProps {
  /** First day of the month, 'YYYY-MM-01'. */
  month: string
  byDay: Map<string, Absence[]>
  personOf: (email: string) => Person | undefined
  me: string
  today: string
  selected: string
  /** From this many people off, the day gets an amber "n off" badge. */
  busyFrom: number
  onSelect: (day: string) => void
}

export function chipClass(absence: Absence, person: Person | undefined, me: string): string {
  const type = person?.work_type ?? (absence.source === 'sodeco' ? 'employee' : null)
  return [
    'chip',
    type === 'employee' ? 'chip-employee' : type === 'freelancer' ? 'chip-freelancer' : 'chip-unknown',
    absence.person_email === me ? 'chip-me' : '',
    absence.status === 'requested' ? 'chip-requested' : '',
  ].join(' ')
}

export function nameOf(email: string, person: Person | undefined): string {
  return person?.full_name ?? email.split('@')[0]
}

function MonthGrid({ month, byDay, personOf, me, today, selected, busyFrom, onSelect }: MonthGridProps) {
  const [year, monthNumber] = month.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const lead = weekdayOf(month) - 1
  const trail = (7 - ((lead + daysInMonth) % 7)) % 7

  let workingDays = 0
  let daysOff = 0
  const cells = Array.from({ length: daysInMonth }, (_, i) => {
    const day = addDays(month, i)
    const weekend = weekdayOf(day) > 5
    const holiday = publicHolidayName(day)
    // Mine first, then by name.
    const list = [...(byDay.get(day) ?? [])].sort((a, b) =>
      a.person_email === me
        ? -1
        : b.person_email === me
          ? 1
          : nameOf(a.person_email, personOf(a.person_email)).localeCompare(nameOf(b.person_email, personOf(b.person_email))),
    )
    if (!weekend && !holiday) {
      workingDays++
      daysOff += list.reduce((sum, a) => sum + (a.day_part === 'full' ? 1 : 0.5), 0)
    }
    const people = new Set(list.map((a) => a.person_email)).size
    const label = holiday ?? (people ? `${people} off` : weekend ? 'weekend' : 'everyone in')

    return (
      <button
        key={day}
        type="button"
        onClick={() => onSelect(day)}
        aria-label={`${day}: ${label}`}
        aria-pressed={day === selected}
        className={`relative flex min-h-[84px] min-w-0 flex-col items-stretch gap-0.5 border-b border-r border-line-soft px-[3px] py-1 text-left transition hover:bg-surface-2 @lg:min-h-[104px] @lg:p-1 ${
          holiday ? 'bg-rose-500/8' : weekend ? 'bg-surface-2/70' : 'bg-surface'
        } ${day === selected ? 'z-[1] shadow-[inset_0_0_0_2px_var(--primary)]' : ''} [&:nth-child(7n)]:border-r-0`}
      >
        <span
          className={`mb-0.5 inline-grid h-[22px] min-w-[22px] place-items-center self-start rounded-full px-1 text-[12.5px] tabular-nums ${
            day === today ? 'bg-primary font-semibold text-on-primary' : weekend ? 'text-muted' : 'font-semibold'
          }`}
        >
          {i + 1}
        </span>
        {people >= busyFrom && (
          <span className="absolute right-1 top-1.5 rounded bg-amber-500/15 px-1 text-[10px] font-bold text-amber-600 @lg:right-1.5">
            {people} off
          </span>
        )}
        {holiday && <span className="text-[10px] font-semibold leading-tight text-rose-600 @lg:text-[11px]">{holiday}</span>}
        {list.slice(0, MAX_CHIPS).map((a) => {
          const person = personOf(a.person_email)
          const [first, ...rest] = nameOf(a.person_email, person).split(' ')
          return (
            <span
              key={a.id}
              className={`${chipClass(a, person, me)} block truncate rounded-[4px] px-1 py-px text-[10.5px] font-medium leading-tight @lg:rounded-[5px] @lg:px-1 @lg:text-[11.5px]`}
            >
              {first}
              {rest.length > 0 && <span className="hidden @lg:inline"> {rest[rest.length - 1][0]}.</span>}
              {a.day_part !== 'full' && (
                <span className="ml-0.5 hidden text-[10px] font-semibold opacity-80 @lg:inline">
                  {a.day_part === 'am' ? 'AM' : a.day_part === 'pm' ? 'PM' : '½'}
                </span>
              )}
            </span>
          )
        })}
        {list.length > MAX_CHIPS && (
          <span className="pl-1 text-[10.5px] font-semibold text-muted">+{list.length - MAX_CHIPS} more</span>
        )}
      </button>
    )
  })

  return (
    <section className="@container min-w-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <header className="flex items-baseline justify-between gap-2 border-b border-line px-3.5 py-3">
        <h2 className="text-[15px] font-semibold">
          {MONTHS[monthNumber - 1]} {year}
        </h2>
        <span className="text-xs text-muted tabular-nums">
          {daysOff} {daysOff === 1 ? 'day' : 'days'} off · {workingDays} working days
        </span>
      </header>
      <div className="grid grid-cols-[repeat(5,minmax(0,1fr))_repeat(2,minmax(0,0.6fr))]">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="border-b border-line px-1 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted @lg:px-2 @lg:text-[11px]"
          >
            {d}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} aria-hidden="true" className="border-b border-r border-line-soft bg-surface-2/50" />
        ))}
        {cells}
        {Array.from({ length: trail }, (_, i) => (
          <div key={`trail-${i}`} aria-hidden="true" className="border-b border-r border-line-soft bg-surface-2/50 [&:nth-child(7n)]:border-r-0" />
        ))}
      </div>
    </section>
  )
}

export default memo(MonthGrid)
