'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Header } from '@/components/Header'
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
                <Header onOpenMenu={() => setMobileNavOpen(true)} />

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
