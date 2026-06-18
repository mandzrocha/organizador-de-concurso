'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LayoutDashboard, FileText, CalendarDays, RotateCw, Newspaper, Sun, Moon, ArrowLeftRight, User, LogOut, BarChart3, Trophy, NotebookPen } from 'lucide-react'
import { useTheme } from './ThemeProvider'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/config'

const NAV = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/exams',     icon: FileText,        label: 'Concursos' },
  { href: '/calendar',  icon: CalendarDays,    label: 'Calendário' },
  { href: '/reviews',   icon: RotateCw,        label: 'Revisões' },
  { href: '/performance', icon: BarChart3,     label: 'Desempenho' },
  { href: '/simulados', icon: Trophy,          label: 'Simulados' },
  { href: '/caderno',   icon: NotebookPen,     label: 'Caderno de erros' },
  { href: '/news',      icon: Newspaper,       label: 'Notícias' },
  { href: '/profile',   icon: User,            label: 'Perfil' },
]

export function Sidebar({ mobileOpen = false, onClose }: { mobileOpen?: boolean; onClose?: () => void } = {}) {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, toggle } = useTheme()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null))
  }, [])

  async function signOut() {
    if (isSupabaseConfigured()) {
      await createClient().auth.signOut()
    }
    router.push('/login')
    router.refresh()
  }

  return (
    <aside
      className={`w-56 flex-shrink-0 flex flex-col border-r fixed inset-y-0 left-0 z-50 transition-transform lg:static lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
    >
      <div className="px-4 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
        <Link href="/dashboard" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="ConcurFlow" className="h-10 w-auto" />
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {NAV.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'font-medium'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]'
              }`}
              style={active ? { background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' } : undefined}
            >
              {active && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full"
                  style={{ background: 'var(--primary)' }}
                />
              )}
              <Icon
                size={16}
                strokeWidth={active ? 2.25 : 2}
                style={{ color: active ? 'var(--primary)' : undefined }}
                className={active ? '' : 'transition-transform group-hover:scale-110'}
              />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="p-3 border-t space-y-2" style={{ borderColor: 'var(--border)' }}>
        {email && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: 'var(--surface-hover)' }}>
            <span className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold uppercase" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>
              {email[0]}
            </span>
            <span className="text-xs truncate flex-1" style={{ color: 'var(--text-muted)' }} title={email}>{email}</span>
            <button
              onClick={signOut}
              className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors hover:bg-[var(--danger-soft)]"
              style={{ color: 'var(--text-subtle)' }}
              title="Sair"
              aria-label="Sair da conta"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
        <button
          onClick={toggle}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors"
          style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}
        >
          <span className="flex items-center gap-2">
            {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
            <span>{theme === 'dark' ? 'Escuro' : 'Claro'}</span>
          </span>
          <ArrowLeftRight size={12} style={{ color: 'var(--text-subtle)' }} />
        </button>
        <p className="text-xs px-1" style={{ color: 'var(--text-subtle)' }}>ConcurFlow v1.0</p>
      </div>
    </aside>
  )
}
