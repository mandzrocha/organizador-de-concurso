'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/dashboard', icon: '▦', label: 'Dashboard' },
  { href: '/exams', icon: '📋', label: 'Concursos' },
  { href: '/calendar', icon: '📅', label: 'Calendário' },
  { href: '/reviews', icon: '🔁', label: 'Revisões' },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col border-r" style={{ background: '#12121a', borderColor: '#2a2a38' }}>
      <div className="px-5 py-5 border-b" style={{ borderColor: '#2a2a38' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold" style={{ background: '#6366f1', color: '#fff' }}>E</div>
          <span className="font-semibold text-sm" style={{ color: '#e8e8f0' }}>EditalFocus</span>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {NAV.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{
                background: active ? '#1e1e30' : 'transparent',
                color: active ? '#818cf8' : '#8888a0',
                fontWeight: active ? 500 : 400,
              }}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t" style={{ borderColor: '#2a2a38' }}>
        <p className="text-xs" style={{ color: '#555568' }}>EditalFocus v1.0</p>
      </div>
    </aside>
  )
}
