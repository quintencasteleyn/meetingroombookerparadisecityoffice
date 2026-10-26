import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { Button, Dialog } from '../components/ui'
import MonthGrid from '../components/holidays/MonthGrid'
import DayPanel, { absenceRange } from '../components/holidays/DayPanel'
import AbsenceDialog from '../components/holidays/AbsenceDialog'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useLocalPreference } from '../lib/hooks'
import { friendlyError, supabase } from '../lib/supabase'
import { nowInBrussels } from '../lib/time'
import {
  ABSENCE_COLUMNS,
  absencesByDay,
  addDays,
  mondayOf,
  useAbsences,
  useAppSettings,
  usePeople,
  type Absence,
} from '../lib/holidays'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

type Filter = 'all' | 'employee' | 'freelancer'

/** 'YYYY-MM-01' shifted by n months. */
function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1 + n, 1))
  return date.toISOString().slice(0, 10)
}

function lastDayOf(month: string): string {
  return addDays(shiftMonth(month, 1), -1)
}

function monthTitle(first: string, last: string): string {
  const [y1, m1] = first.split('-').map(Number)
  const [y2, m2] = last.split('-').map(Number)
  if (first === last) return `${MONTHS[m1 - 1]} ${y1}`
  if (y1 === y2) return `${MONTHS[m1 - 1]} – ${MONTHS[m2 - 1]} ${y2}`
  return `${MONTHS[m1 - 1]} ${y1} – ${MONTHS[m2 - 1]} ${y2}`
}

export default function HolidaysPage() {
  const { profile, isAdmin } = useAuth()
  const toast = useToast()
  const today = nowInBrussels().toISODate()!
  const thisMonth = `${today.slice(0, 8)}01`

  const [month, setMonth] = useState(thisMonth)
  const [countPref, setCountPref] = useLocalPreference<'1' | '2'>('pcr-holiday-months', '2')
  const [filter, setFilter] = useLocalPreference<Filter>('pcr-holiday-filter', 'all')
  const [selected, setSelected] = useState(today)
  const [editing, setEditing] = useState<Absence | 'new' | null>(null)
  const [removing, setRemoving] = useState<Absence | null>(null)
  const [working, setWorking] = useState(false)

  const count = countPref === '1' ? 1 : 2
  const months = useMemo(() => Array.from({ length: count }, (_, i) => shiftMonth(month, i)), [month, count])
  const from = months[0]
  const to = lastDayOf(months[months.length - 1])
  // Also load the week around the selected day and today, for the side panel.
  const loadFrom = [from, mondayOf(today), mondayOf(selected)].sort()[0]
  const loadTo = [to, addDays(mondayOf(today), 6), selected].sort().reverse()[0]

  const { absences, reload } = useAbsences(loadFrom, loadTo)
  const { people, byEmail } = usePeople()
  const { settings } = useAppSettings()

  const me = profile?.email ?? ''
  const personOf = useCallback((email: string) => byEmail.get(email), [byEmail])
  const canAddOwn =
    profile?.work_type === 'freelancer' || (profile?.work_type === 'employee' && Boolean(settings?.employees_add_own))
  const canChange = useCallback(
    (a: Absence) => a.source === 'manual' && (isAdmin || (a.person_email === me && canAddOwn)),
    [isAdmin, me, canAddOwn],
  )

  const visible = useMemo(
    () =>
      absences.filter((a) => {
        if (filter === 'all') return true
        const type = byEmail.get(a.person_email)?.work_type ?? (a.source === 'sodeco' ? 'employee' : null)
        return type === filter
      }),
    [absences, filter, byEmail],
  )
  const byDay = useMemo(() => absencesByDay(visible, loadFrom, loadTo), [visible, loadFrom, loadTo])

  // A day counts as busy when a quarter of the team is off (at least 3 people).
  const busyFrom = Math.max(3, Math.ceil(people.length / 4))

  const week = useMemo(() => {
    const monday = mondayOf(today)
    const totals = new Map<string, number>()
    for (let i = 0; i < 5; i++) {
      for (const a of byDay.get(addDays(monday, i)) ?? []) {
        totals.set(a.person_email, (totals.get(a.person_email) ?? 0) + (a.day_part === 'full' ? 1 : 0.5))
      }
    }
    return [...totals]
      .map(([email, days]) => ({ email, days }))
      .sort((a, b) => (byEmail.get(a.email)?.full_name ?? a.email).localeCompare(byEmail.get(b.email)?.full_name ?? b.email))
  }, [byDay, today, byEmail])

  const [mine, setMine] = useState<Absence[]>([])
  const loadMine = useCallback(async () => {
    if (!me) return
    const { data } = await supabase
      .from('absences')
      .select(ABSENCE_COLUMNS)
      .eq('person_email', me)
      .gte('end_date', today)
      .order('start_date')
      .limit(20)
    setMine((data as Absence[]) ?? [])
  }, [me, today])
  useEffect(() => {
    void loadMine()
  }, [loadMine, absences]) // refresh together with the calendar

  const dayList = byDay.get(selected) ?? []
  const isEmployee = profile?.work_type === 'employee'
  const myNote = isEmployee
    ? canAddOwn
      ? 'Until the Sodeco connection is live, you can add your own days off here.'
      : 'Your days off come from Sodeco. To change them, change them in Sodeco.'
    : null

  async function remove() {
    if (!removing) return
    setWorking(true)
    const { error } = await supabase.from('absences').delete().eq('id', removing.id)
    setWorking(false)
    if (error) return toast(friendlyError(error), 'error')
    toast('Days off removed.')
    setRemoving(null)
    void reload()
  }

  function goTo(day: string) {
    setSelected(day)
    const first = `${day.slice(0, 8)}01`
    if (!months.includes(first)) setMonth(first)
  }

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-3 py-5 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <div className="mr-auto min-w-0 basis-full sm:basis-auto">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{monthTitle(months[0], months[months.length - 1])}</h1>
          <p className="text-sm text-muted">Who is off, by name, every day</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            onClick={() => {
              setMonth(thisMonth)
              setSelected(today)
            }}
          >
            Today
          </Button>
          <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Months shown">
          {(['1', '2'] as const).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={countPref === n}
              onClick={() => setCountPref(n)}
              className={`rounded-md px-2.5 py-1 text-[13px] font-medium ${
                countPref === n ? 'bg-primary text-on-primary shadow-sm' : 'text-muted hover:text-fg'
              }`}
            >
              {n === '1' ? '1 month' : '2 months'}
            </button>
          ))}
        </div>
        <select
          aria-label="Show"
          className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px]"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
        >
          <option value="all">Everyone</option>
          <option value="employee">Full-time only</option>
          <option value="freelancer">Freelancers only</option>
        </select>
        {canAddOwn || isAdmin ? (
          <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Add days off
          </Button>
        ) : isEmployee ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
            <RefreshCw className="size-3.5" /> Your days off come from Sodeco
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="chip chip-employee rounded px-1.5 py-px font-medium">Full-time</span> from Sodeco
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="chip chip-freelancer rounded px-1.5 py-px font-medium">Freelancer</span> added in the app
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="chip chip-employee chip-me rounded px-1.5 py-px font-medium">You</span> solid = your days
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-rose-500/60 bg-rose-500/10" /> public holiday
        </span>
      </div>

      <div className="grid items-start gap-4 min-[1180px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className={`grid items-start gap-4 ${count === 2 ? 'md:grid-cols-2' : ''}`}>
          {months.map((m) => (
            <MonthGrid
              key={m}
              month={m}
              byDay={byDay}
              personOf={personOf}
              me={me}
              today={today}
              selected={selected}
              busyFrom={busyFrom}
              onSelect={setSelected}
            />
          ))}
        </div>
        <DayPanel
          day={selected}
          today={today}
          list={[...dayList].sort((a, b) => (a.person_email === me ? -1 : b.person_email === me ? 1 : 0))}
          week={week}
          mine={mine}
          myNote={myNote}
          personOf={personOf}
          me={me}
          canChange={canChange}
          onEdit={(a) => setEditing(a)}
          onRemove={(a) => setRemoving(a)}
        />
      </div>

      {editing && profile && (
        <AbsenceDialog
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            setEditing(null)
            goTo(row.start_date)
            void reload()
          }}
          existing={editing === 'new' ? null : editing}
          defaultDate={selected >= today ? selected : today}
          me={{ email: profile.email, full_name: profile.full_name }}
          people={isAdmin ? people : null}
        />
      )}

      {removing && (
        <Dialog
          open
          onClose={() => setRemoving(null)}
          title="Remove these days off?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                Keep them
              </Button>
              <Button variant="danger" loading={working} onClick={remove}>
                Remove
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {byEmail.get(removing.person_email)?.full_name ?? removing.person_email}:{' '}
            <span className="font-semibold">{absenceRange(removing)}</span>. Colleagues will no longer see these days.
          </p>
        </Dialog>
      )}
    </div>
  )
}
