'use client'

import {
  LayoutDashboard,
  Users,
  Megaphone,
  GitBranch,
  Inbox,
  MessageSquare,
  BarChart2,
  FileText,
  Settings,
  Mail,
  ChevronLeft,
  ChevronRight,
  Kanban,
  Zap,
} from 'lucide-react'
import { NavItem } from './nav-item'
import { useSidebar } from './sidebar-context'
import { Logo } from '@/components/brand/logo'

const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/action-center', icon: Zap, label: 'Actions' },
  { href: '/leads', icon: Users, label: 'Leads' },
  { href: '/pipeline', icon: Kanban, label: 'Pipeline' },
  { href: '/drafts', icon: Mail, label: 'Drafts' },
  { href: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { href: '/sequences', icon: GitBranch, label: 'Sequences' },
  { href: '/inbox', icon: Inbox, label: 'Inbox' },
  { href: '/replies', icon: MessageSquare, label: 'Replies' },
  { href: '/analytics', icon: BarChart2, label: 'Analytics' },
  { href: '/templates', icon: FileText, label: 'Templates' },
] as const

export function Sidebar() {
  const { expanded, toggle, mobileOpen, setMobileOpen } = useSidebar()

  const sidebarContent = (
    <aside
      role="navigation"
      aria-label="Main navigation"
      className={[
        'fixed left-0 top-0 h-full bg-[var(--bg-sidebar)] border-r border-[var(--border-default)] shadow-[var(--shadow-sidebar)] flex flex-col py-4 z-40',
        'transition-[width] duration-[var(--transition-slow)]',
        expanded ? 'w-[var(--sidebar-width-expanded)]' : 'w-[var(--sidebar-width-collapsed)]',
        mobileOpen ? '' : 'hidden lg:flex',
      ].join(' ')}
    >
      {/* Logo */}
      <div className={`flex items-center mb-6 ${expanded ? 'px-5' : 'px-0 justify-center'}`}>
        <Logo size="sm" variant="dark" showText={expanded} />
      </div>

      {/* Nav items */}
      <nav className={`flex flex-col gap-1 flex-1 ${expanded ? 'px-3' : 'px-0 items-center'}`}>
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.href} {...item} expanded={expanded} />
        ))}
      </nav>

      {/* Bottom section */}
      <div className={`flex flex-col gap-1 ${expanded ? 'px-3' : 'px-0 items-center'}`}>
        <NavItem href="/settings" icon={Settings} label="Settings" expanded={expanded} />

        {/* Collapse toggle — desktop only */}
        <button
          onClick={toggle}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          className={[
            'hidden lg:flex items-center justify-center mt-2 rounded-lg cursor-pointer',
            'transition-colors duration-[var(--transition-base)]',
            'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)]',
            expanded ? 'w-full h-9 gap-2 px-3' : 'w-10 h-10',
          ].join(' ')}
        >
          {expanded ? (
            <>
              <ChevronLeft size={16} aria-hidden="true" />
              <span className="text-xs">Collapse</span>
            </>
          ) : (
            <ChevronRight size={16} aria-hidden="true" />
          )}
        </button>
      </div>
    </aside>
  )

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setMobileOpen(false)}
          role="button"
          tabIndex={0}
          aria-label="Close sidebar"
        />
      )}
      {sidebarContent}
    </>
  )
}
