// Talks to Sodeco's Link2Prisma API, as described in the Link2Prisma manual
// (link2prisma.sodeco.info/documentation/MO_Link2Prisma_EN.pdf):
//
//   * HTTPS only, signed with the client certificate Sodeco creates for us
//     (a .pfx/.p12 file with a password). We only read (GET).
//   * Every request is asynchronous: it answers 202 with a unique identifier.
//     GET /Result/{identifier} then tells the status of the request and,
//     once it is done, holds the requested data as JSON text in "Response".
//   * Requests about an employer carry the header "Employer" (its external
//     number); /Result takes no header.

import https from 'node:https'

const TIMEOUT_MS = 60_000

/** Status codes from "Link2Prisma StatusCodes.xlsx". */
const WAITING = new Set(['202', '302']) // in the queue / being processed
const DONE = new Set(['200', '201', '206'])
const EMPTY = '204' // processed, but nothing found
const HINTS = {
  '401': 'The certificate has no access to this employer. Ask Sodeco to give its user rights on the employer number.',
  '404': 'Sodeco does not know this employer or worker number. Check SODECO_EMPLOYER.',
}

function explain(err) {
  const hint = /mac verify|pkcs12|unsupported|bad decrypt|asn1|wrong tag/i.test(err.message)
    ? ' Is SODECO_CERT_PASSWORD right, and is SODECO_CERT_PFX_BASE64 the whole .pfx file in base64?'
    : ''
  return new Error(`Could not reach Sodeco: ${err.message}.${hint}`)
}

export function createClient({ baseUrl, pfx, passphrase }) {
  if (!baseUrl) throw new Error('SODECO_BASE_URL is not set.')
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`

  /** GET a path (relative to the base URL) and return { status, body }. */
  function get(path, headers = {}) {
    const url = new URL(path.replace(/^\//, ''), base)
    return new Promise((resolve, reject) => {
      const onResponse = (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode >= 400) {
            const extra = res.statusCode === 403 ? ' (Sodeco did not accept the certificate.)' : ''
            reject(new Error(`Sodeco answered ${res.statusCode} for ${url.pathname}${extra}: ${text.slice(0, 300)}`))
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

/** The unique identifier in a 202 answer: plain text, a JSON string, or an object holding it. */
export function identifierOf(body) {
  if (typeof body === 'string' && body.trim()) return body.trim().replace(/^"|"$/g, '')
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body)) {
      if (/^(id|guid|identifier|uniqueidentifier)$/i.test(key) && value) return String(value)
    }
  }
  throw new Error(`Sodeco accepted the request but sent no identifier: ${JSON.stringify(body).slice(0, 200)}`)
}

/** The data inside a finished Result: "Response" is JSON text (or already parsed). */
export function dataOfResult(result) {
  const code = String(result?.Statuscode ?? '')
  if (code === EMPTY) return []
  const response = result?.Response
  if (response === null || response === undefined || response === '') return []
  if (typeof response !== 'string') return response
  try {
    return JSON.parse(response)
  } catch {
    throw new Error(`Sodeco's answer is not valid JSON: ${response.slice(0, 200)}`)
  }
}

/**
 * Sends a GET request for one employer and waits for its result.
 * Sodeco's own program works through the queue, so this can take a few minutes.
 */
export async function fetchData(client, path, employer, { delayMs = 10_000, maxWaitMs = 15 * 60_000, log = () => {} } = {}) {
  const first = await client.get(path, employer ? { Employer: employer } : {})
  if (first.status !== 202) return first.body // answered right away
  const id = identifierOf(first.body)
  log(`Sodeco queued the request (${id}), waiting for the result…`)

  const until = Date.now() + maxWaitMs
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, delayMs))
    const { body: result } = await client.get(`Result/${encodeURIComponent(id)}`)
    const code = String(result?.Statuscode ?? '')
    if (WAITING.has(code)) continue
    if (DONE.has(code) || code === EMPTY) return dataOfResult(result)
    const hint = HINTS[code.slice(0, 3)] ?? ''
    throw new Error(`Sodeco could not process the request: ${code} ${result?.StatusDescription ?? ''}. ${hint}`.trim())
  }
  throw new Error(`Sodeco did not finish the request within ${Math.round(maxWaitMs / 60_000)} minutes (identifier ${id}). Try again later.`)
}
