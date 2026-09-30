import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { CalendarDays, ChevronDown, LogOut, Palette, ShieldCheck } from 'lucide-react'
import Logo from './Logo'
import { Avatar } from './ui'
import { useAuth } from '../context/AuthContext'

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
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      isActive ? 'bg-primary/12 text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg'
    }`

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-3 px-3 sm:px-5">
          <Link to="/" className="mr-2 shrink-0">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            <NavLink to="/" end className={navClass}>
              <CalendarDays className="size-4" /> Calendar
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin" className={navClass}>
                <ShieldCheck className="size-4" /> Admin
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
                <MenuLink to="/" onClick={() => setMenuOpen(false)} icon={<CalendarDays className="size-4" />}>
                  Calendar
                </MenuLink>
                {isAdmin && (
                  <MenuLink to="/admin" onClick={() => setMenuOpen(false)} icon={<ShieldCheck className="size-4" />}>
                    Admin: users & rooms
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
