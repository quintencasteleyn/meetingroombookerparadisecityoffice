import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { CalendarDays, ChevronDown, CircleQuestionMark, LogOut, Palette, ShieldCheck, TreePalm } from 'lucide-react'
import Logo from './Logo'
import { Avatar } from './ui'
import WorkTypePrompt from './WorkTypePrompt'
import { useAuth } from '../context/AuthContext'
import { ROOMS_ENABLED } from '../lib/features'

export default function Shell() {
  const { profile, isAdmin, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition sm:px-3 ${
      isActive ? 'bg-primary/12 text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg'
    }`
  // On a phone the tabs show only their icon.
  const label = 'hidden sm:inline'

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-3 px-3 sm:px-5">
          <Link to="/" className="mr-1 shrink-0 sm:mr-2" aria-label="Paradise City Office">
            <Logo compact />
          </Link>
          <nav className="flex items-center gap-0.5 sm:gap-1">
            {ROOMS_ENABLED && (
              <NavLink to="/" end className={navClass} aria-label="Rooms">
                <CalendarDays className="size-4" /> <span className={label}>Rooms</span>
              </NavLink>
            )}
            <NavLink to="/holidays" className={navClass} aria-label="Holidays">
              <TreePalm className="size-4" /> <span className={label}>Holidays</span>
            </NavLink>
            <NavLink to="/faq" className={navClass} aria-label="FAQ">
              <CircleQuestionMark className="size-4" /> <span className={label}>FAQ</span>
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin" className={navClass} aria-label="Admin">
                <ShieldCheck className="size-4" /> <span className={label}>Admin</span>
              </NavLink>
            )}
          </nav>

          <div ref={menu} className="relative ml-auto">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-surface-2"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Avatar name={profile?.full_name ?? '?'} size={30} />
              <span className="hidden max-w-[160px] truncate text-sm font-medium md:inline">{profile?.full_name}</span>
              <ChevronDown className="size-4 text-muted" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="dialog-in absolute right-0 top-full mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl"
              >
                <div className="border-b border-line px-4 py-3">
                  <p className="truncate text-sm font-semibold">{profile?.full_name}</p>
                  <p className="truncate text-xs text-muted">{profile?.email}</p>
                  {isAdmin && (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                      <ShieldCheck className="size-3" /> Admin
                    </span>
                  )}
                </div>
                {ROOMS_ENABLED && (
                  <MenuLink to="/" onClick={() => setMenuOpen(false)} icon={<CalendarDays className="size-4" />}>
                    Meeting rooms
                  </MenuLink>
                )}
                <MenuLink to="/holidays" onClick={() => setMenuOpen(false)} icon={<TreePalm className="size-4" />}>
                  Holiday planner
                </MenuLink>
                <MenuLink to="/faq" onClick={() => setMenuOpen(false)} icon={<CircleQuestionMark className="size-4" />}>
                  Questions (FAQ)
                </MenuLink>
                {isAdmin && (
                  <MenuLink to="/admin" onClick={() => setMenuOpen(false)} icon={<ShieldCheck className="size-4" />}>
                    Admin
                  </MenuLink>
                )}
                <MenuLink to="/settings" onClick={() => setMenuOpen(false)} icon={<Palette className="size-4" />}>
                  Settings & colours
                </MenuLink>
                <button
                  role="menuitem"
                  onClick={() => void signOut()}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-fg hover:bg-surface-2"
                >
                  <LogOut className="size-4 text-muted" /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      {/* Only once the holiday planner SQL has run does the profile have work_type (null = not chosen yet). */}
      {profile && profile.work_type === null && <WorkTypePrompt />}
    </div>
  )
}

function MenuLink({
  to,
  onClick,
  icon,
  children,
}: {
  to: string
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Link
      role="menuitem"
      to={to}
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-2 text-sm text-fg hover:bg-surface-2 [&_svg]:text-muted"
    >
      {icon}
      {children}
    </Link>
  )
}
