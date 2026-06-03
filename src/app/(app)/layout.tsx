import { AppShell } from '@/components/AppShell'
import { isSupabaseConfigured } from '@/lib/config'

export const dynamic = 'force-dynamic'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured()
  return <AppShell configured={configured}>{children}</AppShell>
}
