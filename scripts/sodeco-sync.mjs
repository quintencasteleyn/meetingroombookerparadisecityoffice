// Copies full-time employees' days off from Sodeco (Link2Prisma) into the
// holiday planner. Runs every night in GitHub Actions ("Sync Sodeco absences").
//
//   node --experimental-strip-types scripts/sodeco-sync.mjs              sync
//   node --experimental-strip-types scripts/sodeco-sync.mjs --dry-run    show what would change, write nothing
//   node --experimental-strip-types scripts/sodeco-sync.mjs --file answer.json
//                                         use a saved Sodeco answer instead of calling Sodeco
//
// Settings (GitHub → Settings → Secrets and variables → Actions):
//   SUPABASE_URL                variable: the Supabase Project URL
//   SUPABASE_SERVICE_ROLE_KEY   secret: Supabase "service_role" / secret key
//   SODECO_CERT_PFX_BASE64      secret: the certificate from Sodeco (.pfx/.p12), base64-encoded
//   SODECO_CERT_PASSWORD        secret: the certificate's password
//   SODECO_BASE_URL             variable: the Link2Prisma address from the documentation
//   SODECO_EMPLOYER             variable: employer number(s) in Prisma, comma-separated
//   SODECO_ABSENCES_PATH        variable (optional): the absences request, with {employer}, {from}, {to}
//   SODECO_TICKET_PATH          variable (optional): where to fetch a queued result, with {ticket}
//   SODECO_HEADERS              variable (optional): extra headers as JSON, with {employer}
//   SODECO_ABSENCE_CODES        variable (optional): only these absence codes count (comma-separated)
//   SODECO_EXCLUDE_CODES        variable (optional): these absence codes never count (e.g. sick leave)

import { readFileSync } from 'node:fs'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { createClient, ticketOf, waitForTicket } from './sodeco/client.mjs'
import { parseAbsences, workerKey } from './sodeco/absences.mjs'
import { addDays, isWorkingDay } from '../supabase/functions/_shared/holidays.ts'

const DAYS_BACK = 31
const DAYS_AHEAD = 400
const DEFAULT_ABSENCES_PATH = 'absences?employer={employer}&from={from}&to={to}'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : null
const env = process.env
const list = (value) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)

function todayInBrussels() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())
}

function fill(template, values, encode = encodeURIComponent) {
  return template.replace(/\{(\w+)\}/g, (_, key) => encode(values[key] ?? ''))
}

/** Asks Sodeco for every employer's absences in [from, to]. */
async function fetchFromSodeco(from, to) {
  for (const name of ['SODECO_BASE_URL', 'SODECO_CERT_PFX_BASE64', 'SODECO_CERT_PASSWORD']) {
    if (!env[name]) throw new Error(`${name} is not set yet. See README → "Connect Sodeco".`)
  }
  const employers = list(env.SODECO_EMPLOYER)
  const answers = []
  for (const employer of employers.length ? employers : ['']) {
    const headers = env.SODECO_HEADERS ? JSON.parse(fill(env.SODECO_HEADERS, { employer }, String)) : {}
    const client = createClient({
      baseUrl: env.SODECO_BASE_URL,
      pfx: Buffer.from(env.SODECO_CERT_PFX_BASE64, 'base64'),
      passphrase: env.SODECO_CERT_PASSWORD,
      headers,
    })
    let response = await client.get(fill(env.SODECO_ABSENCES_PATH || DEFAULT_ABSENCES_PATH, { employer, from, to }))
    const ticket = ticketOf(response)
    if (ticket) response = await waitForTicket(client, env.SODECO_TICKET_PATH, ticket)
    answers.push({ employer, data: response.body })
  }
  return answers
}

/** Joins single days into periods: Fri + Mon becomes Fri–Mon, also across public holidays. */
function mergeDays(entries) {
  const groups = new Map()
  for (const e of entries) {
    const key = `${e.email}|${e.part}|${e.status}`
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const merged = []
  for (const group of groups.values()) {
    group.sort((a, b) => a.start.localeCompare(b.start))
    let current = null
    for (const e of group) {
      const touching =
        current &&
        e.part === 'full' &&
        (() => {
          for (let d = addDays(current.end, 1); d < e.start; d = addDays(d, 1)) if (isWorkingDay(d)) return false
          return e.start <= addDays(current.end, 7) // never bridge more than a week of non-working days
        })()
      if (touching) {
        if (e.end > current.end) current.end = e.end
      } else {
        current = { ...e }
        merged.push(current)
      }
    }
  }
  return merged
}

async function main() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
  }
  const db = createSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const today = todayInBrussels()
  const from = addDays(today, -DAYS_BACK)
  const to = addDays(today, DAYS_AHEAD)

  const report = async (ok, message) => {
    console.log(`${ok ? 'OK' : 'FAILED'}: ${message}`)
    if (dryRun) return
    await db
      .from('app_settings')
      .update({ sodeco_last_sync_at: new Date().toISOString(), sodeco_last_sync_ok: ok, sodeco_last_sync_message: message })
      .eq('id', true)
  }

  try {
    // 1. Who is who: Sodeco worker number → email, from the employee list.
    const { data: staff, error: staffError } = await db
      .from('staff')
      .select('email, sodeco_worker_id, sodeco_employer')
      .eq('active', true)
      .not('sodeco_worker_id', 'is', null)
    if (staffError) throw staffError
    if (!staff.length) throw new Error('Nobody on the employee list has a Sodeco number yet (Admin → Holidays).')
    const byWorker = new Map()
    for (const s of staff) {
      byWorker.set(workerKey(s.sodeco_employer ?? '', s.sodeco_worker_id), s.email)
      if (!s.sodeco_employer) byWorker.set(workerKey('*', s.sodeco_worker_id), s.email)
    }

    // 2. Sodeco's absences.
    const answers = file ? [{ employer: list(env.SODECO_EMPLOYER)[0] ?? '', data: JSON.parse(readFileSync(file, 'utf8')) }] : await fetchFromSodeco(from, to)
    const options = { include: list(env.SODECO_ABSENCE_CODES), exclude: list(env.SODECO_EXCLUDE_CODES) }
    const unmatched = new Set()
    const matched = []
    let skippedCodes = 0
    for (const answer of answers) {
      const { entries, skipped } = parseAbsences(answer.data, { ...options, employer: answer.employer })
      skippedCodes += skipped.code
      for (const e of entries) {
        const email = byWorker.get(workerKey(e.employer ?? '', e.worker)) ?? byWorker.get(workerKey('*', e.worker))
        if (email) matched.push({ ...e, email })
        else unmatched.add(e.worker)
      }
    }

    // 3. Turn them into planner rows (whole periods, inside the sync window).
    const rows = mergeDays(matched)
      .filter((e) => e.end >= from && e.start <= to)
      .map((e) => ({
        person_email: e.email,
        start_date: e.start,
        end_date: e.end,
        day_part: e.start === e.end ? e.part : 'full',
        status: e.status,
        source: 'sodeco',
        external_id: `${e.email}|${e.start}|${e.part}|${e.status}`,
      }))
    const unique = [...new Map(rows.map((r) => [r.external_id, r])).values()]

    // 4. Sodeco's rows from today's window that Sodeco no longer has are removed.
    const { data: existing, error: existingError } = await db
      .from('absences')
      .select('id, external_id, start_date')
      .eq('source', 'sodeco')
      .gte('start_date', from)
    if (existingError) throw existingError
    const keep = new Set(unique.map((r) => r.external_id))
    const stale = existing.filter((r) => !keep.has(r.external_id))

    const people = new Set(unique.map((r) => r.person_email)).size
    const days = unique.length
    let message = `${days} periods of days off for ${people} ${people === 1 ? 'employee' : 'employees'}`
    if (stale.length) message += `, ${stale.length} removed`
    if (skippedCodes) message += `, ${skippedCodes} skipped because of their absence code`
    message += '.'
    if (unmatched.size) {
      message += ` Sodeco numbers not on the employee list: ${[...unmatched].slice(0, 10).join(', ')}${unmatched.size > 10 ? '…' : ''}.`
    }

    if (dryRun) {
      console.log('Dry run, nothing written. First rows:')
      console.table(unique.slice(0, 25).map(({ person_email, start_date, end_date, day_part, status }) => ({ person_email, start_date, end_date, day_part, status })))
      if (stale.length) console.log(`Would remove ${stale.length} rows that Sodeco no longer has.`)
      await report(true, message)
      return
    }

    for (let i = 0; i < unique.length; i += 500) {
      const { error } = await db.from('absences').upsert(unique.slice(i, i + 500), { onConflict: 'source,external_id' })
      if (error) throw error
    }
    for (let i = 0; i < stale.length; i += 200) {
      const { error } = await db.from('absences').delete().in('id', stale.slice(i, i + 200).map((r) => r.id))
      if (error) throw error
    }
    await report(true, message)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await report(false, message).catch(() => {})
    process.exitCode = 1
  }
}

await main()
