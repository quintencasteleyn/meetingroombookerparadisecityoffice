import { useCallback, useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { Ban, Copy, DoorOpen, Search, ShieldCheck, ShieldOff, Trash2, Unlock, Users } from 'lucide-react'
import { Alert, Avatar, Button, Dialog, Field, Spinner, inputClass } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { callFunction, friendlyError, supabase } from '../lib/supabase'
import { useRooms } from '../lib/hooks'
import type { Role, Room } from '../lib/types'
import { appLink } from '../lib/mailto'

interface AdminUser {
  id: string
  email: string
  full_name: string
  role: Role
  blocked: boolean
  created_at: string
  last_sign_in_at: string | null
  email_confirmed_at: string | null
  upcoming_bookings: number
}

type PendingAction =
  | { kind: 'block'; user: AdminUser }
  | { kind: 'unblock'; user: AdminUser }
  | { kind: 'delete'; user: AdminUser }
  | { kind: 'set_role'; user: AdminUser; role: Role }

function ago(iso: string | null): string {
  if (!iso) return 'Never'
  return DateTime.fromISO(iso).toRelative() ?? '—'
}

export default function AdminPage() {
  const [tab, setTab] = useState<'users' | 'rooms'>('users')
  const signupLink = `${appLink()}#/signup`
  const toast = useToast()

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-sm text-muted">Manage colleagues and meeting rooms.</p>
        </div>
        <div className="flex rounded-xl border border-line bg-surface p-1">
          {(
            [
              ['users', 'Users', Users],
              ['rooms', 'Rooms', DoorOpen],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium ${
                tab === id ? 'bg-primary text-on-primary shadow-sm' : 'text-muted hover:text-fg'
              }`}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Invite colleagues</p>
          <p className="truncate text-xs text-muted">
            Share this link. Anyone with a @paradisecity.be address can create an account.
          </p>
        </div>
        <code className="truncate rounded-lg bg-surface-2 px-3 py-2 text-xs">{signupLink}</code>
        <Button
          size="sm"
          icon={<Copy className="size-4" />}
          onClick={() => {
            void navigator.clipboard.writeText(signupLink)
            toast('Link copied.')
          }}
        >
          Copy
        </Button>
      </div>

      {tab === 'users' ? <UsersPanel /> : <RoomsPanel />}
    </div>
  )
}

function UsersPanel() {
  const { profile } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await callFunction<{ users: AdminUser[] }>('admin-users', { action: 'list' })
      setUsers(data.users)
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (users ?? []).filter((u) => !q || u.full_name.toLowerCase().includes(q) || u.email.includes(q))
  }, [users, query])

  async function run() {
    if (!pending) return
    setWorking(true)
    try {
      await callFunction('admin-users', {
        action: pending.kind,
        userId: pending.user.id,
        role: pending.kind === 'set_role' ? pending.role : undefined,
      })
      const name = pending.user.full_name
      toast(
        pending.kind === 'block'
          ? `${name} is blocked.`
          : pending.kind === 'unblock'
            ? `${name} can sign in again.`
            : pending.kind === 'delete'
              ? `${name}'s account is deleted.`
              : pending.role === 'admin'
                ? `${name} is now an admin.`
                : `${name} is no longer an admin.`,
      )
      setPending(null)
      await load()
    } catch (err) {
      toast(friendlyError(err), 'error')
    } finally {
      setWorking(false)
    }
  }

  if (error) {
    return (
      <Alert tone="error">
        Could not load the users: {error}. Is the <code>admin-users</code> function deployed? (see README)
      </Alert>
    )
  }
  if (!users) return <Spinner label="Loading users…" />

  const active = users.filter((u) => !u.blocked).length

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            className={`${inputClass} pl-9`}
            placeholder="Search by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="text-sm text-muted">
          {users.length} account{users.length === 1 ? '' : 's'} · {active} active
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <ul className="divide-y divide-[var(--line)]">
          {filtered.map((u) => {
            const me = u.id === profile?.id
            return (
              <li key={u.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={u.full_name} size={36} />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{u.full_name}</span>
                      {me && <span className="text-xs text-muted">(you)</span>}
                      {u.role === 'admin' && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-primary/12 px-1.5 py-px text-[11px] font-semibold text-primary">
                          <ShieldCheck className="size-3" /> Admin
                        </span>
                      )}
                      {u.blocked && (
                        <span className="rounded bg-red-500/12 px-1.5 py-px text-[11px] font-semibold text-red-600">Blocked</span>
                      )}
                      {!u.email_confirmed_at && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-px text-[11px] font-semibold text-amber-600">
                          Email not confirmed
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">{u.email}</p>
                    <p className="text-xs text-muted">
                      Last sign-in: {ago(u.last_sign_in_at)} · {u.upcoming_bookings} upcoming booking
                      {u.upcoming_bookings === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                {!me && (
                  <div className="flex flex-wrap gap-1.5 sm:justify-end">
                    {u.role === 'admin' ? (
                      <Button size="sm" variant="ghost" icon={<ShieldOff className="size-4" />} onClick={() => setPending({ kind: 'set_role', user: u, role: 'member' })}>
                        Remove admin
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" icon={<ShieldCheck className="size-4" />} onClick={() => setPending({ kind: 'set_role', user: u, role: 'admin' })}>
                        Make admin
                      </Button>
                    )}
                    {u.blocked ? (
                      <Button size="sm" icon={<Unlock className="size-4" />} onClick={() => setPending({ kind: 'unblock', user: u })}>
                        Unblock
                      </Button>
                    ) : (
                      <Button size="sm" icon={<Ban className="size-4" />} onClick={() => setPending({ kind: 'block', user: u })}>
                        Block
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600"
                      icon={<Trash2 className="size-4" />}
                      onClick={() => setPending({ kind: 'delete', user: u })}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
          {filtered.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">No colleagues found.</li>}
        </ul>
      </div>

      {pending && (
        <Dialog
          open
          onClose={() => setPending(null)}
          title={
            pending.kind === 'delete'
              ? `Delete ${pending.user.full_name}?`
              : pending.kind === 'block'
                ? `Block ${pending.user.full_name}?`
                : pending.kind === 'unblock'
                  ? `Unblock ${pending.user.full_name}?`
                  : pending.role === 'admin'
                    ? `Make ${pending.user.full_name} an admin?`
                    : `Remove admin rights from ${pending.user.full_name}?`
          }
          footer={
            <>
              <Button variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button variant={pending.kind === 'delete' || pending.kind === 'block' ? 'danger' : 'primary'} loading={working} onClick={run}>
                {pending.kind === 'delete'
                  ? 'Delete account'
                  : pending.kind === 'block'
                    ? 'Block'
                    : pending.kind === 'unblock'
                      ? 'Unblock'
                      : 'Confirm'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {pending.kind === 'delete' &&
              `The account and all of ${pending.user.full_name}'s bookings (${pending.user.upcoming_bookings} upcoming) are removed permanently. They can sign up again later with the same email address.`}
            {pending.kind === 'block' &&
              `${pending.user.full_name} is signed out and can no longer sign in. Their existing bookings stay in the calendar. You can unblock them any time.`}
            {pending.kind === 'unblock' && `${pending.user.full_name} will be able to sign in and book rooms again.`}
            {pending.kind === 'set_role' &&
              (pending.role === 'admin'
                ? 'Admins can manage users and rooms and can change, cancel or overrule any booking.'
                : 'They keep their account and bookings, but lose the admin rights.')}
          </p>
        </Dialog>
      )}
    </>
  )
}

function RoomsPanel() {
  const { rooms, loading, reload } = useRooms()
  if (loading) return <Spinner label="Loading rooms…" />
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {rooms.map((room) => (
        <RoomCard key={room.id} room={room} onSaved={reload} />
      ))}
    </div>
  )
}

function RoomCard({ room, onSaved }: { room: Room; onSaved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(room.name)
  const [capacity, setCapacity] = useState(String(room.capacity))
  const [color, setColor] = useState(room.color)
  const [saving, setSaving] = useState(false)
  const dirty = name.trim() !== room.name || Number(capacity) !== room.capacity || color !== room.color
  const valid = name.trim().length > 0 && Number(capacity) >= 1 && Number(capacity) <= 500

  async function save() {
    setSaving(true)
    const { error } = await supabase
      .from('rooms')
      .update({ name: name.trim(), capacity: Number(capacity), color })
      .eq('id', room.id)
    setSaving(false)
    if (error) return toast(friendlyError(error), 'error')
    toast(`${name.trim()} is saved.`)
    onSaved()
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <span className="size-3.5 rounded-full" style={{ background: color }} />
        <h3 className="truncate text-sm font-semibold">{room.name}</h3>
      </div>
      <div className="space-y-3">
        <Field label="Name">
          {(id) => <input id={id} className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Capacity (people)">
          {(id) => (
            <input
              id={id}
              type="number"
              min={1}
              max={500}
              className={inputClass}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          )}
        </Field>
        <Field label="Colour in the calendar">
          {(id) => (
            <input
              id={id}
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-full cursor-pointer rounded-lg border border-line bg-surface p-1"
            />
          )}
        </Field>
        <Button variant="primary" className="w-full" onClick={save} loading={saving} disabled={!dirty || !valid}>
          Save
        </Button>
      </div>
    </div>
  )
}
