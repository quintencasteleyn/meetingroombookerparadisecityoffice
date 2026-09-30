import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { applyTheme, cachedTheme, type ThemeSettings } from '../lib/theme'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** Shown on the login page, e.g. when an account got blocked. */
  notice: string | null
  setNotice: (notice: string | null) => void
  isAdmin: boolean
  refreshProfile: () => Promise<void>
  saveTheme: (theme: ThemeSettings) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  // The user id whose profile has finished loading (null = signed out).
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    applyTheme(cachedTheme())
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoaded(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setSessionLoaded(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id

  const loadProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null)
      setLoadedFor(null)
      return
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) {
      console.error(error)
    }
    const loaded = (data as Profile | null) ?? null
    if (!error && (!loaded || loaded.blocked)) {
      setNotice(
        loaded?.blocked
          ? 'Your account has been blocked. Please contact the admin.'
          : 'Your account no longer exists. Please contact the admin.',
      )
      setProfile(null)
      await supabase.auth.signOut()
      setLoadedFor(null)
      return
    }
    setProfile(loaded)
    if (loaded) applyTheme(loaded.theme)
    setLoadedFor(userId)
  }, [userId])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const saveTheme = useCallback(
    async (theme: ThemeSettings) => {
      if (!userId) return
      const { error } = await supabase.from('profiles').update({ theme }).eq('id', userId)
      if (error) throw error
      applyTheme(theme)
      setProfile((p) => (p ? { ...p, theme } : p))
    },
    [userId],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading: !sessionLoaded || (userId ?? null) !== loadedFor,
      notice,
      setNotice,
      isAdmin: profile?.role === 'admin',
      refreshProfile: loadProfile,
      saveTheme,
      signOut,
    }),
    [session, profile, sessionLoaded, userId, loadedFor, notice, loadProfile, saveTheme, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
