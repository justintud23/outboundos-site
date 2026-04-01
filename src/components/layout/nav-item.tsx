'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
import type { LucideIcon } from 'lucide-react'

interface NavItemProps {
  href: string
  icon: LucideIcon
  label: string
}

export function NavItem({ href, icon: Icon, label }: NavItemProps) {
  const pathname = usePathname()
  const isActive = pathname === href || pathname.startsWith(href + '/')

  return (
    <Link
      href={href}
      title={label}
      className={clsx(
        'group relative flex items-center justify-center w-10 h-10 rounded-lg transition-colors',
        {
          'bg-[#1e1f3a] text-[#6366f1]': isActive,
          'text-[#475569] hover:text-[#94a3b8] hover:bg-[#1a1d2e]': !isActive,
        },
      )}
    >
      <Icon size={18} />
      {/* Tooltip */}
      <span className="absolute left-full ml-2 px-2 py-1 bg-[#1a1d2e] text-[#e2e8f0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 border border-[#2a2d3e]">
        {label}
      </span>
    </Link>
  )
}
