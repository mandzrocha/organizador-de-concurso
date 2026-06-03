'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Menu } from 'lucide-react'
import { Sidebar } from '@/components/Sidebar'
import { SetupBanner } from '@/components/SetupBanner'
import { ThemeProvider } from '@/components/ThemeProvider'
import { ToastProvider } from '@/components/Toast'
import { ConfirmProvider } from '@/components/ConfirmDialog'
import { StudyToolsProvider } from '@/components/StudyTools'

export function AppShell({ configured, children }: { configured: boolean; children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const pathname = usePathname()

  // Fecha o drawer ao navegar
  useEffect(() => { setMobileNavOpen(false) }, [pathname])

  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <StudyToolsProvider>
            <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
              {/* Overlay mobile */}
              {mobileNavOpen && (
                <div
                  className="fixed inset-0 z-40 lg:hidden"
                  style={{ background: 'rgba(0,0,0,0.5)' }}
                  onClick={() => setMobileNavOpen(false)}
                />
              )}

              <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

              <main className="flex-1 overflow-y-auto">
                {/* Barra superior mobile com hambúrguer */}
                <div
                  className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 border-b"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
                >
                  <button
                    onClick={() => setMobileNavOpen(true)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label="Abrir menu"
                  >
                    <Menu size={20} />
                  </button>
                  <Link href="/dashboard">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo.svg" alt="ConcurFlow" className="h-7 w-auto" />
                  </Link>
                </div>

                {!configured && <SetupBanner />}
                <div key={pathname} className="ef-fade-in">
                  {children}
                </div>
              </main>
            </div>
          </StudyToolsProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
