import type { ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import Shell from './components/Shell'
import { Spinner } from './components/ui'
import CalendarPage from './pages/CalendarPage'
import SettingsPage from './pages/SettingsPage'
import AdminPage from './pages/AdminPage'
import {
  AuthConfirmPage,
  AuthLayout,
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
} from './pages/AuthPages'
import { isConfigured } from './lib/supabase'

function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner label="Loading…" />
    </div>
  )
}

function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { session, profile, loading, isAdmin } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!session || !profile) return <Navigate to="/login" replace />
  if (admin && !isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (session && profile) return <Navigate to="/" replace />
  return <>{children}</>
}

function NotConfigured() {
  return (
    <AuthLayout title="Almost there" subtitle="The website is not connected to Supabase yet.">
      <p className="text-sm">
        Add the repository variables <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> in GitHub (Settings →
        Secrets and variables → Actions → Variables) and run the deploy again. See the README for the full setup.
      </p>
    </AuthLayout>
  )
}

export default function App() {
  if (!isConfigured) return <NotConfigured />
  return (
    <ToastProvider>
      <AuthProvider>
        <HashRouter>
          <Routes>
            <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
            <Route path="/signup" element={<PublicOnly><SignupPage /></PublicOnly>} />
            <Route path="/forgot-password" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
            <Route path="/auth/confirm" element={<AuthConfirmPage />} />
            <Route path="/reset-password" element={<RequireAuth><ResetPasswordPage /></RequireAuth>} />
            <Route element={<RequireAuth><Shell /></RequireAuth>}>
              <Route path="/" element={<CalendarPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin" element={<RequireAuth admin><AdminPage /></RequireAuth>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </ToastProvider>
  )
}
