import { useMemo, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import type { Colleague } from '../lib/types'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MAX_GUESTS = 30

interface Props {
  id?: string
  value: string[]
  onChange: (guests: string[]) => void
  colleagues: Colleague[]
  excludeEmail?: string
}

export default function GuestInput({ id, value, onChange, colleagues, excludeEmail }: Props) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const nameOf = useMemo(() => new Map(colleagues.map((c) => [c.email.toLowerCase(), c.full_name])), [colleagues])

  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase()
    return colleagues
      .filter((c) => c.email !== excludeEmail && !value.includes(c.email.toLowerCase()))
      .filter((c) => !q || c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      .slice(0, 6)
  }, [colleagues, text, value, excludeEmail])

  function add(email: string) {
    const clean = email.trim().toLowerCase().replace(/[,;]$/, '')
    if (!clean) return
    if (!EMAIL.test(clean)) {
      setError(`"${clean}" is not a valid email address.`)
      return
    }
    if (value.length >= MAX_GUESTS) {
      setError(`You can add at most ${MAX_GUESTS} guests.`)
      return
    }
    if (!value.includes(clean)) onChange([...value, clean])
    setText('')
    setError(null)
    setActive(0)
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === 'Tab' && text.trim())) {
      if (!text.trim() && e.key === 'Enter') return
      e.preventDefault()
      const pick = open && suggestions[active] && !EMAIL.test(text.trim()) ? suggestions[active].email : text
      add(pick)
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1))
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20">
        {value.map((email) => (
          <span
            key={email}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary/12 py-0.5 pl-2 pr-1 text-xs font-medium text-fg"
            title={email}
          >
            <span className="truncate">{nameOf.get(email) ?? email}</span>
            <button
              type="button"
              onClick={() => onChange(value.filter((g) => g !== email))}
              className="rounded p-0.5 text-muted hover:bg-primary/15 hover:text-fg"
              aria-label={`Remove ${email}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
            setActive(0)
            setError(null)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setTimeout(() => setOpen(false), 150)
            if (EMAIL.test(text.trim())) add(text)
          }}
          onKeyDown={onKeyDown}
          placeholder={value.length ? 'Add another…' : 'Type a name or email address'}
          className="h-7 min-w-[10rem] flex-1 bg-transparent px-1 text-sm text-fg placeholder:text-muted/70 focus:outline-none"
          autoComplete="off"
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-40 mt-1 max-h-56 overflow-auto rounded-lg border border-line bg-surface py-1 shadow-xl">
          {suggestions.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  add(c.email)
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full flex-col px-3 py-1.5 text-left ${i === active ? 'bg-surface-2' : ''}`}
              >
                <span className="text-sm text-fg">{c.full_name}</span>
                <span className="text-xs text-muted">{c.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
