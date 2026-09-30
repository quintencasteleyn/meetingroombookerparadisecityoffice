import { useCallback, useEffect, useRef, useState } from 'react'
import type { DateTime } from 'luxon'
import { supabase } from './supabase'
import { BOOKING_COLUMNS, type Booking, type Colleague, type Room } from './types'
import { nowInBrussels } from './time'

export function useRooms() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('rooms').select('*').order('sort_order').order('id')
    if (error) console.error(error)
    setRooms((data as Room[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { rooms, loading, reload }
}

export function useColleagues() {
  const [colleagues, setColleagues] = useState<Colleague[]>([])
  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, email, full_name')
      .eq('blocked', false)
      .order('full_name')
      .then(({ data }) => setColleagues((data as Colleague[]) ?? []))
  }, [])
  return colleagues
}

/** Active bookings overlapping [from, to), refreshed live when anyone books. */
export function useBookings(from: DateTime, to: DateTime) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const fromIso = from.toUTC().toISO()!
  const toIso = to.toUTC().toISO()!
  const request = useRef(0)

  const reload = useCallback(async () => {
    const id = ++request.current
    const { data, error } = await supabase
      .from('bookings')
      .select(BOOKING_COLUMNS)
      .is('cancelled_at', null)
      .lt('starts_at', toIso)
      .gt('ends_at', fromIso)
      .order('starts_at')
    if (id !== request.current) return // a newer week was requested meanwhile
    if (error) console.error(error)
    setBookings((data as unknown as Booking[]) ?? [])
    setLoading(false)
  }, [fromIso, toIso])

  useEffect(() => {
    setLoading(true)
    void reload()
  }, [reload])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const channel = supabase
      .channel(`bookings-${fromIso}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
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
  }, [fromIso, reload])

  return { bookings, loading, reload }
}

/** Current Brussels time, updated every minute (for the red "now" line). */
export function useNow(): DateTime {
  const [now, setNow] = useState(() => nowInBrussels())
  useEffect(() => {
    const id = setInterval(() => setNow(nowInBrussels()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    onChange()
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** Remembers a small per-device preference (e.g. the selected room filter). */
export function useLocalPreference<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? fallback
    } catch {
      return fallback
    }
  })
  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        // ignore
      }
    },
    [key],
  )
  return [value, update]
}
