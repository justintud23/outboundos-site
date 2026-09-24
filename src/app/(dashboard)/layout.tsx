import { SidebarProvider } from '@/components/layout/sidebar-context'
import { Sidebar } from '@/components/layout/sidebar'
import { SystemBanner } from '@/components/layout/system-banner'
import { DashboardMain } from './dashboard-main'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider>
      <div className="min-h-screen bg-[var(--bg-base)]">
        <Sidebar />
        <DashboardMain>
          <SystemBanner />
          {children}
        </DashboardMain>
      </div>
    </SidebarProvider>
  )
}
