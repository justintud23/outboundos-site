import { Sidebar } from '@/components/layout/sidebar'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#0f1117]">
      <Sidebar />
      <main className="ml-[52px] min-h-screen flex flex-col">
        {children}
      </main>
    </div>
  )
}
