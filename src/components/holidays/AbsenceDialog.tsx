import { useMemo, useState, type FormEvent } from 'react'
import { Alert, Button, Dialog, Field, inputClass } from '../ui'
import { useToast } from '../../context/ToastContext'
import { friendlyError, supabase } from '../../lib/supabase'
import { eachDay, isWorkingDay, type Absence, type DayPart, type Person } from '../../lib/holidays'

interface AbsenceDialogProps {
  onClose: () => void
  onSaved: (absence: { start_date: string }) => void
  /** Change these days off instead of adding new ones. */
  existing: Absence | null
  defaultDate: string
  me: { email: string; full_name: string }
  /** Admins can add days off for anyone. */
  people: Person[] | null
}

export default function AbsenceDialog({ onClose, onSaved, existing, defaultDate, me, people }: AbsenceDialogProps) {
  const toast = useToast()
  const [person, setPerson] = useState(existing?.person_email ?? me.email)
  const [from, setFrom] = useState(existing?.start_date ?? defaultDate)
  const [to, setTo] = useState(existing?.end_date ?? defaultDate)
  const [part, setPart] = useState<DayPart>(existing?.day_part ?? 'full')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const singleDay = from !== '' && from === to
  const workingDays = useMemo(() => {
    if (!from || !to || to < from) return 0
    const count = eachDay(from, to).filter(isWorkingDay).length
    return singleDay && part !== 'full' ? count / 2 : count
  }, [from, to, part, singleDay])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!from || !to) return setError('Pick a first and a last day.')
    if (to < from) return setError('The last day is before the first day.')
    if (workingDays === 0) return setError('These are only weekend days or public holidays, so there is nothing to take off.')

    const row = { start_date: from, end_date: to, day_part: singleDay ? part : 'full' }
    setSaving(true)
    const { error: err } = existing
      ? await supabase.from('absences').update(row).eq('id', existing.id)
      : await supabase.from('absences').insert({ ...row, person_email: person })
    setSaving(false)
    if (err) return setError(friendlyError(err))
    toast(existing ? 'Your changes are saved.' : 'Days off added. Your colleagues can see them now.')
    onSaved(row)
  }

  const forSomeoneElse = person !== me.email

  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? 'Change days off' : 'Add days off'}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="absence-form" loading={saving}>
            {existing ? 'Save changes' : 'Add days off'}
          </Button>
        </>
      }
    >
      <form id="absence-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">
          {forSomeoneElse ? 'Everyone' : 'Your colleagues'} will see {forSomeoneElse ? 'this name' : 'your name'} on
          these days. Weekends and public holidays don't count.
        </p>
        {people && !existing && (
          <Field label="Who">
            {(id) => (
              <select id={id} className={inputClass} value={person} onChange={(e) => setPerson(e.target.value)}>
                {people.map((p) => (
                  <option key={p.email} value={p.email}>
                    {p.full_name}
                    {p.email === me.email ? ' (you)' : ''}
                    {p.work_type === 'employee' ? ' · full-time' : p.work_type === 'freelancer' ? ' · freelancer' : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day">
            {(id) => (
              <input
                id={id}
                type="date"
                className={inputClass}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value)
                  if (!to || to < e.target.value) setTo(e.target.value)
                }}
                required
              />
            )}
          </Field>
          <Field label="Last day">
            {(id) => (
              <input
                id={id}
                type="date"
                className={inputClass}
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                required
              />
            )}
          </Field>
        </div>
        {singleDay && (
          <Field label="Which part of the day">
            {(id) => (
              <select id={id} className={inputClass} value={part} onChange={(e) => setPart(e.target.value as DayPart)}>
                <option value="full">The whole day</option>
                <option value="am">Morning only</option>
                <option value="pm">Afternoon only</option>
              </select>
            )}
          </Field>
        )}
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{workingDays}</span>{' '}
          {workingDays === 1 ? 'working day' : 'working days'} off
        </p>
        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </Dialog>
  )
}
