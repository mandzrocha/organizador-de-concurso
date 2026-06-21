'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FileText, CalendarDays, RotateCw, Newspaper, BarChart3, Trophy, NotebookPen, Library } from 'lucide-react'

const NAV = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/exams',     icon: FileText,        label: 'Concursos' },
  { href: '/biblioteca', icon: Library,        label: 'Biblioteca' },
  { href: '/calendar',  icon: CalendarDays,    label: 'Calendário' },
  { href: '/reviews',   icon: RotateCw,        label: 'Revisões' },
  { href: '/performance', icon: BarChart3,     label: 'Desempenho' },
  { href: '/simulados', icon: Trophy,          label: 'Simulados' },
  { href: '/caderno',   icon: NotebookPen,     label: 'Caderno de erros' },
  { href: '/news',      icon: Newspaper,       label: 'Notícias' },
]

export function Sidebar({ mobileOpen = false, onClose }: { mobileOpen?: boolean; onClose?: () => void } = {}) {
  const pathname = usePathname()

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

      <div className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <p className="text-xs px-1" style={{ color: 'var(--text-subtle)' }}>ConcurFlow v1.0</p>
      </div>
    </aside>
  )
}
