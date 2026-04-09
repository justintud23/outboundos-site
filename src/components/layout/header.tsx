'use client'

import { UserButton, OrganizationSwitcher } from '@clerk/nextjs'
import { Menu } from 'lucide-react'
import { useSidebar } from './sidebar-context'

interface HeaderProps {
  title: string
}

export function Header({ title }: HeaderProps) {
  const { setMobileOpen } = useSidebar()

  return (
    <header className="h-14 border-b border-[var(--border-default)] flex items-center justify-between px-6 bg-[var(--bg-surface)]/60 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(true)}
          className="lg:hidden text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          aria-label="Open sidebar"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-[var(--text-primary)] font-semibold text-base">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <OrganizationSwitcher
          appearance={{
            elements: {
              rootBox: 'text-sm [&_*]:!text-white',
              organizationSwitcherTrigger:
                'hover:bg-[var(--bg-surface-raised)] py-1 px-2 rounded-md',
              organizationSwitcherTriggerIcon: '!text-[var(--text-secondary)]',
            },
          }}
        />
        <UserButton />
      </div>
    </header>
  )
}
