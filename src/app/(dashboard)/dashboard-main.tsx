'use client'

import { useSidebar } from '@/components/layout/sidebar-context'

export function DashboardMain({ children }: { children: React.ReactNode }) {
  const { expanded } = useSidebar()

  return (
    <main
      className="min-h-screen flex flex-col transition-[margin-left] duration-[var(--transition-slow)] lg:ml-[var(--sidebar-width)]"
      style={{
        '--sidebar-width': expanded
          ? 'var(--sidebar-width-expanded)'
          : 'var(--sidebar-width-collapsed)',
      } as React.CSSProperties}
    >
      {children}
    </main>
  )
}
