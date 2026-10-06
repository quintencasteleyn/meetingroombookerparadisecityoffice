import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { EmailOtpType } from '@supabase/supabase-js'
import { Eye, EyeOff, MailCheck } from 'lucide-react'
import { Alert, Button, Field, inputClass } from '../components/ui'
import Logo from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabase'

export const ALLOWED_DOMAINS = ['paradisecity.be', 'touquetmusicbeach.com']
export const ALLOWED_DOMAINS_TEXT = ALLOWED_DOMAINS.map((d) => `@${d}`).join(' or ')
const MIN_PASSWORD = 8

function isAllowedEmail(email: string): boolean {
  return ALLOWED_DOMAINS.some((d) => email.endsWith(`@${d}`))
}

/** True once the part after @ clearly isn't one of ours (not while still typing it). */
function isWrongDomain(email: string): boolean {
  const domain = email.split('@')[1]
  if (!domain || !domain.includes('.')) return false
  return !ALLOWED_DOMAINS.some((d) => d.startsWith(domain))
}

function redirectBase(): string {
  return `${window.location.origin}${window.location.pathname}`
}

function authMessage(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('failed to fetch')) return 'Could not reach the server. Check your internet connection and try again.'
  if (m.includes('secret api key'))
    return 'The website is set up with the wrong Supabase key (the secret key instead of the publishable key). Please tell the admin.'
  if (m.includes('invalid login credentials')) return 'Wrong email or password.'
  if (m.includes('email not confirmed')) return 'Please confirm your email address first. Check your inbox (and spam folder).'
  if (m.includes('banned')) return 'Your account has been blocked. Please contact the admin.'
  if (m.includes('database error saving new user') || m.includes('only @'))
    return `Only ${ALLOWED_DOMAINS_TEXT} email addresses can create an account.`
  if (m.includes('rate limit') || m.includes('security purposes'))
    return 'Too many attempts. Please wait a minute and try again.'
  if (m.includes('password should be')) return `Choose a stronger password (at least ${MIN_PASSWORD} characters).`
  return message
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth-bg flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex justify-center">
          <Logo large />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-xl sm:p-8">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-6 text-center text-xs text-muted">Meeting rooms · Paradise City office</p>
      </div>
    </div>
  )
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        className={`${inputClass} pr-10`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-fg"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

export function LoginPage() {
  const { notice, setNotice } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)
    if (err) {
      setUnconfirmed(err.message.toLowerCase().includes('not confirmed'))
      setError(authMessage(err.message))
    }
  }

  async function resend() {
    const { error: err } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: redirectBase() },
    })
    if (err) setError(authMessage(err.message))
    else toast('We sent you a new confirmation email.')
  }

  return (
    <AuthLayout title="Sign in" subtitle="Book a meeting room in a few clicks.">
      <form onSubmit={submit} className="space-y-4">
        {notice && <Alert tone="warning">{notice}</Alert>}
        <Field label="Work email">
          {(id) => (
            <input
              id={id}
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={`name@${ALLOWED_DOMAINS[0]}`}
              autoComplete="email"
              required
            />
          )}
        </Field>
        <Field label="Password">
          {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="current-password" />}
        </Field>
        <div className="-mt-1 flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        {error && (
          <Alert tone="error">
            {error}
            {unconfirmed && (
              <button type="button" onClick={resend} className="ml-1 font-medium text-primary underline">
                Send the email again
              </button>
            )}
          </Alert>
        )}
        <Button type="submit" variant="primary" className="w-full" loading={loading}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        New here?{' '}
        <Link to="/signup" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  )
}

export function SignupPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const cleanEmail = email.trim().toLowerCase()
  const wrongDomain = isWrongDomain(cleanEmail)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!fullName.trim()) return setError('Please enter your name.')
    if (!isAllowedEmail(cleanEmail)) return setError(`Please use your ${ALLOWED_DOMAINS_TEXT} email address.`)
    if (password.length < MIN_PASSWORD) return setError(`Your password needs at least ${MIN_PASSWORD} characters.`)
    if (password !== confirm) return setError("The passwords don't match.")

    setLoading(true)
    const { data, error: err } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { full_name: fullName.trim() }, emailRedirectTo: redirectBase() },
    })
    setLoading(false)
    if (err) return setError(authMessage(err.message))
    if (data.user && data.user.identities?.length === 0) {
      return setError('An account with this email already exists. Sign in, or use "Forgot password?".')
    }
    setSentTo(cleanEmail)
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your inbox">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 grid size-14 place-items-center rounded-full bg-primary/12 text-primary">
            <MailCheck className="size-7" />
          </div>
          <p className="text-sm">
            We sent a confirmation link to <span className="font-semibold">{sentTo}</span>. Click the link in the email to
            activate your account.
          </p>
          <p className="mt-3 text-xs text-muted">No email after a few minutes? Check your spam or junk folder.</p>
          <Link to="/login" className="mt-6 text-sm font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Create your account" subtitle={`For colleagues with a ${ALLOWED_DOMAINS_TEXT} email address.`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name">
          {(id) => (
            <input
              id={id}
              className={inputClass}
              value={fullName}
              maxLength={100}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="First and last name"
              autoComplete="name"
              required
            />
          )}
        </Field>
        <Field label="Work email" error={wrongDomain ? `Use your ${ALLOWED_DOMAINS_TEXT} address.` : null}>
          {(id) => (
            <input
              id={id}
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={`name@${ALLOWED_DOMAINS[0]}`}
              autoComplete="email"
              required
            />
          )}
        </Field>
        <Field label="Password" hint={`At least ${MIN_PASSWORD} characters.`}>
          {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="new-password" />}
        </Field>
        <Field label="Repeat password">
          {(id) => <PasswordInput id={id} value={confirm} onChange={setConfirm} autoComplete="new-password" />}
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="primary" className="w-full" loading={loading}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: redirectBase(),
    })
    setLoading(false)
    if (err) setError(authMessage(err.message))
    else setSent(true)
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="No problem. We'll email you a link to choose a new one."
    >
      {sent ? (
        <div className="space-y-4">
          <Alert tone="success" icon={<MailCheck className="size-4 text-emerald-500" />}>
            If an account exists for <span className="font-semibold">{email}</span>, you'll receive an email with a link
            in a minute. Check your spam folder too.
          </Alert>
          <Link to="/login" className="block text-center text-sm font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Work email">
            {(id) => (
              <input
                id={id}
                type="email"
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`name@${ALLOWED_DOMAINS[0]}`}
                autoComplete="email"
                required
              />
            )}
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" variant="primary" className="w-full" loading={loading}>
            Send reset link
          </Button>
          <Link to="/login" className="block text-center text-sm font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  )
}

const CONFIRM_COPY: Record<string, { title: string; text: string; button: string }> = {
  signup: { title: 'Confirm your account', text: 'One last click to activate your account.', button: 'Activate my account' },
  recovery: { title: 'Reset your password', text: 'Click below to choose a new password.', button: 'Continue' },
  invite: { title: 'Accept invitation', text: 'Click below to join.', button: 'Accept invitation' },
  magiclink: { title: 'Sign in', text: 'Click below to sign in.', button: 'Sign in' },
  email_change: { title: 'Confirm your email', text: 'Click below to confirm your new email address.', button: 'Confirm' },
}

/** Landing page for the links in our emails (see supabase/functions/auth-email). */
export function AuthConfirmPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const tokenHash = params.get('token_hash') ?? ''
  const type = params.get('type') ?? 'signup'
  const copy = CONFIRM_COPY[type] ?? CONFIRM_COPY.signup
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setLoading(true)
    setError(null)
    const otpType = (type === 'signup' ? 'email' : type) as EmailOtpType
    const { error: err } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType })
    setLoading(false)
    if (err) {
      setError(
        'This link is no longer valid (it may have been used already or expired). ' +
          (type === 'recovery' ? 'Please request a new reset link.' : 'Try signing in, or request a new link.'),
      )
      return
    }
    if (type === 'recovery') {
      navigate('/reset-password', { replace: true })
    } else {
      toast(type === 'signup' ? 'Welcome! Your account is active.' : 'Done!')
      navigate('/', { replace: true })
    }
  }

  return (
    <AuthLayout title={copy.title} subtitle={copy.text}>
      <div className="space-y-4">
        {!tokenHash && <Alert tone="error">This link is incomplete. Please use the full link from the email.</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <Button variant="primary" className="w-full" loading={loading} disabled={!tokenHash} onClick={confirm}>
          {copy.button}
        </Button>
        <Link
          to={type === 'recovery' ? '/forgot-password' : '/login'}
          className="block text-center text-sm font-medium text-primary hover:underline"
        >
          {type === 'recovery' ? 'Request a new link' : 'Back to sign in'}
        </Link>
      </div>
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD) return setError(`Your password needs at least ${MIN_PASSWORD} characters.`)
    if (password !== confirm) return setError("The passwords don't match.")
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (err) return setError(authMessage(err.message))
    toast('Your new password is saved.')
    navigate('/', { replace: true })
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password" hint={`At least ${MIN_PASSWORD} characters.`}>
          {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="new-password" />}
        </Field>
        <Field label="Repeat new password">
          {(id) => <PasswordInput id={id} value={confirm} onChange={setConfirm} autoComplete="new-password" />}
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="primary" className="w-full" loading={loading}>
          Save new password
        </Button>
      </form>
    </AuthLayout>
  )
}
