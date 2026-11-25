// Copies full-time employees' days off from Sodiwe (Link2Prisma) into the
// holiday planner. Runs every night in GitHub Actions ("Sync Sodiwe absences").
//
//   node --openssl-legacy-provider --experimental-strip-types scripts/sodiwe-sync.mjs
//       sync
//   … scripts/sodiwe-sync.mjs --test       only test the connection to Sodiwe (needs no Supabase)
//   … scripts/sodiwe-sync.mjs --dry-run    show what would change, write nothing
//   … scripts/sodiwe-sync.mjs --file answer.json
//                                          use a saved Sodiwe answer instead of calling Sodiwe
//
// (--openssl-legacy-provider: Sodiwe's certificate uses an older encryption
// that Node only opens with this switch.)
//
// It asks Link2Prisma for GET /absences/{startdate} (the approved absences of
// all workers of an employer from that day on), waits for the result, matches
// the worker numbers to the employee list and stores whole periods.
//
// The repository is public, so its GitHub logs are too: this script only ever
// prints counts, never names, email addresses, worker numbers or dates.
// The details go to Admin → Holidays → Sodiwe connection instead.
//
// Settings (GitHub → Settings → Secrets and variables → Actions):
//   SUPABASE_URL                variable: the Supabase Project URL
//   SUPABASE_SERVICE_ROLE_KEY   secret: Supabase "service_role" / secret key
//   SODIWE_CERT_PFX_BASE64      secret: the certificate from Sodiwe (.pfx/.p12), base64-encoded
//   SODIWE_CERT_PASSWORD        secret (optional): the certificate's password, if it has one
//   SODIWE_EMPLOYER             variable: employer number(s) in Prisma, comma-separated
//   SODIWE_BASE_URL             variable (optional): defaults to Sodiwe's Link2Prisma address (docs.sodiwe.be)
//   SODIWE_ABSENCE_CODES        variable (optional): only these absence codes count (comma-separated)
//   SODIWE_EXCLUDE_CODES        variable (optional): these absence codes never count (e.g. sick leave)

import { readFileSync } from 'node:fs'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { createClient, dataOfResult, fetchData } from './sodiwe/client.mjs'
import { parseAbsences, workerKey } from './sodiwe/absences.mjs'
import { addDays, isWorkingDay } from '../supabase/functions/_shared/holidays.ts'

const DAYS_BACK = 31
const DAYS_AHEAD = 400
// From the Link2Prisma manual ("each social secretariat has a separate URI").
// Sodiwe's own Link2Prisma server (confirmed by Sodiwe on 25 November 2026). The
// address in the Link2Prisma manual, link2prisma.sodeco.info, accepts the
// certificate but doesn't know Sodiwe's employers.
const DEFAULT_BASE_URL = 'https://docs.sodiwe.be/link2prisma/link2prisma.svc'

const args = process.argv.slice(2)
const testOnly = args.includes('--test')
const dryRun = args.includes('--dry-run')
const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : null
const env = process.env
const list = (value) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function todayInBrussels() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())
}

function sodiweClient() {
  if (!env.SODIWE_CERT_PFX_BASE64) throw new Error('SODIWE_CERT_PFX_BASE64 is not set yet. See README → "Connect Sodiwe".')
  return createClient({
    baseUrl: env.SODIWE_BASE_URL || DEFAULT_BASE_URL,
    pfx: Buffer.from(env.SODIWE_CERT_PFX_BASE64, 'base64'),
    passphrase: env.SODIWE_CERT_PASSWORD ?? '',
  })
}

/** Asks Sodiwe for every employer's approved absences from `from` on. */
async function fetchFromSodiwe(client, from) {
  const employers = list(env.SODIWE_EMPLOYER)
  if (!employers.length) throw new Error('SODIWE_EMPLOYER is not set yet. See README → "Connect Sodiwe".')
  const answers = []
  for (const [i, employer] of employers.entries()) {
    const data = await fetchData(client, `absences/${from.replaceAll('-', '')}`, employer, {
      log: (line) => console.log(`[employer ${i + 1}] ${line}`),
    })
    answers.push({ employer, data })
  }
  return answers
}

/** A saved answer: the absences list itself, or the whole /Result object. */
function readSavedAnswer(path) {
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  return Array.isArray(saved) ? saved : dataOfResult(saved)
}

/** "1 (120×), 811 (4×)": which absence codes Sodiwe used, to decide which ones to leave out. */
function codeSummary(codes) {
  return (
    [...codes]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([c, n]) => `${c} (${n}×)`)
      .join(', ') || 'none'
  )
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

/**
 * --test: does Sodiwe accept the certificate, and what comes back for the employer?
 * Needs only the certificate (and SODIWE_EMPLOYER for the second part); writes nothing.
 */
async function testConnection() {
  const client = sodiweClient()

  // 1. The certificate: ask the status of a made-up request. A refused certificate gives 403;
  //    another 4xx answer (like "not found") means Sodiwe let us in.
  try {
    const { body } = await client.get('Result/00000000-0000-0000-0000-000000000000')
    console.log(`OK: Sodiwe accepted the certificate (it answered: ${body?.StatusDescription ?? body?.Statuscode ?? 'no details'}).`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/answered 403/.test(message)) throw err // the message already says the certificate was refused
    if (!/answered 4\d\d/.test(message)) throw err // 5xx or a network error: not a real answer
    console.log(`OK: Sodiwe accepted the certificate (${message.split(':')[0].replace('Sodiwe answered', 'it answered')}).`)
  }

  // 2. The absences, as counts only.
  if (!list(env.SODIWE_EMPLOYER).length) {
    console.log('Set the variable SODIWE_EMPLOYER (your employer number in Sodiwe) to also test reading the absences.')
    return
  }
  const from = addDays(todayInBrussels(), -DAYS_BACK)
  const answers = await fetchFromSodiwe(client, from)
  for (const [i, answer] of answers.entries()) {
    const parsed = parseAbsences(answer.data, {})
    const workers = new Set(parsed.entries.map((e) => e.worker)).size
    const half = parsed.entries.filter((e) => e.part === 'half').length
    console.log(
      `OK: employer ${i + 1}: ${plural(parsed.entries.length, 'day off', 'days off')} (${half} half) for ` +
        `${plural(workers, 'employee', 'employees')} from ${from} on. Absence codes: ${codeSummary(parsed.codes)}.`,
    )
  }
}

async function main() {
  if (testOnly) {
    try {
      await testConnection()
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    }
    return
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
  }
  const db = createSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const today = todayInBrussels()
  const from = addDays(today, -DAYS_BACK)
  const to = addDays(today, DAYS_AHEAD)

  // `log` goes to the public GitHub log (counts only); `details` to Admin → Holidays.
  const report = async (ok, log, details = log) => {
    console.log(`${ok ? 'OK' : 'FAILED'}: ${log}`)
    if (dryRun) return
    await db
      .from('app_settings')
      .update({ sodeco_last_sync_at: new Date().toISOString(), sodeco_last_sync_ok: ok, sodeco_last_sync_message: details })
      .eq('id', true)
  }

  try {
    // 1. Who is who: Sodiwe worker number → email, from the employee list.
    const { data: staff, error: staffError } = await db
      .from('staff')
      .select('email, sodeco_worker_id, sodeco_employer')
      .eq('active', true)
      .not('sodeco_worker_id', 'is', null)
    if (staffError) throw staffError
    if (!staff.length) throw new Error('Nobody on the employee list has a Sodiwe number yet (Admin → Holidays).')
    const byWorker = new Map()
    for (const s of staff) {
      byWorker.set(workerKey(s.sodeco_employer ?? '', s.sodeco_worker_id), s.email)
      if (!s.sodeco_employer) byWorker.set(workerKey('*', s.sodeco_worker_id), s.email)
    }

    // 2. Sodiwe's absences (Sodiwe only returns approved ones).
    const answers = file
      ? [{ employer: list(env.SODIWE_EMPLOYER)[0] ?? '', data: readSavedAnswer(file) }]
      : await fetchFromSodiwe(sodiweClient(), from)
    const options = { include: list(env.SODIWE_ABSENCE_CODES), exclude: list(env.SODIWE_EXCLUDE_CODES) }
    const unmatched = new Set()
    const matched = []
    const codes = new Map()
    let skippedCodes = 0
    for (const answer of answers) {
      const parsed = parseAbsences(answer.data, options)
      skippedCodes += parsed.skipped
      for (const [code, count] of parsed.codes) codes.set(code, (codes.get(code) ?? 0) + count)
      for (const e of parsed.entries) {
        const email = byWorker.get(workerKey(answer.employer, e.worker)) ?? byWorker.get(workerKey('*', e.worker))
        if (email) matched.push({ email, start: e.date, end: e.date, part: e.part, status: 'approved' })
        else unmatched.add(e.worker)
      }
    }
    console.log(`Absence codes found: ${codeSummary(codes)}`)

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

    // 4. Sodiwe's rows from today's window that Sodiwe no longer has are removed.
    const { data: existing, error: existingError } = await db
      .from('absences')
      .select('id, external_id, start_date')
      .eq('source', 'sodeco')
      .gte('start_date', from)
    if (existingError) throw existingError
    const keep = new Set(unique.map((r) => r.external_id))
    const stale = existing.filter((r) => !keep.has(r.external_id))

    const people = new Set(unique.map((r) => r.person_email)).size
    let summary = `${plural(unique.length, 'period', 'periods')} of days off for ${plural(people, 'employee', 'employees')}`
    if (stale.length) summary += `, ${stale.length} removed`
    if (skippedCodes) summary += `, ${skippedCodes} skipped because of their absence code`
    summary += '.'
    const log = unmatched.size
      ? `${summary} ${plural(unmatched.size, 'Sodiwe number is', 'Sodiwe numbers are')} not on the employee list (see Admin → Holidays).`
      : summary
    const details = unmatched.size
      ? `${summary} Sodiwe numbers not on the employee list: ${[...unmatched].slice(0, 10).join(', ')}${unmatched.size > 10 ? '…' : ''}.`
      : summary

    if (dryRun) {
      console.log(`Dry run, nothing written. Would add or update ${unique.length} and remove ${stale.length}.`)
      await report(true, log, details)
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
    await report(true, log, details)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await report(false, message).catch(() => {})
    process.exitCode = 1
  }
}

await main()
