import { useState } from 'react'
import { Alert, Button } from './ui'
import WorkTypeChoice from './WorkTypeChoice'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { friendlyError, supabase } from '../lib/supabase'
import type { WorkType } from '../lib/types'

/** Asked once to colleagues who haven't said yet whether they're full-time or freelance. */
export default function WorkTypePrompt() {
  const { profile, refreshProfile } = useAuth()
  const toast = useToast()
  const [value, setValue] = useState<WorkType | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!profile || !value) return
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.from('profiles').update({ work_type: value }).eq('id', profile.id)
    setSaving(false)
    if (err) return setError(friendlyError(err))
    await refreshProfile()
    toast('Thanks! Welcome to the holiday planner.')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="fade-in absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-type-title"
        className="dialog-in relative w-full max-w-lg rounded-t-2xl border border-line bg-surface p-5 text-fg shadow-2xl sm:rounded-2xl sm:p-6"
      >
        <h2 id="work-type-title" className="text-lg font-semibold">
          One quick question
        </h2>
        <p className="mt-1 text-sm text-muted">
          How do you work with us? This decides where your days off in the holiday planner come from. You only answer
          this once.
        </p>
        <div className="mt-5">
          <WorkTypeChoice value={value} onChange={setValue} name="work-type-prompt" />
        </div>
        {error && (
          <div className="mt-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        <Button variant="primary" className="mt-5 w-full" disabled={!value} loading={saving} onClick={save}>
          Save and continue
        </Button>
        <p className="mt-3 text-center text-xs text-muted">Picked the wrong one later? Ask an admin to change it.</p>
      </div>
    </div>
  )
}
