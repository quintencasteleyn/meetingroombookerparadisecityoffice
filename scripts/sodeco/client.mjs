// Talks to Sodeco's Link2Prisma API. Link2Prisma only accepts HTTPS calls
// signed with the client certificate Sodeco creates for us (a .pfx/.p12
// file with a password). We only read (GET); we never send changes.
//
// Some Link2Prisma requests are queued: the answer is then a ticket, and the
// result is fetched later with that ticket. That case is handled by
// waitForTicket() below.

import https from 'node:https'

const TIMEOUT_MS = 60_000

function explain(err) {
  const hint = /mac verify|pkcs12|unsupported|bad decrypt|asn1|wrong tag/i.test(err.message)
    ? ' Is SODECO_CERT_PASSWORD right, and is SODECO_CERT_PFX_BASE64 the whole .pfx file in base64?'
    : ''
  return new Error(`Could not reach Sodeco: ${err.message}.${hint}`)
}

export function createClient({ baseUrl, pfx, passphrase, headers = {} }) {
  if (!baseUrl) throw new Error('SODECO_BASE_URL is not set.')
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`

  /** GET a path (relative to the base URL) and return { status, body }. */
  function get(path) {
    const url = new URL(path.replace(/^\//, ''), base)
    return new Promise((resolve, reject) => {
      const onResponse = (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode >= 400) {
            reject(new Error(`Sodeco answered ${res.statusCode} for ${url.pathname}: ${text.slice(0, 300)}`))
            return
          }
          let body = text
          try {
            body = text ? JSON.parse(text) : null
          } catch {
            // not JSON: return the text as is
          }
          resolve({ status: res.statusCode, body })
        })
      }
      const options = {
        method: 'GET',
        pfx,
        passphrase,
        timeout: TIMEOUT_MS,
        headers: { Accept: 'application/json', ...headers },
      }
      let req
      try {
        req = https.request(url, options, onResponse)
      } catch (err) {
        // A wrong certificate password fails right here, before anything is sent.
        reject(explain(err))
        return
      }
      req.on('timeout', () => req.destroy(new Error(`Sodeco did not answer within ${TIMEOUT_MS / 1000} seconds`)))
      req.on('error', (err) => reject(explain(err)))
      req.end()
    })
  }

  return { get }
}

/** The ticket number when Sodeco queued the request instead of answering it, else null. */
export function ticketOf(response) {
  const body = response.body
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const key of Object.keys(body)) {
      if (/^ticket(id|number)?$/i.test(key) && body[key]) return String(body[key])
    }
  }
  if (response.status === 202 && typeof body === 'string' && body.trim()) return body.trim()
  return null
}

/** Polls the ticket path (SODECO_TICKET_PATH, with {ticket}) until the result is ready. */
export async function waitForTicket(client, ticketPath, ticket, { tries = 60, delayMs = 5000 } = {}) {
  if (!ticketPath) {
    throw new Error(
      `Sodeco queued the request (ticket ${ticket}). Set SODECO_TICKET_PATH (see the Link2Prisma documentation) so the sync can fetch the result.`,
    )
  }
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, delayMs))
    const response = await client.get(ticketPath.replaceAll('{ticket}', encodeURIComponent(ticket)))
    if (response.status !== 202 && !ticketOf(response)) return response
  }
  throw new Error(`Sodeco did not finish ticket ${ticket} within ${Math.round((tries * delayMs) / 60000)} minutes.`)
}
