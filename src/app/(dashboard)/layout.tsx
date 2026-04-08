import { SidebarProvider } from '@/components/layout/sidebar-context'
import { Sidebar } from '@/components/layout/sidebar'
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
        <DashboardMain>{children}</DashboardMain>
      </div>
    </SidebarProvider>
  )
}
