import { useCallback, useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { CheckCircle2, Eye, Mail, PlugZap, Search, Send, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { Alert, Button, Dialog, Spinner, inputClass } from '../ui'
import { useToast } from '../../context/ToastContext'
import { callFunction, friendlyError, supabase } from '../../lib/supabase'
import { useAppSettings, usePeople, type AppSettings } from '../../lib/holidays'

interface StaffRow {
  email: string
  full_name: string
  sodeco_worker_id: string | null
  sodeco_employer: string | null
  active: boolean
}

function Card({
  title,
  subtitle,
  icon,
  actions,
  children,
}: {
  title: string
  subtitle?: React.ReactNode
  icon: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary ${
          checked ? 'bg-primary' : 'bg-line'
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  )
}

function when(iso: string | null): string {
  if (!iso) return 'never'
  const dt = DateTime.fromISO(iso)
  return `${dt.toFormat('ccc d LLL, HH:mm')} (${dt.toRelative()})`
}

export default function HolidaysAdmin() {
  const { settings, reload } = useAppSettings()
  if (!settings) return <Spinner label="Loading settings…" />
  return (
    <div className="space-y-5">
      <WeeklyEmailCard settings={settings} reload={reload} />
      <EmployeeListCard />
      <SodecoCard settings={settings} reload={reload} />
    </div>
  )
}

// ---------------------------------------------------------------------
// Weekly email
// ---------------------------------------------------------------------

function WeeklyEmailCard({ settings, reload }: { settings: AppSettings; reload: () => Promise<void> }) {
  const toast = useToast()
  const { people } = usePeople()
  const custom = settings.digest_recipients.length > 0
  const [mode, setMode] = useState<'everyone' | 'custom'>(custom ? 'custom' : 'everyone')
  const [addresses, setAddresses] = useState(settings.digest_recipients.join('\n'))
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'test' | 'send' | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string; recipients: number } | null>(null)
  const [confirmSend, setConfirmSend] = useState(false)

  const parsed = addresses
    .split(/[\s,;]+/)
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
  const dirty =
    (mode === 'everyone' && custom) ||
    (mode === 'custom' && parsed.join(',') !== settings.digest_recipients.join(','))

  async function update(values: Partial<AppSettings>, message: string) {
    setSaving(true)
    const { error } = await supabase.from('app_settings').update(values).eq('id', true)
    setSaving(false)
    if (error) return toast(friendlyError(error), 'error')
    toast(message)
    await reload()
  }

  async function run(action: 'preview' | 'test' | 'send') {
    setBusy(action)
    try {
      if (action === 'preview') {
        setPreview(await callFunction('holiday-digest', { action }))
      } else if (action === 'test') {
        const result = await callFunction<{ to: string }>('holiday-digest', { action })
        toast(`Test email sent to ${result.to}.`)
      } else {
        const result = await callFunction<{ sent?: number; skipped?: string }>('holiday-digest', { action })
        toast(result.skipped ?? `Sent to ${result.sent} people.`)
        setConfirmSend(false)
        await reload()
      }
    } catch (err) {
      toast(`${friendlyError(err)} Is the holiday-digest function deployed? (see README)`, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card
      title="Weekly email"
      icon={<Mail className="size-4" />}
      subtitle="Every Friday afternoon: who is off next week (“Full week” or the exact days), plus the 4 weeks after."
      actions={
        <>
          <Button size="sm" icon={<Eye className="size-4" />} loading={busy === 'preview'} onClick={() => run('preview')}>
            Preview
          </Button>
          <Button size="sm" icon={<Send className="size-4" />} loading={busy === 'test'} onClick={() => run('test')}>
            Send me a test
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Toggle
          checked={settings.digest_enabled}
          disabled={saving}
          onChange={(value) =>
            update({ digest_enabled: value }, value ? 'The weekly email is on.' : 'The weekly email is off.')
          }
          label="Send the weekly email automatically"
          hint={`Last sent: ${when(settings.digest_last_sent_at)}${
            settings.digest_last_sent_count ? ` to ${settings.digest_last_sent_count} people` : ''
          }.`}
        />

        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-[13px] font-medium">Who gets it</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="digest-mode" checked={mode === 'everyone'} onChange={() => setMode('everyone')} className="mt-1 accent-[var(--primary)]" />
            <span>
              Everyone: all accounts and everyone on the employee list ({people.length} people). They are in BCC, so
              nobody can reply to all.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="digest-mode" checked={mode === 'custom'} onChange={() => setMode('custom')} className="mt-1 accent-[var(--primary)]" />
            <span>Only these addresses, e.g. a distribution list like iedereen@paradisecity.be</span>
          </label>
          {mode === 'custom' && (
            <textarea
              className={`${inputClass} h-24 py-2`}
              value={addresses}
              onChange={(e) => setAddresses(e.target.value)}
              placeholder={'iedereen@paradisecity.be\nteam@touquetmusicbeach.com'}
              aria-label="Email addresses, one per line"
            />
          )}
          {dirty && (
            <Button
              size="sm"
              variant="primary"
              loading={saving}
              disabled={mode === 'custom' && parsed.length === 0}
              onClick={() =>
                update({ digest_recipients: mode === 'everyone' ? [] : parsed }, 'Recipients of the weekly email are saved.')
              }
            >
              Save recipients
            </Button>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button size="sm" variant="ghost" icon={<Send className="size-4" />} onClick={() => setConfirmSend(true)}>
            Send to everyone now
          </Button>
          <p className="text-xs text-muted">
            The email is about next week. GitHub sends it on Fridays (see README: “Weekly holiday email”).
          </p>
        </div>
      </div>

      {preview && (
        <Dialog open onClose={() => setPreview(null)} title={preview.subject} width="max-w-2xl">
          <p className="mb-3 text-sm text-muted">This is what {preview.recipients} people would receive right now.</p>
          <iframe
            title="Preview of the weekly email"
            srcDoc={preview.html}
            sandbox=""
            className="h-[60vh] w-full rounded-lg border border-line bg-white"
          />
        </Dialog>
      )}

      {confirmSend && (
        <Dialog
          open
          onClose={() => setConfirmSend(false)}
          title="Send the weekly email now?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmSend(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy === 'send'} onClick={() => run('send')}>
                Send now
              </Button>
            </>
          }
        >
          <p className="text-sm">
            Everyone on the list gets the email about next week right away. The automatic email on Friday is then
            skipped for that week, so nobody gets it twice.
          </p>
        </Dialog>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------
// Employee list
// ---------------------------------------------------------------------

interface ParsedLine {
  email: string
  full_name: string
  sodeco_worker_id: string | null
}

/** One employee per line: email, name, Sodeco number (comma, semicolon or tab; pasted from Excel works). */
function parseEmployees(text: string): { rows: ParsedLine[]; errors: string[] } {
  const rows: ParsedLine[] = []
  const errors: string[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return
    const cells = line.split(/\t|;|,/).map((c) => c.trim())
    const emailIndex = cells.findIndex((c) => c.includes('@'))
    if (emailIndex === -1) {
      if (i === 0) return // a header row
      errors.push(`Line ${i + 1}: no email address`)
      return
    }
    const email = cells[emailIndex].toLowerCase()
    const others = cells.filter((_, j) => j !== emailIndex)
    const number = others.find((c) => /^[0-9A-Za-z-]{1,40}$/.test(c) && /\d/.test(c)) ?? null
    const name = others.filter((c) => c && c !== number).join(' ').replace(/\s+/g, ' ').trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(`Line ${i + 1}: “${email}” is not a valid email address`)
    else rows.push({ email, full_name: name || email.split('@')[0], sodeco_worker_id: number })
  })
  return { rows, errors }
}

function EmployeeListCard() {
  const toast = useToast()
  const [staff, setStaff] = useState<StaffRow[] | null>(null)
  const [accounts, setAccounts] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<StaffRow | null>(null)

  const load = useCallback(async () => {
    const [{ data, error }, { data: profiles }] = await Promise.all([
      supabase.from('staff').select('email, full_name, sodeco_worker_id, sodeco_employer, active').order('full_name'),
      supabase.from('profiles').select('email'),
    ])
    if (error) toast(friendlyError(error), 'error')
    setStaff((data as StaffRow[]) ?? [])
    setAccounts(new Set((profiles ?? []).map((p) => p.email)))
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const parsed = useMemo(() => parseEmployees(text), [text])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (staff ?? []).filter(
      (s) => !q || s.full_name.toLowerCase().includes(q) || s.email.includes(q) || s.sodeco_worker_id?.includes(q),
    )
  }, [staff, query])

  async function save() {
    if (parsed.rows.length === 0) return
    setSaving(true)
    const { error } = await supabase
      .from('staff')
      .upsert(parsed.rows.map((r) => ({ ...r, active: true })), { onConflict: 'email' })
    setSaving(false)
    if (error) return toast(friendlyError(error), 'error')
    toast(`${parsed.rows.length} ${parsed.rows.length === 1 ? 'employee' : 'employees'} saved.`)
    setAdding(false)
    setText('')
    await load()
  }

  async function remove() {
    if (!removing) return
    const { error } = await supabase.from('staff').delete().eq('email', removing.email)
    if (error) return toast(friendlyError(error), 'error')
    toast(`${removing.full_name} is removed from the employee list.`)
    setRemoving(null)
    await load()
  }

  const missingNumbers = (staff ?? []).filter((s) => !s.sodeco_worker_id).length

  return (
    <Card
      title={`Full-time employees${staff ? ` (${staff.length})` : ''}`}
      icon={<Upload className="size-4" />}
      subtitle="Everyone on this list is a full-time employee: they show up in the planner, also without an account, and their days off come from Sodeco."
      actions={
        <Button size="sm" variant="primary" icon={<Upload className="size-4" />} onClick={() => setAdding(true)}>
          Add or update employees
        </Button>
      }
    >
      {!staff ? (
        <Spinner label="Loading employees…" />
      ) : staff.length === 0 ? (
        <Alert tone="info">
          The list is empty. Click <span className="font-medium">Add or update employees</span> and paste the email list
          (with names and Sodeco numbers).
        </Alert>
      ) : (
        <>
          {missingNumbers > 0 && (
            <div className="mb-3">
              <Alert tone="warning">
                {missingNumbers} {missingNumbers === 1 ? 'employee has' : 'employees have'} no Sodeco number yet. Their
                days off can't be matched until you add it.
              </Alert>
            </div>
          )}
          <div className="relative mb-3 w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              className={`${inputClass} pl-9`}
              placeholder="Search by name, email or number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Sodeco no.</th>
                  <th className="px-3 py-2 font-semibold">Account</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.email} className="border-t border-line-soft">
                    <td className="px-3 py-2 font-medium">{s.full_name}</td>
                    <td className="px-3 py-2 text-muted">{s.email}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {s.sodeco_worker_id ?? <span className="text-amber-600">missing</span>}
                    </td>
                    <td className="px-3 py-2 text-muted">{accounts.has(s.email) ? 'Yes' : 'Not yet'}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => setRemoving(s)}
                        className="rounded-md p-1.5 text-muted hover:bg-red-500/10 hover:text-red-600"
                        aria-label={`Remove ${s.full_name} from the list`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {adding && (
        <Dialog
          open
          onClose={() => setAdding(false)}
          title="Add or update employees"
          width="max-w-2xl"
          footer={
            <>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={saving} disabled={parsed.rows.length === 0} onClick={save}>
                Save {parsed.rows.length || ''} {parsed.rows.length === 1 ? 'employee' : 'employees'}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-muted">
            One employee per line: <span className="font-medium text-fg">email, full name, Sodeco worker number</span>.
            Copying the three columns from Excel works too. Someone who is already on the list is updated.
          </p>
          <textarea
            className={`${inputClass} h-48 py-2 font-mono text-[13px]`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'sofie@paradisecity.be, Sofie Vermeulen, 1001\njan@paradisecity.be, Jan Peeters, 1002'}
            aria-label="Employees, one per line"
            data-autofocus
          />
          {parsed.rows.length > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="size-4" /> {parsed.rows.length} ready to save
              {parsed.rows.some((r) => !r.sodeco_worker_id) &&
                ` (${parsed.rows.filter((r) => !r.sodeco_worker_id).length} without a Sodeco number)`}
            </p>
          )}
          {parsed.errors.length > 0 && (
            <div className="mt-2">
              <Alert tone="warning">
                <ul className="list-disc pl-4">
                  {parsed.errors.slice(0, 8).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}
        </Dialog>
      )}

      {removing && (
        <Dialog
          open
          onClose={() => setRemoving(null)}
          title={`Remove ${removing.full_name} from the employee list?`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={remove}>
                Remove
              </Button>
            </>
          }
        >
          <p className="text-sm">
            Their days off are no longer synced from Sodeco. If they have an account, it stays; you can change their
            status in Admin → Users.
          </p>
        </Dialog>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------
// Sodeco connection
// ---------------------------------------------------------------------

function SodecoCard({ settings, reload }: { settings: AppSettings; reload: () => Promise<void> }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const synced = settings.sodeco_last_sync_at

  async function toggle(value: boolean) {
    setSaving(true)
    const { error } = await supabase.from('app_settings').update({ employees_add_own: value }).eq('id', true)
    setSaving(false)
    if (error) return toast(friendlyError(error), 'error')
    toast(value ? 'Full-time employees can now add their own days off.' : 'Only freelancers add their own days off now.')
    await reload()
  }

  return (
    <Card
      title="Sodeco connection"
      icon={<PlugZap className="size-4" />}
      subtitle="Every night, GitHub copies the days off of everyone on the employee list from Sodeco into the planner."
    >
      <div className="space-y-4">
        {!synced ? (
          <Alert tone="info">
            Not connected yet. Once Sodeco has sent the certificate, follow “Connect Sodeco” in the README.
          </Alert>
        ) : settings.sodeco_last_sync_ok ? (
          <Alert tone="success" icon={<CheckCircle2 className="size-4 text-emerald-500" />}>
            Last sync: {when(synced)}. {settings.sodeco_last_sync_message}
          </Alert>
        ) : (
          <Alert tone="error" icon={<TriangleAlert className="size-4 text-red-500" />}>
            The last sync failed ({when(synced)}): {settings.sodeco_last_sync_message}
          </Alert>
        )}
        <p className="text-xs text-muted">
          To sync right away: GitHub → Actions → <span className="font-medium">Sync Sodeco absences</span> → Run workflow.
        </p>
        <div className="border-t border-line pt-4">
          <Toggle
            checked={settings.employees_add_own}
            disabled={saving}
            onChange={toggle}
            label="Let full-time employees add their own days off too"
            hint="Handy until the Sodeco connection is live. Switch it off afterwards, so days off aren't counted twice."
          />
        </div>
      </div>
    </Card>
  )
}
