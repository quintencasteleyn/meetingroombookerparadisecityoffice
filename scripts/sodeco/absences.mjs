// Turns Sodeco's absences answer into days off:
//   { employer, worker, start, end, part, status, code }
//
// We could not see Sodeco's absences.json schema while building this, so
// it recognises the usual field names below (any capitals, with or without
// _ or -), and it also finds absences nested inside a worker. If the sync
// stops with "could not find …", the message lists the field names Sodeco
// actually uses: add them to FIELDS and run it again.

export const FIELDS = {
  worker: ['workernumber', 'workernr', 'worker', 'workerid', 'personnelnumber', 'employeenumber', 'employeeid', 'personid'],
  employer: ['employernumber', 'employernr', 'employer', 'employerid'],
  start: ['startdate', 'datefrom', 'fromdate', 'begindate', 'start', 'from'],
  end: ['enddate', 'dateto', 'todate', 'untildate', 'end', 'to', 'until'],
  date: ['date', 'day', 'absencedate'],
  hours: ['hours', 'numberofhours', 'duration'],
  part: ['daypart', 'part', 'period', 'halfday'],
  code: ['absencecode', 'code', 'absencetype', 'type'],
  status: ['status', 'state', 'approvalstatus'],
}

const norm = (key) => key.toLowerCase().replace(/[_\-\s]/g, '')

function pick(obj, names) {
  for (const [key, value] of Object.entries(obj)) {
    if (names.includes(norm(key)) && value !== null && value !== undefined && typeof value !== 'object') return value
  }
  return undefined
}

/** '2026-10-19', '2026-10-19T00:00:00', '19/10/2026', '19-10-2026' or '20261019' → '2026-10-19'. */
export function parseDate(value) {
  if (value === undefined || value === null) return null
  const s = String(value).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{2})[/.-](\d{2})[/.-](\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

/** Worker numbers can be zero-padded on one side ('000123' vs '123'). */
export function workerKey(employer, worker) {
  const clean = (v) => {
    const s = String(v ?? '').trim()
    return /^\d+$/.test(s) ? String(Number(s)) : s.toLowerCase()
  }
  return `${clean(employer)}|${clean(worker)}`
}

function dayPart(obj, halfDayHours) {
  const part = pick(obj, FIELDS.part)
  if (part !== undefined) {
    const p = String(part).toLowerCase()
    if (/^(am|morning|voormiddag|ochtend|matin)/.test(p)) return 'am'
    if (/^(pm|afternoon|namiddag|middag|après|apres)/.test(p)) return 'pm'
    if (/half|halve|demi|true/.test(p)) return 'half'
  }
  const hours = Number(pick(obj, FIELDS.hours))
  if (Number.isFinite(hours) && hours > 0 && hours <= halfDayHours) return 'half'
  return 'full'
}

function statusOf(obj) {
  const value = pick(obj, FIELDS.status)
  if (value === undefined) return 'approved'
  const s = String(value).toLowerCase()
  if (/refus|reject|declin|geweigerd|cancel|annul|deleted/.test(s)) return null // not a day off
  if (/request|pending|aanvraag|aangevraagd|wacht|open|demand/.test(s)) return 'requested'
  return 'approved'
}

/**
 * All absences in Sodeco's answer.
 * Options: include / exclude (lists of absence codes), halfDayHours, employer (when the answer doesn't say).
 */
export function parseAbsences(data, { include = [], exclude = [], halfDayHours = 4.5, employer = '' } = {}) {
  const entries = []
  const skipped = { noWorker: 0, code: 0, cancelled: 0 }
  const seenKeys = new Set()
  let candidates = 0

  function walk(node, context) {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, context)
      return
    }
    if (!node || typeof node !== 'object') return
    for (const key of Object.keys(node)) seenKeys.add(key)

    const here = { ...context }
    const worker = pick(node, FIELDS.worker)
    if (worker !== undefined) here.worker = String(worker)
    const emp = pick(node, FIELDS.employer)
    if (emp !== undefined) here.employer = String(emp)

    const start = parseDate(pick(node, FIELDS.start) ?? pick(node, FIELDS.date))
    if (start) {
      candidates++
      const end = parseDate(pick(node, FIELDS.end)) ?? start
      const code = pick(node, FIELDS.code)
      const status = statusOf(node)
      if (!here.worker) skipped.noWorker++
      else if (status === null) skipped.cancelled++
      else if (code !== undefined && include.length && !include.includes(String(code))) skipped.code++
      else if (code !== undefined && exclude.includes(String(code))) skipped.code++
      else {
        const part = start === end ? dayPart(node, halfDayHours) : 'full'
        entries.push({
          employer: here.employer ?? employer,
          worker: here.worker,
          start: end < start ? end : start,
          end: end < start ? start : end,
          part,
          status,
          code: code === undefined ? null : String(code),
        })
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') walk(value, here)
    }
  }

  walk(data, { employer: employer || undefined })

  if (candidates > 0 && entries.length === 0 && skipped.noWorker === candidates) {
    throw new Error(
      `Found ${candidates} absences but could not find the worker number in them. ` +
        `Field names in Sodeco's answer: ${[...seenKeys].join(', ')}. Add the right one to FIELDS.worker in scripts/sodeco/absences.mjs.`,
    )
  }
  if (candidates === 0 && seenKeys.size > 0) {
    throw new Error(
      `Could not find any dates in Sodeco's answer. Field names in it: ${[...seenKeys].join(', ')}. ` +
        'Add the date fields to FIELDS in scripts/sodeco/absences.mjs.',
    )
  }
  return { entries, skipped }
}
