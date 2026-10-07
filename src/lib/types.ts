import type { ThemeSettings } from './theme'

export type Role = 'member' | 'admin'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  blocked: boolean
  theme: ThemeSettings | null
  created_at: string
}

export interface Colleague {
  id: string
  email: string
  full_name: string
}

export interface Room {
  id: number
  name: string
  capacity: number
  color: string
  sort_order: number
}

export type Frequency = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly'

export interface Recurrence {
  freq: Exclude<Frequency, 'none'>
  until: string
}

export interface Booking {
  id: string
  room_id: number
  user_id: string
  title: string
  guests: string[]
  starts_at: string
  ends_at: string
  series_id: string | null
  recurrence: Recurrence | null
  /** 'waitlist' = waiting for a slot that is taken; it becomes 'confirmed' when the slot frees up. */
  status: 'confirmed' | 'waitlist'
  owner: { full_name: string; email: string } | null
}

export const BOOKING_COLUMNS =
  'id, room_id, user_id, title, guests, starts_at, ends_at, series_id, recurrence, status, owner:profiles!bookings_user_id_fkey(full_name, email)'
