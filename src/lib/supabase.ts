import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && key)

export const supabase = createClient(url || 'http://localhost', key || 'not-configured', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Email links are handled by the /auth/confirm page (verifyOtp), never via URL tokens.
    detectSessionInUrl: false,
    flowType: 'implicit',
  },
})

interface DbError {
  code?: string
  message?: string
}

/** Turns database/auth errors into sentences a colleague understands. */
export function friendlyError(error: unknown): string {
  const e = (error ?? {}) as DbError
  const message = e.message ?? String(error)
  if (e.code === '23P01' || message.includes('bookings_no_overlap')) {
    return 'That room is already booked at this time.'
  }
  if (message.includes('row-level security') || e.code === '42501') {
    return "You're not allowed to do that."
  }
  if (message.includes('Failed to fetch')) {
    return 'Could not reach the server. Check your internet connection and try again.'
  }
  return message
}

/** Calls an Edge Function and returns its JSON, throwing a readable error. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let message = error.message
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const payload = (await context.json()) as { error?: string }
        if (payload.error) message = payload.error
      } catch {
        // keep the generic message
      }
    }
    throw new Error(message)
  }
  return data as T
}

/** Sends booking emails in the background; failures only produce a warning. */
export async function notifyBookings(
  event: 'created' | 'updated' | 'cancelled',
  bookingIds: string[],
): Promise<boolean> {
  if (bookingIds.length === 0) return true
  try {
    await callFunction('notify', { event, bookingIds })
    return true
  } catch (err) {
    console.warn('Email notification failed', err)
    return false
  }
}
