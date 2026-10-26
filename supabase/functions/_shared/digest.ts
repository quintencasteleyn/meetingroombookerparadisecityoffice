// Content of the weekly "who's off" email: next week in detail (full
// week or the exact days) plus an overview of the weeks after.

import { escapeHtml, layout } from './email.ts'
import { addDays, dayLabel, describeWeek, rangeLabel, summarizeWeek, type Absence, type WeekSummary } from './holidays.ts'

/** Weeks shown after "next week". */
export const EXTRA_WEEKS = 4

export interface Digest {
  subject: string
  html: string
  weeks: WeekSummary[]
}

const FONT = 'font-family:Segoe UI,Helvetica,Arial,sans-serif'

function weekTable(week: WeekSummary, emptyText: string): string {
  const cell = 'padding:7px 12px;font-size:14px;vertical-align:top;'
  const rows: string[] = week.people.map(
    (p) => `<td style="${cell}color:#0f172a;font-weight:600;width:45%">${escapeHtml(p.name)}</td>
      <td style="${cell}${p.fullWeek ? 'color:#1d4ed8;font-weight:600' : 'color:#334155'}">${escapeHtml(
        describeWeek(p, week.workingDays),
      )}</td>`,
  )
  if (rows.length === 0) rows.push(`<td colspan="2" style="${cell}color:#64748b">${escapeHtml(emptyText)}</td>`)
  for (const h of week.holidays) {
    rows.push(
      `<td colspan="2" style="${cell}color:#be123c;font-size:13px">${escapeHtml(
        `${dayLabel(h.date)}: ${h.name} (public holiday)`,
      )}</td>`,
    )
  }
  // A divider above every row but the first.
  const body = rows
    .map((cells, i) => `<tr>${i === 0 ? cells : cells.replace(/<td([^>]*) style="/g, '<td$1 style="border-top:1px solid #e2e8f0;')}</tr>`)
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate;${FONT}">${body}</table>`
}

function weekHeading(title: string, week: WeekSummary): string {
  return `<p style="margin:22px 0 8px;font-size:15px;font-weight:700;color:#0f172a;${FONT}">${escapeHtml(title)}
    <span style="font-weight:400;color:#64748b"> · ${escapeHtml(rangeLabel(week.monday, addDays(week.monday, 4)))}</span></p>`
}

export function buildDigest(
  firstMonday: string,
  absences: Absence[],
  nameOf: (email: string) => string,
  link: string,
): Digest {
  const weeks = Array.from({ length: EXTRA_WEEKS + 1 }, (_, i) =>
    summarizeWeek(addDays(firstMonday, 7 * i), absences, nameOf),
  )
  const [next, ...later] = weeks
  const nextRange = rangeLabel(next.monday, addDays(next.monday, 4))
  const count = next.people.length

  const sections = [
    weekHeading('Next week', next),
    weekTable(next, 'Everyone is in next week.'),
    `<p style="margin:28px 0 0;font-size:16px;font-weight:700;color:#0f172a;${FONT}">The ${EXTRA_WEEKS} weeks after</p>`,
    ...later.map((week) => weekHeading(`Week of ${dayLabel(week.monday)}`, week) + weekTable(week, 'Nobody is off.')),
  ].join('')

  return {
    subject: `Who's off next week · ${nextRange}`,
    weeks,
    html: layout({
      heading: "Who's off next week",
      paragraphs: [
        count === 0
          ? 'Everyone is in next week.'
          : `${count} ${count === 1 ? 'colleague is' : 'colleagues are'} off next week (all or part of it). Below that, who has days off planned in the ${EXTRA_WEEKS} weeks after.`,
      ],
      sections,
      button: { text: 'Open the holiday planner', url: link },
      footnote:
        "Full-time employees' days off come from Sodiwe. Freelancers add their own in the holiday planner. Something not right? Let one of the admins know.",
    }),
  }
}
