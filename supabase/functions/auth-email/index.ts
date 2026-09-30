// "Send Email" auth hook: Supabase calls this instead of its own mailer
// for account confirmation and password-reset emails, and we send them
// through Microsoft 365 from the company mailbox.
//
// Links point to the website (…/#/auth/confirm) where the colleague clicks
// a button to finish. That extra click matters: Microsoft Defender scans
// links in emails and would otherwise "use up" the one-time link.

import { Webhook } from 'npm:standardwebhooks@1.0.0'
import { sendMail } from '../_shared/mailer.ts'
import { APP_NAME, escapeHtml, layout } from '../_shared/email.ts'
import { appUrl } from '../_shared/supabase.ts'

interface HookPayload {
  user: { email: string; new_email?: string; user_metadata?: { full_name?: string } }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: string
    site_url: string
    token_new?: string
    token_hash_new?: string
  }
}

function reply(status: number, message?: string): Response {
  const body = message ? { error: { http_code: status, message } } : {}
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const COPY: Record<string, { subject: string; heading: string; text: string; button: string }> = {
  signup: {
    subject: `Confirm your ${APP_NAME} account`,
    heading: 'Welcome! Please confirm your email',
    text: 'You created an account to book the meeting rooms at the Paradise City office. Confirm your email address to start booking.',
    button: 'Confirm my account',
  },
  recovery: {
    subject: `Reset your ${APP_NAME} password`,
    heading: 'Reset your password',
    text: "Someone (hopefully you) asked to reset your password. Click the button to choose a new one. If this wasn't you, you can ignore this email.",
    button: 'Choose a new password',
  },
  magiclink: {
    subject: `Your ${APP_NAME} sign-in link`,
    heading: 'Sign in',
    text: 'Click the button to sign in.',
    button: 'Sign in',
  },
  invite: {
    subject: `You're invited to ${APP_NAME}`,
    heading: "You're invited",
    text: 'You have been invited to book meeting rooms at the Paradise City office.',
    button: 'Accept the invitation',
  },
  email_change: {
    subject: `Confirm your new email address`,
    heading: 'Confirm your email change',
    text: 'Click the button to confirm this email address for your account.',
    button: 'Confirm email address',
  },
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, 'Method not allowed')

  const secret = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '').replace('v1,whsec_', '')
  const payload = await req.text()
  let data: HookPayload
  try {
    data = new Webhook(secret).verify(payload, Object.fromEntries(req.headers)) as HookPayload
  } catch {
    return reply(401, 'Invalid hook signature')
  }

  try {
    const { user, email_data } = data
    const type = email_data.email_action_type
    const base = appUrl(email_data.site_url)
    const name = user.user_metadata?.full_name?.split(' ')[0]

    if (type === 'reauthentication') {
      await sendMail({
        to: [user.email],
        subject: `Your ${APP_NAME} verification code`,
        html: layout({
          heading: 'Your verification code',
          paragraphs: [`Enter this code to continue: <strong style="font-size:20px">${email_data.token}</strong>`],
        }),
      })
      return reply(200)
    }

    const copy = COPY[type] ?? COPY.magiclink
    const link = (tokenHash: string) =>
      `${base}#/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}`

    // With "secure email change", both the old and the new address get a link.
    const recipients: [string, string][] =
      type === 'email_change' && user.new_email
        ? email_data.token_hash_new
          ? [
              [user.email, email_data.token_hash_new],
              [user.new_email, email_data.token_hash],
            ]
          : [[user.new_email, email_data.token_hash]]
        : [[user.email, email_data.token_hash]]

    for (const [to, tokenHash] of recipients) {
      await sendMail({
        to: [to],
        subject: copy.subject,
        html: layout({
          heading: copy.heading,
          paragraphs: [name ? `Hi ${escapeHtml(name)},` : 'Hi,', copy.text],
          button: { text: copy.button, url: link(tokenHash) },
          footnote: "This link works once and expires after 1 hour. If it doesn't work anymore, simply request a new one.",
        }),
      })
    }
    return reply(200)
  } catch (err) {
    console.error(err)
    return reply(500, err instanceof Error ? err.message : 'Could not send email')
  }
})
