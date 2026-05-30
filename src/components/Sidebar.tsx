'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FileText, CalendarDays, RotateCw, Newspaper, Sun, Moon, ArrowLeftRight } from 'lucide-react'
import { useTheme } from './ThemeProvider'

const NAV = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/exams',     icon: FileText,        label: 'Concursos' },
  { href: '/calendar',  icon: CalendarDays,    label: 'Calendário' },
  { href: '/reviews',   icon: RotateCw,        label: 'Revisões' },
  { href: '/news',      icon: Newspaper,       label: 'Notícias' },
]

export function Sidebar() {
  const pathname = usePathname()
  const { theme, toggle } = useTheme()

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col border-r" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}>
      <div className="px-5 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ background: 'linear-gradient(135deg, var(--primary-strong), var(--primary))', color: '#fff' }}
          >E</div>
          <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>EditalFocus</span>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {NAV.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{
                background: active ? 'var(--primary-soft)' : 'transparent',
                color: active ? 'var(--primary-soft-text)' : 'var(--text-muted)',
                fontWeight: active ? 500 : 400,
              }}
            >
              <Icon size={16} strokeWidth={active ? 2.25 : 2} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="p-3 border-t space-y-2" style={{ borderColor: 'var(--border)' }}>
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
        <p className="text-xs px-1" style={{ color: 'var(--text-subtle)' }}>EditalFocus v1.0</p>
      </div>
    </aside>
  )
}
