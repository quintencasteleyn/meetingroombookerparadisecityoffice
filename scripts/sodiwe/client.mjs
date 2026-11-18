// Talks to Sodiwe's Link2Prisma API, as described in the Link2Prisma manual
// (link2prisma.sodeco.info/documentation/MO_Link2Prisma_EN.pdf):
//
//   * HTTPS only, signed with the client certificate Sodiwe creates for us
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
  '401': 'The certificate has no access to this employer. Ask Sodiwe to give its user rights on the employer number.',
  '404': 'Sodiwe does not know this employer number, or the certificate\'s user has no access to it. Check SODIWE_EMPLOYER; if it is right, send Sodiwe the request number above.',
}

function parseBody(text) {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return text // not JSON: the text as is
  }
}

/** A request identifier on its own, like "6fda4aea-8700-4adb-9d80-0c02df490f3b". */
function identifierIn(body) {
  const m = typeof body === 'string' ? body.trim().match(/^"?([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})"?$/i) : null
  return m ? m[1] : null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * What Sodiwe support needs to look a request up: its identifier, and the
 * employer and certificate user Sodiwe recorded for it. Neither is personal
 * data (no worker numbers), so this can go in the public log.
 */
function traceOf(id, result) {
  const seen = [
    result?.Employer != null && result.Employer !== '' ? `employer "${result.Employer}"` : '',
    result?.User ? `user "${result.User}"` : '',
  ].filter(Boolean)
  return `Request ${id}${seen.length ? `; Sodiwe recorded ${seen.join(' and ')}` : ''}.`
}

/**
 * Why Sodiwe refused a request: its status in /Result/{id}. Only the status
 * code and description are used (never the response data), so this can go in
 * the public log.
 */
async function refusalReason(client, id, { tries = 6, delayMs = 5000 } = {}) {
  for (let i = 0; i < tries; i++) {
    let result
    try {
      result = (await client.get(`Result/${encodeURIComponent(id)}`)).body
    } catch (err) {
      result = err.body
    }
    if (result && typeof result === 'object') {
      const code = String(result.Statuscode ?? '')
      if (!WAITING.has(code)) {
        const hint = HINTS[code.slice(0, 3)] ?? ''
        return `Its status: ${code} ${result.StatusDescription ?? '(no description)'}. ${traceOf(id, result)} ${hint}`.trim()
      }
    }
    if (i < tries - 1) await sleep(delayMs)
  }
  return `Sodiwe gave no reason (request ${id}).`
}

function explain(err) {
  const hint = /unsupported/i.test(err.message)
    ? ' The certificate uses an older encryption: run node with --openssl-legacy-provider (the GitHub job does).'
    : /mac verify|pkcs12|bad decrypt|asn1|wrong tag/i.test(err.message)
      ? ' Is SODIWE_CERT_PASSWORD right, and is SODIWE_CERT_PFX_BASE64 the whole .pfx file in base64?'
      : ''
  return new Error(`Could not reach Sodiwe: ${err.message}.${hint}`)
}

export function createClient({ baseUrl, pfx, passphrase }) {
  if (!baseUrl) throw new Error('SODIWE_BASE_URL is not set.')
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
            const extra = res.statusCode === 403 ? ' (Sodiwe did not accept the certificate.)' : ''
            const err = new Error(`Sodiwe answered ${res.statusCode} for ${url.pathname}${extra}: ${text.slice(0, 300)}`)
            err.status = res.statusCode
            err.body = parseBody(text)
            reject(err)
            return
          }
          resolve({ status: res.statusCode, body: parseBody(text) })
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
      req.on('timeout', () => req.destroy(new Error(`Sodiwe did not answer within ${TIMEOUT_MS / 1000} seconds`)))
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
  throw new Error(`Sodiwe accepted the request but sent no identifier: ${JSON.stringify(body).slice(0, 200)}`)
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
    throw new Error(`Sodiwe's answer is not valid JSON: ${response.slice(0, 200)}`)
  }
}

/**
 * Sends a GET request for one employer and waits for its result.
 * Sodiwe's own program works through the queue, so this can take a few minutes.
 */
export async function fetchData(client, path, employer, { delayMs = 10_000, maxWaitMs = 15 * 60_000, log = () => {} } = {}) {
  let first
  try {
    first = await client.get(path, employer ? { Employer: employer } : {})
  } catch (err) {
    // Link2Prisma can refuse a request straight away and still give it an
    // identifier; /Result/{id} then says why.
    const id = identifierIn(err.body)
    if (!id) throw err
    throw new Error(`Sodiwe refused the request (HTTP ${err.status}). ${await refusalReason(client, id)}`)
  }
  if (first.status !== 202) return first.body // answered right away
  const id = identifierOf(first.body)
  log(`Sodiwe queued the request (${id}), waiting for the result…`)

  const until = Date.now() + maxWaitMs
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, delayMs))
    const { body: result } = await client.get(`Result/${encodeURIComponent(id)}`)
    const code = String(result?.Statuscode ?? '')
    if (WAITING.has(code)) continue
    if (DONE.has(code) || code === EMPTY) return dataOfResult(result)
    const hint = HINTS[code.slice(0, 3)] ?? ''
    throw new Error(`Sodiwe could not process the request: ${code} ${result?.StatusDescription ?? ''}. ${traceOf(id, result)} ${hint}`.trim())
  }
  throw new Error(`Sodiwe did not finish the request within ${Math.round(maxWaitMs / 60_000)} minutes (identifier ${id}). Try again later.`)
}
