import { Sidebar } from '@/components/Sidebar'
import { SetupBanner } from '@/components/SetupBanner'
import { ThemeProvider } from '@/components/ThemeProvider'
import { isSupabaseConfigured } from '@/lib/config'

export const dynamic = 'force-dynamic'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured()

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          {!configured && <SetupBanner />}
          {children}
        </main>
      </div>
    </ThemeProvider>
  )
}
