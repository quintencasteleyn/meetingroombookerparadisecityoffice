// The weekly "who's off" email.
//
//   * The GitHub Action "Weekly holiday email" calls this every Friday with
//     the CRON_SECRET header ("scheduled"). It sends once per week, about
//     next week, unless an admin switched the email off.
//   * Admins can preview it, send themselves a test, or send it to
//     everyone right away from Admin → Holidays.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, appUrl, getCaller } from '../_shared/supabase.ts'
import { mailFrom, sendMail } from '../_shared/mailer.ts'
import { buildDigest, EXTRA_WEEKS, type Digest } from '../_shared/digest.ts'
import { addDays, mondayOf, type Absence } from '../_shared/holidays.ts'

type Action = 'scheduled' | 'preview' | 'test' | 'send'

// Microsoft allows 500 recipients per message.
const BATCH = 400

interface Settings {
  digest_enabled: boolean
  digest_recipients: string[]
  digest_last_week: string | null
}

function todayInBrussels(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())
}

/** Monday of next week (on a Monday, that is the Monday after). */
function nextMonday(): string {
  return addDays(mondayOf(todayInBrussels()), 7)
}

function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

async function loadSettings(admin: SupabaseClient): Promise<Settings> {
  const { data, error } = await admin
    .from('app_settings')
    .select('digest_enabled, digest_recipients, digest_last_week')
    .single()
  if (error) throw error
  return data as Settings
}

async function compose(admin: SupabaseClient, monday: string): Promise<Digest> {
  const lastDay = addDays(monday, 7 * (EXTRA_WEEKS + 1) - 1)
  const [absences, staff, profiles] = await Promise.all([
    admin
      .from('absences')
      .select('id, person_email, start_date, end_date, day_part, status, source')
      .eq('status', 'approved')
      .lte('start_date', lastDay)
      .gte('end_date', monday),
    admin.from('staff').select('email, full_name').eq('active', true),
    admin.from('profiles').select('email, full_name').eq('blocked', false),
  ])
  if (absences.error) throw absences.error
  if (staff.error) throw staff.error
  if (profiles.error) throw profiles.error

  // Same as in the planner: the name on the account, else the employee list.
  const names = new Map<string, string>()
  for (const s of staff.data ?? []) names.set(s.email, s.full_name)
  for (const p of profiles.data ?? []) names.set(p.email, p.full_name)

  return buildDigest(
    monday,
    (absences.data ?? []) as Absence[],
    (email) => names.get(email) ?? email,
    `${appUrl()}#/holidays`,
  )
}

/** Everyone with an account plus everyone on the employee list, or the admin's own list. */
async function recipients(admin: SupabaseClient, settings: Settings): Promise<{ to: string[]; hidden: boolean }> {
  if (settings.digest_recipients.length) return { to: settings.digest_recipients, hidden: false }
  const [staff, profiles] = await Promise.all([
    admin.from('staff').select('email').eq('active', true),
    admin.from('profiles').select('email').eq('blocked', false),
  ])
  if (staff.error) throw staff.error
  if (profiles.error) throw profiles.error
  const all = new Set<string>()
  for (const row of [...(staff.data ?? []), ...(profiles.data ?? [])]) all.add(row.email.toLowerCase())
  return { to: [...all].sort(), hidden: true }
}

async function deliver(digest: Digest, list: { to: string[]; hidden: boolean }): Promise<number> {
  if (!list.hidden) {
    await sendMail({ to: list.to, subject: digest.subject, html: digest.html })
    return list.to.length
  }
  // The whole company: hidden recipients, so nobody "replies all" to everyone.
  for (let i = 0; i < list.to.length; i += BATCH) {
    await sendMail({ to: [mailFrom()], bcc: list.to.slice(i, i + BATCH), subject: digest.subject, html: digest.html })
  }
  return list.to.length
}

/** Sends to everyone and records it, so the same week is never sent twice by the schedule. */
async function sendToEveryone(admin: SupabaseClient, settings: Settings, monday: string) {
  const previous = settings.digest_last_week
  const { data: claimed, error } = await admin.rpc('claim_digest_week', { p_week: monday, p_previous: previous })
  if (error) throw error
  if (!claimed) return { skipped: 'The email is being sent by another request.' }

  try {
    const digest = await compose(admin, monday)
    const list = await recipients(admin, settings)
    if (list.to.length === 0) throw new Error('There is nobody to send the email to yet.')
    const count = await deliver(digest, list)
    await admin
      .from('app_settings')
      .update({ digest_last_sent_at: new Date().toISOString(), digest_last_sent_count: count })
      .eq('id', true)
    return { sent: count, week: monday }
  } catch (err) {
    // Let the next attempt try again.
    await admin.from('app_settings').update({ digest_last_week: previous }).eq('id', true)
    throw err
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const admin = adminClient()
    const body = (await req.json().catch(() => ({}))) as { action?: Action }
    const monday = nextMonday()

    const secret = Deno.env.get('CRON_SECRET') ?? ''
    const given = req.headers.get('x-cron-secret') ?? ''
    if (given) {
      if (!secret || !sameSecret(given, secret)) return json({ error: 'Wrong CRON_SECRET.' }, 401)
      const settings = await loadSettings(admin)
      if (!settings.digest_enabled) return json({ skipped: 'The weekly email is switched off in Admin → Holidays.' })
      if (settings.digest_last_week === monday) return json({ skipped: `Already sent for the week of ${monday}.` })
      return json(await sendToEveryone(admin, settings, monday))
    }

    const caller = await getCaller(req, admin)
    if (!caller) return json({ error: 'Not signed in' }, 401)
    if (caller.role !== 'admin') return json({ error: 'Only admins can send the weekly email.' }, 403)

    const settings = await loadSettings(admin)
    switch (body.action) {
      case 'preview': {
        const digest = await compose(admin, monday)
        const list = await recipients(admin, settings)
        return json({ subject: digest.subject, html: digest.html, recipients: list.to.length, week: monday })
      }
      case 'test': {
        const digest = await compose(admin, monday)
        await sendMail({ to: [caller.email], subject: `[Test] ${digest.subject}`, html: digest.html })
        return json({ sent: 1, to: caller.email })
      }
      case 'send':
        return json(await sendToEveryone(admin, settings, monday))
      default:
        return json({ error: 'Unknown action.' }, 400)
    }
  } catch (err) {
    console.error(err)
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
