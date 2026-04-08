'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
import type { LucideIcon } from 'lucide-react'

interface NavItemProps {
  href: string
  icon: LucideIcon
  label: string
  expanded: boolean
}

export function NavItem({ href, icon: Icon, label, expanded }: NavItemProps) {
  const pathname = usePathname()
  const isActive = pathname === href || pathname.startsWith(href + '/')

  return (
    <Link
      href={href}
      title={expanded ? undefined : label}
      className={clsx(
        'group relative flex items-center rounded-lg transition-all duration-[var(--transition-base)]',
        expanded ? 'h-10 gap-3 px-3' : 'justify-center w-10 h-10',
        {
          'bg-[var(--accent-indigo-glow)] text-[var(--accent-indigo)]': isActive,
          'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)]': !isActive,
        },
      )}
    >
      {/* Active indicator bar */}
      {isActive && (
        <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[var(--accent-indigo)]" />
      )}
      <Icon size={18} className="flex-shrink-0" />
      {expanded && (
        <span className="text-sm font-medium whitespace-nowrap overflow-hidden">
          {label}
        </span>
      )}
      {/* Tooltip — only when collapsed */}
      {!expanded && (
        <span className="absolute left-full ml-2 px-2 py-1 bg-[var(--bg-surface-overlay)] text-[var(--text-primary)] text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 border border-[var(--border-default)] shadow-lg">
          {label}
        </span>
      )}
    </Link>
  )
}
