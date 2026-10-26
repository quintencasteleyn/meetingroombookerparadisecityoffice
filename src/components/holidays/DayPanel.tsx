import { Pencil, Trash2 } from 'lucide-react'
import { Avatar } from '../ui'
import { partLabel, publicHolidayName, rangeLabel, weekdayOf, type Absence, type Person } from '../../lib/holidays'
import { nameOf } from './MonthGrid'

const LONG_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const LONG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function longDay(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${LONG_WEEKDAYS[weekdayOf(day) - 1]} ${d} ${LONG_MONTHS[m - 1]}`
}

function sourceText(absence: Absence, person: Person | undefined): string {
  const type = person?.work_type ?? (absence.source === 'sodeco' ? 'employee' : null)
  const who = type === 'employee' ? 'Full-time' : type === 'freelancer' ? 'Freelancer' : 'Status not set'
  const where = absence.source === 'sodeco' ? 'from Sodiwe' : 'added in the app'
  return `${who} · ${where}`
}

export function absenceRange(a: Absence): string {
  const range = rangeLabel(a.start_date, a.end_date)
  return a.day_part === 'full' ? range : `${range} (${partLabel(a.day_part)})`
}

interface DayPanelProps {
  day: string
  today: string
  list: Absence[]
  week: { email: string; days: number }[]
  mine: Absence[]
  myNote: string | null
  personOf: (email: string) => Person | undefined
  me: string
  canChange: (absence: Absence) => boolean
  onEdit: (absence: Absence) => void
  onRemove: (absence: Absence) => void
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line-soft px-4 py-3.5 last:border-b-0">
      <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  )
}

function Actions({ absence, onEdit, onRemove }: { absence: Absence; onEdit: () => void; onRemove: () => void }) {
  return (
    <span className="ml-auto flex shrink-0 gap-0.5">
      <button
        type="button"
        onClick={onEdit}
        className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
        aria-label={`Change ${absenceRange(absence)}`}
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-md p-1.5 text-muted hover:bg-red-500/10 hover:text-red-600"
        aria-label={`Remove ${absenceRange(absence)}`}
      >
        <Trash2 className="size-3.5" />
      </button>
    </span>
  )
}

export default function DayPanel({
  day,
  today,
  list,
  week,
  mine,
  myNote,
  personOf,
  me,
  canChange,
  onEdit,
  onRemove,
}: DayPanelProps) {
  const holiday = publicHolidayName(day)
  const weekend = weekdayOf(day) > 5

  return (
    <aside className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <Section title={day === today ? 'Off today' : 'Off on'}>
        <p className="-mt-1 mb-3 text-[17px] font-bold tracking-tight">{longDay(day)}</p>
        {holiday ? (
          <p className="text-sm text-muted">{holiday}. A public holiday, so the office is closed.</p>
        ) : weekend ? (
          <p className="text-sm text-muted">Weekend.</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted">Nobody is off. Everyone is in.</p>
        ) : (
          <ul className="space-y-2.5">
            {list.map((a) => {
              const person = personOf(a.person_email)
              const name = nameOf(a.person_email, person)
              return (
                <li key={a.id} className="flex items-center gap-2.5">
                  <Avatar name={name} size={32} />
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold">
                      {name}
                      {a.person_email === me && <span className="font-normal text-muted"> (you)</span>}
                      {a.status === 'requested' && (
                        <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-px text-[10.5px] font-semibold text-amber-600">
                          Not approved yet
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {sourceText(a, person)}
                      {a.day_part !== 'full' && ` · ${partLabel(a.day_part)}`}
                    </p>
                  </div>
                  {canChange(a) && <Actions absence={a} onEdit={() => onEdit(a)} onRemove={() => onRemove(a)} />}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="This week">
        {week.length === 0 ? (
          <p className="text-sm text-muted">Nobody is off this week.</p>
        ) : (
          <ul className="space-y-2.5">
            {week.map(({ email, days }) => {
              const name = nameOf(email, personOf(email))
              return (
                <li key={email} className="flex items-center gap-2.5">
                  <Avatar name={name} size={28} />
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold">{name}</p>
                    <p className="text-xs text-muted">
                      {days} {days === 1 ? 'day' : 'days'} off this week
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Your days off">
        {mine.length === 0 ? (
          <p className="text-sm text-muted">No days off planned.</p>
        ) : (
          <ul className="space-y-2">
            {mine.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-lg bg-surface-2 py-1.5 pl-3 pr-1 text-[13px]">
                <span className="min-w-0 truncate font-semibold">{absenceRange(a)}</span>
                {a.status === 'requested' && <span className="shrink-0 text-xs text-amber-600">not approved yet</span>}
                {canChange(a) ? (
                  <Actions absence={a} onEdit={() => onEdit(a)} onRemove={() => onRemove(a)} />
                ) : (
                  <span className="ml-auto h-7" />
                )}
              </li>
            ))}
          </ul>
        )}
        {myNote && <p className="mt-2.5 text-xs leading-relaxed text-muted">{myNote}</p>}
      </Section>
    </aside>
  )
}
