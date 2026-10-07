// Waiting list: when a booking is cancelled or moved, the database gives
// the slot to the first person waiting (status → confirmed, promoted_at).
// This tells those people by email, once, and only them.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sendMail } from './mailer.ts'
import { buildIcs, escapeHtml, formatDate, formatSlot, layout } from './email.ts'

interface PromotedRow {
  id: string
  title: string
  starts_at: string
  ends_at: string
  updated_at: string
  room: { name: string } | null
  owner: { full_name: string; email: string } | null
}

const RECENT_MS = 15 * 60_000

export async function sendPromotionEmails(admin: SupabaseClient, link: string): Promise<number> {
  const since = new Date(Date.now() - RECENT_MS).toISOString()
  const { data, error } = await admin
    .from('bookings')
    .select('id, title, starts_at, ends_at, updated_at, room:rooms(name), owner:profiles!bookings_user_id_fkey(full_name, email)')
    .eq('status', 'confirmed')
    .is('cancelled_at', null)
    .is('promotion_notified_at', null)
    .gte('promoted_at', since)
    .order('starts_at')
  if (error) throw error

  // Claim each row first, so two calls at the same time never email twice.
  const byOwner = new Map<string, PromotedRow[]>()
  for (const row of (data ?? []) as unknown as PromotedRow[]) {
    if (!row.owner) continue
    const { data: claimed } = await admin
      .from('bookings')
      .update({ promotion_notified_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('promotion_notified_at', null)
      .select('id')
    if (!claimed?.length) continue
    byOwner.set(row.owner.email, [...(byOwner.get(row.owner.email) ?? []), row])
  }

  let sent = 0
  for (const [to, list] of byOwner) {
    const first = list[0]
    const owner = first.owner!
    const more = list.length > 1 ? ` (+${list.length - 1} more)` : ''
    try {
      await sendMail({
        to: [to],
        subject: `Confirmed: ${first.room?.name ?? 'your room'} is yours — ${formatDate(first.starts_at)}${more}`,
        html: layout({
          heading: 'Your waiting-list booking is confirmed',
          paragraphs: [
            `Hi ${escapeHtml(owner.full_name.split(' ')[0])},`,
            'The booking that was in the way has been cancelled, so the room is now yours.',
          ],
          details: [
            ['Topic', first.title],
            ['Room', first.room?.name ?? ''],
          ],
          list: list.map((b) => `${formatSlot(b.starts_at, b.ends_at)} · ${b.room?.name ?? ''}`).slice(0, 30),
          button: { text: 'Open the room calendar', url: link },
          footnote: 'The attached calendar file adds this meeting to your Outlook calendar.',
        }),
        attachments: [
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
                description: `Booked via Paradise City Rooms: ${link}`,
                organizer: { name: owner.full_name, email: owner.email },
                sequence: Math.floor(Date.parse(b.updated_at) / 1000) % 2_000_000_000,
              })),
            ),
          },
        ],
      })
      sent++
    } catch (err) {
      console.error(err)
      // Let a later call try again.
      await admin
        .from('bookings')
        .update({ promotion_notified_at: null })
        .in('id', list.map((b) => b.id))
    }
  }
  return sent
}
