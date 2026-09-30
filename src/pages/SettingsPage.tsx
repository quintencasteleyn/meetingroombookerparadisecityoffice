import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { Alert, Button, Field, inputClass } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { friendlyError, supabase } from '../lib/supabase'
import { DEFAULT_THEME, PRESETS, applyTheme, readableOn, resolveTheme, type ThemeSettings } from '../lib/theme'

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

export default function SettingsPage() {
  const { profile, saveTheme, refreshProfile } = useAuth()
  const toast = useToast()
  const saved = profile?.theme ?? DEFAULT_THEME
  const [theme, setTheme] = useState<ThemeSettings>(saved)
  const [savingTheme, setSavingTheme] = useState(false)
  const [name, setName] = useState(profile?.full_name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [savingPw, setSavingPw] = useState(false)

  const colors = resolveTheme(theme)
  const savedRef = useRef(saved)
  savedRef.current = saved

  // Leaving the page without saving drops the preview.
  useEffect(() => () => applyTheme(savedRef.current), [])
  const dirty = JSON.stringify(theme) !== JSON.stringify(saved)

  function preview(next: ThemeSettings) {
    setTheme(next)
    applyTheme(next)
  }

  async function storeTheme() {
    setSavingTheme(true)
    try {
      await saveTheme(theme)
      toast('Your colours are saved. Only you see them.')
    } catch (err) {
      toast(friendlyError(err), 'error')
    } finally {
      setSavingTheme(false)
    }
  }

  async function saveName(e: FormEvent) {
    e.preventDefault()
    if (!profile || !name.trim()) return
    setSavingName(true)
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', profile.id)
    setSavingName(false)
    if (error) return toast(friendlyError(error), 'error')
    await refreshProfile()
    toast('Your name is updated.')
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    setPwError(null)
    if (password.length < 8) return setPwError('Your password needs at least 8 characters.')
    if (password !== confirm) return setPwError("The passwords don't match.")
    setSavingPw(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSavingPw(false)
    if (error) return setPwError(error.message)
    setPassword('')
    setConfirm('')
    toast('Your new password is saved.')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card title="Colours" subtitle="Pick the look you like. This only changes the app for you, not for your colleagues.">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {PRESETS.map((p) => {
            const selected = theme.preset === p.id && !theme.background && !theme.primary
            return (
              <button
                key={p.id}
                onClick={() => preview({ preset: p.id })}
                className={`group relative overflow-hidden rounded-xl border text-left transition ${
                  selected ? 'border-primary ring-2 ring-primary/30' : 'border-line hover:border-primary/50'
                }`}
              >
                <div className="flex h-14 items-end gap-1.5 p-2.5" style={{ background: p.background }}>
                  <span className="h-5 w-10 rounded-md" style={{ background: p.primary }} />
                  <span className="h-3 w-6 rounded" style={{ background: p.primary, opacity: 0.35 }} />
                </div>
                <div className="flex items-center justify-between bg-surface px-2.5 py-1.5 text-[13px] font-medium">
                  {p.name}
                  {selected && <Check className="size-4 text-primary" />}
                </div>
              </button>
            )
          })}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <ColorField
            label="Background colour"
            value={colors.background}
            onChange={(background) => preview({ ...theme, background })}
          />
          <ColorField
            label="Button colour"
            value={colors.primary}
            onChange={(primary) => preview({ ...theme, primary })}
          />
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-xl border border-line p-3" style={{ background: colors.background }}>
          <span
            className="rounded-lg px-3 py-1.5 text-sm font-medium"
            style={{ background: colors.primary, color: readableOn(colors.primary) }}
          >
            Button preview
          </span>
          <span className="text-sm text-fg">This is how the app looks for you.</span>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" onClick={storeTheme} loading={savingTheme} disabled={!dirty}>
            Save colours
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => preview(saved)}>
              Undo changes
            </Button>
          )}
          <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => preview(DEFAULT_THEME)} className="ml-auto">
            Standard colours
          </Button>
        </div>
      </Card>

      <Card title="Profile" subtitle="Your name is shown on your bookings.">
        <form onSubmit={saveName} className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            {(id) => (
              <input id={id} className={inputClass} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label="Email">
            {(id) => <input id={id} className={inputClass} value={profile?.email ?? ''} disabled />}
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={savingName} disabled={!name.trim() || name.trim() === profile?.full_name}>
              Save name
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Password">
        <form onSubmit={savePassword} className="grid gap-4 sm:grid-cols-2">
          <Field label="New password" hint="At least 8 characters.">
            {(id) => (
              <input
                id={id}
                type="password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            )}
          </Field>
          <Field label="Repeat new password">
            {(id) => (
              <input
                id={id}
                type="password"
                className={inputClass}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            )}
          </Field>
          {pwError && (
            <div className="sm:col-span-2">
              <Alert tone="error">{pwError}</Alert>
            </div>
          )}
          <div>
            <Button type="submit" variant="primary" loading={savingPw} disabled={!password}>
              Change password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <Field label={label}>
      {(id) => (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface p-1"
          />
          <input
            className={`${inputClass} font-mono uppercase`}
            value={text}
            maxLength={7}
            onChange={(e) => {
              setText(e.target.value)
              if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase())
            }}
            onBlur={() => setText(value)}
            aria-label={`${label} (hex)`}
          />
        </div>
      )}
    </Field>
  )
}
