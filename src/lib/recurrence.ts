import type { DateTime } from 'luxon'
import type { Frequency } from './types'
import { atTime, isWeekend } from './time'

export interface Occurrence {
  start: DateTime
  end: DateTime
}

const MAX_OCCURRENCES = 200

export function frequencyLabel(freq: Frequency, first: DateTime): string {
  switch (freq) {
    case 'none':
      return 'Does not repeat'
    case 'daily':
      return 'Every day'
    case 'weekdays':
      return 'Every weekday (Mon–Fri)'
    case 'weekly':
      return `Weekly on ${first.toFormat('cccc')}`
    case 'biweekly':
      return `Every 2 weeks on ${first.toFormat('cccc')}`
    case 'monthly':
      return `Monthly on day ${first.day}`
  }
}

/**
 * All dates of a (recurring) booking, from `date` up to and including `until`.
 * Times are set per date, so daylight-saving changes are handled correctly.
 */
export function buildOccurrences(
  date: DateTime,
  startTime: string,
  endTime: string,
  freq: Frequency,
  until: DateTime | null,
): Occurrence[] {
  const make = (day: DateTime): Occurrence => ({ start: atTime(day, startTime), end: atTime(day, endTime) })
  const first = date.startOf('day')
  if (freq === 'none' || !until) return [make(first)]

  const last = until.startOf('day')
  const days: DateTime[] = []
  for (let i = 0; days.length < MAX_OCCURRENCES; i++) {
    let day: DateTime
    switch (freq) {
      case 'daily':
      case 'weekdays':
        day = first.plus({ days: i })
        break
      case 'weekly':
        day = first.plus({ weeks: i })
        break
      case 'biweekly':
        day = first.plus({ weeks: i * 2 })
        break
      case 'monthly':
        day = first.plus({ months: i })
        break
    }
    if (day > last) break
    // Rooms are only bookable on weekdays, so weekend dates are left out.
    if (isWeekend(day)) continue
    // Skip months that don't have this day (e.g. the 31st).
    if (freq === 'monthly' && day.day !== first.day) continue
    days.push(day)
  }
  return days.map(make)
}
