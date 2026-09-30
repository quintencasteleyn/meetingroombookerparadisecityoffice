// Sends email through Microsoft 365 (Microsoft Graph API) from a shared
// mailbox, e.g. rooms@paradisecity.be. Plain SMTP isn't used because
// Supabase Edge Functions can't open SMTP port 587.

export interface Attachment {
  name: string
  contentType: string
  content: string
}

export interface Mail {
  to: string[]
  subject: string
  html: string
  replyTo?: { email: string; name?: string }
  attachments?: Attachment[]
}

let cachedToken: { value: string; expiresAt: number } | null = null

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing function secret ${name}`)
  return value
}

async function graphToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const res = await fetch(`https://login.microsoftonline.com/${env('MS_TENANT_ID')}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('MS_CLIENT_ID'),
      client_secret: env('MS_CLIENT_SECRET'),
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  if (!res.ok) throw new Error(`Microsoft login failed (${res.status}): ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
  return body.access_token
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export async function sendMail(mail: Mail): Promise<void> {
  const from = env('MAIL_FROM')
  const token = await graphToken()
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: mail.subject,
        body: { contentType: 'HTML', content: mail.html },
        toRecipients: mail.to.map((address) => ({ emailAddress: { address } })),
        replyTo: mail.replyTo
          ? [{ emailAddress: { address: mail.replyTo.email, name: mail.replyTo.name } }]
          : undefined,
        attachments: mail.attachments?.map((a) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.name,
          contentType: a.contentType,
          contentBytes: base64Utf8(a.content),
        })),
      },
      saveToSentItems: false,
    }),
  })
  if (!res.ok) throw new Error(`Sending email failed (${res.status}): ${await res.text()}`)
}
