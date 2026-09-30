import { useMemo, useState } from 'react'
import { ArrowLeftRight, CalendarClock, Mail, MapPin, Pencil, Repeat, Trash2, User, Users } from 'lucide-react'
import { Alert, Avatar, Button, Dialog } from './ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { friendlyError, notifyBookings, supabase } from '../lib/supabase'
import type { Booking, Colleague, Room } from '../lib/types'
import { fmtLongDay, fmtRange, fromIso, nowInBrussels } from '../lib/time'
import { frequencyLabel } from '../lib/recurrence'
import { askForSlotLink, askToSwitchRoomLink, contactOwnerLink } from '../lib/mailto'

interface Props {
  booking: Booking
  rooms: Room[]
  colleagues: Colleague[]
  /** Bookings loaded for the visible week, used to find free rooms. */
  weekBookings: Booking[]
  onClose: () => void
  onEdit: () => void
  onChanged: () => void
}

export default function BookingDetails({ booking, rooms, colleagues, weekBookings, onClose, onEdit, onChanged }: Props) {
  const { profile, isAdmin } = useAuth()
  const [cancelling, setCancelling] = useState(false)
  const room = rooms.find((r) => r.id === booking.room_id)
  const start = fromIso(booking.starts_at)
  const end = fromIso(booking.ends_at)
  const mine = booking.user_id === profile?.id
  const ended = end <= nowInBrussels()
  const canManage = (mine || isAdmin) && !ended
  const ownerFirst = booking.owner?.full_name.split(' ')[0] ?? 'the organiser'
  const nameOf = new Map(colleagues.map((c) => [c.email.toLowerCase(), c.full_name]))

  const freeRooms = useMemo(() => {
    const from = fromIso(booking.starts_at)
    const to = fromIso(booking.ends_at)
    return rooms.filter(
      (r) =>
        r.id !== booking.room_id &&
        !weekBookings.some((b) => b.room_id === r.id && fromIso(b.starts_at) < to && fromIso(b.ends_at) > from),
    )
  }, [rooms, weekBookings, booking.room_id, booking.starts_at, booking.ends_at])

  return (
    <>
      <Dialog
        open={!cancelling}
        onClose={onClose}
        title={
          <span className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-full" style={{ background: room?.color }} />
            {booking.title}
          </span>
        }
        footer={
          canManage ? (
            <>
              <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setCancelling(true)} className="mr-auto text-red-600">
                Cancel booking
              </Button>
              <Button variant="primary" icon={<Pencil className="size-4" />} onClick={onEdit}>
                Edit
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )
        }
      >
        <dl className="space-y-3 text-sm">
          <div className="flex gap-3">
            <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" />
            <div>
              <dt className="sr-only">When</dt>
              <dd className="font-medium">{fmtLongDay(start)}</dd>
              <dd className="text-muted">{fmtRange(booking.starts_at, booking.ends_at)}</dd>
            </div>
          </div>
          <div className="flex gap-3">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted" />
            <div>
              <dt className="sr-only">Room</dt>
              <dd className="font-medium">{room?.name}</dd>
              <dd className="text-muted">Up to {room?.capacity} people</dd>
            </div>
          </div>
          {booking.recurrence && (
            <div className="flex gap-3">
              <Repeat className="mt-0.5 size-4 shrink-0 text-muted" />
              <dd>
                {frequencyLabel(booking.recurrence.freq, start)}, until{' '}
                {fromIso(booking.recurrence.until).toFormat('d LLL yyyy')}
              </dd>
            </div>
          )}
          <div className="flex gap-3">
            <User className="mt-0.5 size-4 shrink-0 text-muted" />
            <div className="flex min-w-0 items-center gap-2">
              <Avatar name={booking.owner?.full_name ?? '?'} size={26} />
              <div className="min-w-0">
                <dd className="font-medium">{mine ? `${booking.owner?.full_name} (you)` : booking.owner?.full_name}</dd>
                <dd className="truncate text-muted">{booking.owner?.email}</dd>
              </div>
            </div>
          </div>
          {booking.guests.length > 0 && (
            <div className="flex gap-3">
              <Users className="mt-0.5 size-4 shrink-0 text-muted" />
              <div className="min-w-0">
                <dt className="text-muted">Guests</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {booking.guests.map((g) => (
                    <span key={g} title={g} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs">
                      {nameOf.get(g) ?? g}
                    </span>
                  ))}
                </dd>
              </div>
            </div>
          )}
        </dl>

        {!mine && !ended && profile && (
          <div className="mt-5 rounded-xl border border-line bg-surface-2/60 p-3">
            <p className="mb-2 text-[13px] font-medium">Need this room?</p>
            <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
              <a
                href={askToSwitchRoomLink(booking, room, freeRooms, profile.full_name)}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium hover:border-primary hover:text-primary"
              >
                <ArrowLeftRight className="size-4" />
                Ask {ownerFirst} to switch rooms
              </a>
              <a
                href={askForSlotLink(booking, room, profile.full_name)}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium hover:border-primary hover:text-primary"
              >
                <Mail className="size-4" />
                Ask for this slot
              </a>
              <a
                href={contactOwnerLink(booking, room, profile.full_name)}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted hover:text-fg"
              >
                Email {ownerFirst}
              </a>
            </div>
            <p className="mt-2 text-xs text-muted">
              {freeRooms.length
                ? `Free at this time: ${freeRooms.map((r) => r.name).join(', ')}. The email suggests this.`
                : 'No other room is free at this time.'}{' '}
              Opens your own email app with a ready-to-send message.
            </p>
          </div>
        )}

        {isAdmin && !mine && !ended && (
          <p className="mt-3 text-xs text-muted">As admin you can edit or cancel this booking; {ownerFirst} gets an email.</p>
        )}
      </Dialog>

      {cancelling && (
        <CancelDialog
          booking={booking}
          onClose={() => setCancelling(false)}
          onDone={() => {
            onChanged()
            onClose()
          }}
        />
      )}
    </>
  )
}

function CancelDialog({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: () => void }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [scope, setScope] = useState<'single' | 'following'>('single')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const othersBooking = booking.user_id !== profile?.id

  async function confirm() {
    setSaving(true)
    setError(null)
    const values = { cancelled_at: new Date().toISOString(), cancel_reason: reason.trim() || null }
    const query =
      scope === 'following' && booking.series_id
        ? supabase
            .from('bookings')
            .update(values)
            .eq('series_id', booking.series_id)
            .gte('starts_at', booking.starts_at)
            .is('cancelled_at', null)
        : supabase.from('bookings').update(values).eq('id', booking.id)
    const { data, error: err } = await query.select('id')
    setSaving(false)
    if (err) {
      setError(friendlyError(err))
      return
    }
    const ids = (data ?? []).map((r: { id: string }) => r.id)
    toast(ids.length > 1 ? `${ids.length} bookings cancelled.` : 'Booking cancelled.')
    if (booking.guests.length || othersBooking) void notifyBookings('cancelled', ids)
    onDone()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Cancel this booking?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" loading={saving} onClick={confirm}>
            Cancel booking
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p>
          <span className="font-medium">{booking.title}</span> · {fmtLongDay(fromIso(booking.starts_at))},{' '}
          {fmtRange(booking.starts_at, booking.ends_at)}
        </p>
        {booking.series_id && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2">
              <input type="radio" checked={scope === 'single'} onChange={() => setScope('single')} className="accent-[var(--primary)]" />
              Only this date
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={scope === 'following'} onChange={() => setScope('following')} className="accent-[var(--primary)]" />
              This and all following dates in the series
            </label>
          </div>
        )}
        {othersBooking && (
          <div>
            <label className="mb-1.5 block text-[13px] font-medium" htmlFor="cancel-reason">
              Reason (sent to {booking.owner?.full_name})
            </label>
            <textarea
              id="cancel-reason"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Room needed for a client visit"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/20"
            />
          </div>
        )}
        {booking.guests.length > 0 && (
          <p className="text-muted">The {booking.guests.length} guest(s) will get an email that the meeting is cancelled.</p>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Dialog>
  )
}
