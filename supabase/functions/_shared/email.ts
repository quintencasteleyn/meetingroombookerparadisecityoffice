// Email layout, Brussels-time formatting and calendar (.ics) files.

export const APP_NAME = 'Paradise City Rooms'
const TZ = 'Europe/Brussels'

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso))
}

export function formatSlot(startIso: string, endIso: string): string {
  return `${formatDate(startIso)} · ${timeFmt.format(new Date(startIso))}–${timeFmt.format(new Date(endIso))}`
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export interface LayoutOptions {
  heading: string
  /** Already-escaped HTML paragraphs. */
  paragraphs: string[]
  /** Label/value pairs shown in a details box (values are escaped here). */
  details?: [string, string][]
  /** Optional list of dates (escaped here). */
  list?: string[]
  button?: { text: string; url: string }
  footnote?: string
}

export function layout(o: LayoutOptions): string {
  const details = o.details?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">
        ${o.details
          .map(
            ([label, value]) => `<tr>
              <td style="padding:8px 14px;color:#64748b;font-size:13px;width:110px;vertical-align:top">${escapeHtml(label)}</td>
              <td style="padding:8px 14px;color:#0f172a;font-size:14px;font-weight:600">${escapeHtml(value)}</td>
            </tr>`,
          )
          .join('')}
      </table>`
    : ''
  const list = o.list?.length
    ? `<ul style="margin:8px 0 16px;padding-left:20px;color:#0f172a;font-size:14px;line-height:1.7">${o.list
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('')}</ul>`
    : ''
  const button = o.button
    ? `<p style="margin:24px 0 8px"><a href="${escapeHtml(o.button.url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${escapeHtml(o.button.text)}</a></p>`
    : ''
  const footnote = o.footnote
    ? `<p style="margin:16px 0 0;color:#64748b;font-size:13px;line-height:1.5">${o.footnote}</p>`
    : ''

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:#2563eb;padding:16px 24px;color:#ffffff;font-size:16px;font-weight:700">${APP_NAME}</td></tr>
        <tr><td style="padding:24px">
          <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a">${escapeHtml(o.heading)}</h1>
          ${o.paragraphs.map((p) => `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.55">${p}</p>`).join('')}
          ${details}${list}${button}${footnote}
        </td></tr>
      </table>
      <p style="color:#94a3b8;font-size:12px;margin:16px 0 0">Sent by ${APP_NAME} · Paradise City office</p>
    </td></tr>
  </table>
</body></html>`
}

// ---------------------------------------------------------------------
// Calendar file (.ics) so guests can add the meeting to Outlook.
// ---------------------------------------------------------------------

export interface IcsEvent {
  uid: string
  start: string
  end: string
  summary: string
  location: string
  description: string
  organizer?: { name: string; email: string }
  sequence: number
}

function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function icsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Lines longer than 75 octets must be folded (RFC 5545). */
function fold(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let current = ''
  for (const char of line) {
    if (encoder.encode(current + char).length > (parts.length ? 74 : 75)) {
      parts.push(current)
      current = char
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts.join('\r\n ')
}

export function buildIcs(events: IcsEvent[]): string {
  const now = icsDate(new Date().toISOString())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Paradise City//Rooms//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@paradisecity-rooms`,
      `SEQUENCE:${e.sequence}`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${icsText(e.summary)}`,
      `LOCATION:${icsText(e.location)}`,
      `DESCRIPTION:${icsText(e.description)}`,
    )
    if (e.organizer) lines.push(`ORGANIZER;CN=${icsText(e.organizer.name)}:mailto:${e.organizer.email}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
