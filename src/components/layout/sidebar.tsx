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
} from 'lucide-react'
import { NavItem } from './nav-item'

const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/leads', icon: Users, label: 'Leads' },
  { href: '/drafts', icon: Mail, label: 'Drafts' },
  { href: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { href: '/sequences', icon: GitBranch, label: 'Sequences' },
  { href: '/inbox', icon: Inbox, label: 'Inbox' },
  { href: '/replies', icon: MessageSquare, label: 'Replies' },
  { href: '/analytics', icon: BarChart2, label: 'Analytics' },
  { href: '/templates', icon: FileText, label: 'Templates' },
] as const

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-full w-[52px] bg-[#13151c] border-r border-[#1e2130] flex flex-col items-center py-4 gap-2 z-40">
      {/* Logo mark */}
      <div className="w-8 h-8 bg-[#6366f1] rounded-lg flex items-center justify-center mb-4 flex-shrink-0">
        <span className="text-white text-xs font-bold">OS</span>
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.href} {...item} />
        ))}
      </nav>

      {/* Settings pinned to bottom */}
      <NavItem href="/settings" icon={Settings} label="Settings" />
    </aside>
  )
}
