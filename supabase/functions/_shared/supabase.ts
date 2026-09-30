import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface CallerProfile {
  id: string
  email: string
  full_name: string
  role: 'member' | 'admin'
  blocked: boolean
}

function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  // Newer projects expose secret keys as JSON: {"default": "sb_secret_..."}
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>
      const key = parsed.default ?? Object.values(parsed)[0]
      if (key) return key
    } catch {
      // fall through
    }
  }
  throw new Error('No service role key available to the function.')
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Resolves the signed-in colleague that called the function, or null. */
export async function getCaller(req: Request, admin: SupabaseClient): Promise<CallerProfile | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, full_name, role, blocked')
    .eq('id', data.user.id)
    .maybeSingle()
  if (!profile || profile.blocked) return null
  return profile as CallerProfile
}

export function appUrl(fallback?: string): string {
  const url = Deno.env.get('APP_URL') || fallback || ''
  return url.endsWith('/') ? url : `${url}/`
}
