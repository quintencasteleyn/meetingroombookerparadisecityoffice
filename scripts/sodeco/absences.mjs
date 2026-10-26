// Turns Sodeco's answer to GET /absences/{startdate} into days off.
//
// The format (Schemas/Absences.json in the Link2Prisma documentation):
//   [ { "WorkerNumber": 1001,
//       "Absences": [ { "Day": "20261019", "Code": 1, "Shift": 1, "Hours": 7.6 }, … ] }, … ]
// Only approved absences are returned, one entry per day and absence code.

/** Up to this many hours on one day counts as half a day off. */
export const HALF_DAY_HOURS = 4.5

/** '20261019' → '2026-10-19' */
export function parseDay(value) {
  const m = String(value ?? '').match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** Worker numbers can be zero-padded on one side ('000123' vs '123'). */
export function workerKey(employer, worker) {
  const clean = (v) => {
    const s = String(v ?? '').trim()
    return /^\d+$/.test(s) ? String(Number(s)) : s.toLowerCase()
  }
  return `${clean(employer)}|${clean(worker)}`
}

/**
 * All days off in Sodeco's answer: [{ worker, date, part }], one per worker and day.
 * include / exclude: absence codes (as text) that should / should never count.
 * Also returns how often each code occurred, to help decide which codes to leave out.
 */
export function parseAbsences(data, { include = [], exclude = [] } = {}) {
  if (!Array.isArray(data)) {
    throw new Error(`Expected a list of workers from Sodeco, got: ${JSON.stringify(data).slice(0, 200)}`)
  }
  const codes = new Map()
  const days = new Map() // worker|date → { worker, date, hours, unknownHours }
  let skipped = 0

  for (const worker of data) {
    if (!worker || worker.WorkerNumber === undefined || !Array.isArray(worker.Absences)) continue
    for (const absence of worker.Absences) {
      const date = parseDay(absence?.Day)
      if (!date) continue
      const code = String(absence.Code ?? '')
      codes.set(code, (codes.get(code) ?? 0) + 1)
      if ((include.length && !include.includes(code)) || exclude.includes(code)) {
        skipped++
        continue
      }
      const key = `${worker.WorkerNumber}|${date}`
      const day = days.get(key) ?? { worker: String(worker.WorkerNumber), date, hours: 0, unknownHours: false }
      const hours = Number(absence.Hours)
      if (Number.isFinite(hours) && hours > 0) day.hours += hours
      else day.unknownHours = true // no hours given: the whole day
      days.set(key, day)
    }
  }

  const entries = [...days.values()].map((d) => ({
    worker: d.worker,
    date: d.date,
    part: !d.unknownHours && d.hours <= HALF_DAY_HOURS ? 'half' : 'full',
  }))
  return { entries, codes, skipped }
}
