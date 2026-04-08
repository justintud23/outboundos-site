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
} from 'lucide-react'
import { NavItem } from './nav-item'
import { useSidebar } from './sidebar-context'

const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
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
      className={[
        'fixed left-0 top-0 h-full bg-[var(--bg-sidebar)] border-r border-[var(--border-default)] flex flex-col py-4 z-40',
        'transition-[width] duration-[var(--transition-slow)]',
        expanded ? 'w-[var(--sidebar-width-expanded)]' : 'w-[var(--sidebar-width-collapsed)]',
        // Hide on mobile unless drawer is open
        mobileOpen ? '' : 'hidden lg:flex',
      ].join(' ')}
    >
      {/* Logo */}
      <div className={`flex items-center gap-3 mb-6 ${expanded ? 'px-5' : 'px-0 justify-center'}`}>
        <div className="w-8 h-8 bg-[var(--accent-indigo)] rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-bold">OS</span>
        </div>
        {expanded && (
          <span className="text-[var(--text-primary)] font-semibold text-sm whitespace-nowrap overflow-hidden">
            OutboundOS
          </span>
        )}
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
          className={[
            'hidden lg:flex items-center justify-center mt-2 rounded-lg transition-colors',
            'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)]',
            expanded ? 'w-full h-9 gap-2 px-3' : 'w-10 h-10',
          ].join(' ')}
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {expanded ? (
            <>
              <ChevronLeft size={16} />
              <span className="text-xs">Collapse</span>
            </>
          ) : (
            <ChevronRight size={16} />
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
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      {sidebarContent}
    </>
  )
}
