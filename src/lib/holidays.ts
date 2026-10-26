// Holiday planner data: who is off when, everyone in the planner, the
// app settings and the admins. The day counting itself is shared with
// the weekly email (supabase/functions/_shared/holidays.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { Absence, Person } from '../../supabase/functions/_shared/holidays'

export * from '../../supabase/functions/_shared/holidays'

export interface AppSettings {
  digest_enabled: boolean
  digest_recipients: string[]
  digest_last_week: string | null
  digest_last_sent_at: string | null
  digest_last_sent_count: number | null
  sodeco_last_sync_at: string | null
  sodeco_last_sync_ok: boolean | null
  sodeco_last_sync_message: string | null
}

export const ABSENCE_COLUMNS = 'id, person_email, start_date, end_date, day_part, status, source'

/** Days off overlapping [from, to] (ISO dates), refreshed live when anyone changes them. */
export function useAbsences(from: string, to: string) {
  const [absences, setAbsences] = useState<Absence[]>([])
  const [loading, setLoading] = useState(true)
  const request = useRef(0)

  const reload = useCallback(async () => {
    const id = ++request.current
    const { data, error } = await supabase
      .from('absences')
      .select(ABSENCE_COLUMNS)
      .lte('start_date', to)
      .gte('end_date', from)
      .order('start_date')
    if (id !== request.current) return // a newer range was requested meanwhile
    if (error) console.error(error)
    setAbsences((data as Absence[]) ?? [])
    setLoading(false)
  }, [from, to])

  useEffect(() => {
    setLoading(true)
    void reload()
  }, [reload])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const channel = supabase
      .channel(`absences-${from}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absences' }, () => {
        clearTimeout(timer)
        timer = setTimeout(() => void reload(), 300)
      })
      .subscribe()
    const onFocus = () => void reload()
    window.addEventListener('focus', onFocus)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      void supabase.removeChannel(channel)
    }
  }, [from, reload])

  return { absences, loading, reload }
}

/** Everyone in the planner: accounts and the employee list together. */
export function usePeople() {
  const [people, setPeople] = useState<Person[]>([])
  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc('holiday_people')
    if (error) console.error(error)
    setPeople((data as Person[]) ?? [])
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  const byEmail = useMemo(() => new Map(people.map((p) => [p.email, p])), [people])
  return { people, byEmail, reload }
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('app_settings').select('*').maybeSingle()
    if (error) console.error(error)
    setSettings((data as AppSettings | null) ?? null)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  return { settings, reload }
}

export function useAdmins() {
  const [admins, setAdmins] = useState<{ full_name: string; email: string }[]>([])
  useEffect(() => {
    supabase
      .from('profiles')
      .select('full_name, email')
      .eq('role', 'admin')
      .eq('blocked', false)
      .order('full_name')
      .then(({ data }) => setAdmins(data ?? []))
  }, [])
  return admins
}
