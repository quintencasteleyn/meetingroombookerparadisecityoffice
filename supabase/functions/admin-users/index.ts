// Admin-only user management: list, block/unblock, delete, change role.

import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getCaller } from '../_shared/supabase.ts'

type Action = 'list' | 'block' | 'unblock' | 'delete' | 'set_role'

const BLOCK_FOREVER = '876000h' // 100 years

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    if (!caller) return json({ error: 'Not signed in' }, 401)
    if (caller.role !== 'admin') return json({ error: 'Only the admin can manage users.' }, 403)

    const body = (await req.json()) as { action?: Action; userId?: string; role?: string }

    if (body.action === 'list') {
      const [{ data: profiles, error: pErr }, { data: authData, error: aErr }, { data: upcoming, error: bErr }] =
        await Promise.all([
          admin.from('profiles').select('id, email, full_name, role, blocked, created_at').order('full_name'),
          admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
          admin.from('bookings').select('user_id').is('cancelled_at', null).gt('ends_at', new Date().toISOString()),
        ])
      if (pErr) throw pErr
      if (aErr) throw aErr
      if (bErr) throw bErr

      const authById = new Map(authData.users.map((u) => [u.id, u]))
      const counts = new Map<string, number>()
      for (const row of upcoming ?? []) counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1)

      return json({
        users: (profiles ?? []).map((p) => ({
          ...p,
          last_sign_in_at: authById.get(p.id)?.last_sign_in_at ?? null,
          email_confirmed_at: authById.get(p.id)?.email_confirmed_at ?? null,
          upcoming_bookings: counts.get(p.id) ?? 0,
        })),
      })
    }

    const userId = body.userId
    if (!userId) return json({ error: 'No user selected.' }, 400)
    if (userId === caller.id) return json({ error: "You can't do this to your own account." }, 400)

    const { data: target } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle()
    if (!target) return json({ error: 'User not found.' }, 404)

    switch (body.action) {
      case 'block': {
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: BLOCK_FOREVER })
        if (error) throw error
        await admin.from('profiles').update({ blocked: true }).eq('id', userId)
        return json({ ok: true })
      }
      case 'unblock': {
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
        if (error) throw error
        await admin.from('profiles').update({ blocked: false }).eq('id', userId)
        return json({ ok: true })
      }
      case 'delete': {
        // Removing the login also removes the profile and that person's bookings.
        const { error } = await admin.auth.admin.deleteUser(userId)
        if (error) throw error
        return json({ ok: true })
      }
      case 'set_role': {
        if (body.role !== 'admin' && body.role !== 'member') return json({ error: 'Unknown role.' }, 400)
        const { error } = await admin.from('profiles').update({ role: body.role }).eq('id', userId)
        if (error) throw error
        return json({ ok: true })
      }
      default:
        return json({ error: 'Unknown action.' }, 400)
    }
  } catch (err) {
    console.error(err)
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
