import { Sidebar } from '@/components/Sidebar'
import { SetupBanner } from '@/components/SetupBanner'
import { isSupabaseConfigured } from '@/lib/config'

export const dynamic = 'force-dynamic'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured()

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0f0f13' }}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {!configured && <SetupBanner />}
        {children}
      </main>
    </div>
  )
}
