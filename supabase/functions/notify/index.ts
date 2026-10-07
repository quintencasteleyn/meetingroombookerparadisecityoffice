// Booking emails:
//   created   → guests get an invitation (+ calendar file)
//   updated   → guests get the new details; if the admin changed someone
//               else's booking, the owner is told as well
//   cancelled → guests are told; if the admin cancelled (or overruled)
//               someone else's booking, the owner is told why
//   cancelled / updated → whoever was on the waiting list for the freed
//               slot and now got the room is told it's confirmed
//
// The website calls this right after it saved a change. The function only
// trusts what is in the database and only for changes the caller just made.

import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, appUrl, getCaller } from '../_shared/supabase.ts'
import { sendMail } from '../_shared/mailer.ts'
import { buildIcs, escapeHtml, formatDate, formatSlot, layout } from '../_shared/email.ts'
import { sendPromotionEmails } from '../_shared/promotions.ts'

type NotifyEvent = 'created' | 'updated' | 'cancelled'

interface Person {
  full_name: string
  email: string
}

interface BookingRow {
  id: string
  user_id: string
  title: string
  guests: string[]
  starts_at: string
  ends_at: string
  series_id: string | null
  status: 'confirmed' | 'waitlist'
  cancelled_at: string | null
  cancelled_by: string | null
  cancel_reason: string | null
  created_at: string
  updated_at: string
  room: { name: string } | null
  owner: Person | null
}

const RECENT_MS = 15 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRecent(iso: string | null): boolean {
  return !!iso && Date.now() - Date.parse(iso) < RECENT_MS
}

function slotLine(b: BookingRow): string {
  return `${formatSlot(b.starts_at, b.ends_at)} · ${b.room?.name ?? 'Room'}`
}

function sequence(b: BookingRow): number {
  return Math.floor(Date.parse(b.updated_at) / 1000) % 2_000_000_000
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    if (!caller) return json({ error: 'Not signed in' }, 401)

    const body = (await req.json()) as { event?: NotifyEvent; bookingIds?: string[] }
    const event = body.event
    const ids = Array.isArray(body.bookingIds) ? body.bookingIds.filter((id) => UUID.test(id)) : []
    if (!event || !['created', 'updated', 'cancelled'].includes(event) || ids.length === 0 || ids.length > 200) {
      return json({ error: 'Invalid request' }, 400)
    }

    const { data, error } = await admin
      .from('bookings')
      .select(
        'id, user_id, title, guests, starts_at, ends_at, series_id, status, cancelled_at, cancelled_by, cancel_reason, created_at, updated_at, room:rooms(name), owner:profiles!bookings_user_id_fkey(full_name, email)',
      )
      .in('id', ids)
      .order('starts_at')
    if (error) throw error
    const bookings = (data ?? []) as unknown as BookingRow[]
    if (bookings.length === 0) return json({ sent: 0 })

    const isAdmin = caller.role === 'admin'
    const allowed = bookings.every((b) => {
      if (event === 'created') return b.user_id === caller.id && !b.cancelled_at && isRecent(b.created_at)
      if (event === 'updated') return (b.user_id === caller.id || isAdmin) && !b.cancelled_at && isRecent(b.updated_at)
      return b.cancelled_by === caller.id && isRecent(b.cancelled_at)
    })
    if (!allowed) return json({ error: 'Not allowed' }, 403)

    const link = appUrl()
    const callerEmail = caller.email.toLowerCase()

    // Collect, per recipient, which bookings they need to hear about.
    const guestMail = new Map<string, BookingRow[]>()
    const ownerMail = new Map<string, BookingRow[]>()
    for (const b of bookings) {
      const ownerEmail = b.owner?.email.toLowerCase()
      // Guests are only invited once a waiting-list request becomes a real booking.
      for (const guest of b.status === 'waitlist' ? [] : b.guests) {
        if (guest === callerEmail || guest === ownerEmail) continue
        guestMail.set(guest, [...(guestMail.get(guest) ?? []), b])
      }
      if (event !== 'created' && ownerEmail && b.user_id !== caller.id) {
        ownerMail.set(ownerEmail, [...(ownerMail.get(ownerEmail) ?? []), b])
      }
    }

    const mails: Parameters<typeof sendMail>[0][] = []

    for (const [to, list] of guestMail) {
      const first = list[0]
      const organizer = first.owner ?? { full_name: caller.full_name, email: caller.email }
      const more = list.length > 1 ? ` (+${list.length - 1} more)` : ''
      const heading =
        event === 'created' ? "You're invited" : event === 'updated' ? 'A meeting was updated' : 'A meeting was cancelled'
      const subject =
        event === 'created'
          ? `Invitation: ${first.title} — ${formatDate(first.starts_at)}${more}`
          : event === 'updated'
            ? `Updated: ${first.title} — ${formatDate(first.starts_at)}${more}`
            : `Cancelled: ${first.title} — ${formatDate(first.starts_at)}${more}`
      const intro =
        event === 'created'
          ? `<strong>${escapeHtml(organizer.full_name)}</strong> booked a meeting room and added you as a guest.`
          : event === 'updated'
            ? `The details of a meeting you're invited to have changed. These are the new details:`
            : `This meeting has been cancelled${first.cancel_reason ? ` (${escapeHtml(first.cancel_reason)})` : ''}.`

      mails.push({
        to: [to],
        subject,
        replyTo: { email: organizer.email, name: organizer.full_name },
        html: layout({
          heading,
          paragraphs: [intro],
          details: [
            ['Topic', first.title],
            ['Room', first.room?.name ?? ''],
            ['Organiser', `${organizer.full_name} (${organizer.email})`],
          ],
          list: list.map(slotLine).slice(0, 30),
          button: { text: 'Open the room calendar', url: link },
          footnote:
            event === 'cancelled'
              ? undefined
              : 'The attached calendar file adds this meeting to your Outlook calendar. Reply to this email to reach the organiser.',
        }),
        attachments:
          event === 'cancelled'
            ? undefined
            : [
                {
                  name: 'meeting.ics',
                  contentType: 'text/calendar',
                  content: buildIcs(
                    list.map((b) => ({
                      uid: b.id,
                      start: b.starts_at,
                      end: b.ends_at,
                      summary: b.title,
                      location: `${b.room?.name ?? 'Meeting room'} · Paradise City office`,
                      description: `Organised by ${organizer.full_name}. Booked via Paradise City Rooms: ${link}`,
                      organizer: { name: organizer.full_name, email: organizer.email },
                      sequence: sequence(b),
                    })),
                  ),
                },
              ],
      })
    }

    for (const [to, list] of ownerMail) {
      const first = list[0]
      const firstName = first.owner?.full_name.split(' ')[0] ?? ''
      const cancelled = event === 'cancelled'
      mails.push({
        to: [to],
        subject: cancelled
          ? `Your room booking was cancelled by the admin: ${first.title}`
          : `The admin changed your room booking: ${first.title}`,
        replyTo: { email: caller.email, name: caller.full_name },
        html: layout({
          heading: cancelled ? 'Your booking was cancelled' : 'Your booking was changed',
          paragraphs: [
            `Hi ${escapeHtml(firstName)},`,
            cancelled
              ? `<strong>${escapeHtml(caller.full_name)}</strong> (admin) cancelled your booking${
                  first.cancel_reason ? `: ${escapeHtml(first.cancel_reason)}` : '.'
                }`
              : `<strong>${escapeHtml(caller.full_name)}</strong> (admin) changed your booking. These are the new details:`,
          ],
          details: [
            ['Topic', first.title],
            ['Room', first.room?.name ?? ''],
          ],
          list: list.map(slotLine).slice(0, 30),
          button: { text: cancelled ? 'Find another slot' : 'Open the room calendar', url: link },
          footnote: `Questions? Reply to this email to reach ${escapeHtml(caller.full_name)}.`,
        }),
      })
    }

    const results = await Promise.allSettled(mails.map((m) => sendMail(m)))
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    failed.forEach((f) => console.error(f.reason))
    const promoted = event === 'created' ? 0 : await sendPromotionEmails(admin, link)
    return json(
      { sent: results.length - failed.length + promoted, failed: failed.length },
      failed.length ? 502 : 200,
    )
  } catch (err) {
    console.error(err)
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
