import { useEffect, useState } from 'react'
import { Alert, Button, Spinner } from './ui'
import WorkTypeChoice from './WorkTypeChoice'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { friendlyError, supabase } from '../lib/supabase'
import type { WorkType } from '../lib/types'

interface ListedPerson {
  worker_id: string
  full_name: string
}

/** Asked once to colleagues who haven't chosen their group yet. */
export default function WorkTypePrompt() {
  const { profile, refreshProfile } = useAuth()
  const toast = useToast()
  const [value, setValue] = useState<WorkType | null>(null)
  const [listed, setListed] = useState<ListedPerson[] | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The names on the employee list that are still free to pick.
  useEffect(() => {
    if (value !== 'employee' || listed) return
    supabase.rpc('claimable_staff').then(({ data, error: err }) => {
      if (err) setError(friendlyError(err))
      setListed((data as ListedPerson[]) ?? [])
    })
  }, [value, listed])

  async function save() {
    if (!profile || !value) return
    if (value === 'employee' && !me) return setError('Choose your name from the list.')
    setSaving(true)
    setError(null)
    const { error: err } =
      value === 'employee'
        ? await supabase.rpc('claim_staff', { p_worker_id: me })
        : await supabase.from('profiles').update({ work_type: value }).eq('id', profile.id)
    setSaving(false)
    if (err) return setError(friendlyError(err))
    await refreshProfile()
    toast('Thanks! Welcome to the holiday planner.')
  }

  const employeeList = !listed ? (
    <Spinner label="Loading the list…" />
  ) : listed.length === 0 ? (
    <p className="text-xs text-muted">
      There's nobody on the list to choose from yet. Choose another group, or ask an admin to add you to the employee
      list.
    </p>
  ) : (
    <fieldset>
      <legend className="mb-2 text-[13px] font-semibold">Are you one of the following persons?</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {listed.map((p) => (
          <label key={p.worker_id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
            <input
              type="radio"
              name="listed-person"
              checked={me === p.worker_id}
              onChange={() => setMe(p.worker_id)}
              className="accent-[var(--primary)]"
            />
            {p.full_name}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">Not on the list? Then choose one of the other two groups, or ask an admin.</p>
    </fieldset>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="fade-in absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-type-title"
        className="dialog-in relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 text-fg shadow-2xl sm:rounded-2xl sm:p-6"
      >
        <h2 id="work-type-title" className="text-lg font-semibold">
          One quick question
        </h2>
        <p className="mt-1 text-sm text-muted">
          Which group are you in? This decides where your days off in the holiday planner come from. You only answer this
          once.
        </p>
        <div className="mt-5">
          <WorkTypeChoice value={value} onChange={setValue} name="work-type-prompt" employeeExtra={employeeList} />
        </div>
        {error && (
          <div className="mt-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        <Button
          variant="primary"
          className="mt-5 w-full"
          disabled={!value || (value === 'employee' && !me)}
          loading={saving}
          onClick={save}
        >
          Save and continue
        </Button>
        <p className="mt-3 text-center text-xs text-muted">Picked the wrong one later? Ask an admin to change it.</p>
      </div>
    </div>
  )
}
