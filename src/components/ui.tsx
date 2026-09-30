import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:brightness-110 shadow-sm',
  secondary: 'bg-surface text-fg border border-line hover:bg-surface-2',
  ghost: 'text-fg hover:bg-surface-2',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const sizing = size === 'sm' ? 'h-8 px-3 text-[13px] gap-1.5' : 'h-10 px-4 text-sm gap-2'
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${variants[variant]} ${className}`}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
      <Loader2 className="size-5 animate-spin" /> {label}
    </div>
  )
}

export const inputClass =
  'w-full h-10 rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted/70 focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/20 disabled:opacity-60'

interface FieldProps {
  label: string
  hint?: ReactNode
  error?: string | null
  children: (id: string) => ReactNode
  className?: string
}

export function Field({ label, hint, error, children, className = '' }: FieldProps) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-fg">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />
}

export function Alert({
  tone = 'info',
  children,
  icon,
}: {
  tone?: 'info' | 'error' | 'warning' | 'success'
  children: ReactNode
  icon?: ReactNode
}) {
  const tones = {
    info: 'border-primary/25 bg-primary/8 text-fg',
    error: 'border-red-500/30 bg-red-500/10 text-fg',
    warning: 'border-amber-500/35 bg-amber-500/10 text-fg',
    success: 'border-emerald-500/30 bg-emerald-500/10 text-fg',
  }
  return (
    <div className={`flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm leading-snug ${tones[tone]}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
}

export function Dialog({ open, onClose, title, children, footer, width = 'max-w-lg' }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.activeElement as HTMLElement | null
    const target =
      panel.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel.current?.querySelector<HTMLElement>('.dialog-body input, .dialog-body select, .dialog-body textarea') ??
      panel.current
    target?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="fade-in absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`dialog-in relative flex outline-none max-h-[92vh] w-full ${width} flex-col rounded-t-2xl border border-line bg-surface text-fg shadow-2xl sm:rounded-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold leading-snug">{title}</h2>
          <button onClick={onClose} className="-mr-1 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="dialog-body overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || '?'}
    </span>
  )
}
