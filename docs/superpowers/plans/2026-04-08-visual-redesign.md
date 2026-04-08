# OutboundOS Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle OutboundOS to a dark neon SaaS dashboard aesthetic using CSS custom properties, a collapsible sidebar, and consistent token-based styling across all pages.

**Architecture:** CSS custom properties defined in `globals.css` form the theme foundation. All components swap hardcoded hex colors for `var(--token)` references. A new `SidebarProvider` context manages sidebar collapse/expand state. One new shared component (`StatCard`) consolidates three duplicate stat card implementations.

**Tech Stack:** Next.js 16, React 19, Tailwind v4, clsx, lucide-react, CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-04-08-visual-redesign-design.md`

---

## Phase 1 — Foundation & Shell

### Task 1: Token System in globals.css

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace globals.css with the full token system**

Replace the entire contents of `src/app/globals.css` with:

```css
@import "tailwindcss";

:root {
  /* ── Backgrounds (surface hierarchy) ── */
  --bg-base: #0a0f1f;
  --bg-surface: #0f1221;
  --bg-surface-raised: #161a2c;
  --bg-surface-overlay: #1c2039;
  --bg-sidebar: #0c0f1a;

  /* ── Borders & Dividers ── */
  --border-default: #23294a;
  --border-subtle: #151833;
  --border-glow: rgba(99, 102, 241, 0.15);

  /* ── Text ── */
  --text-primary: #e8eaf0;
  --text-secondary: #94a3b8;
  --text-muted: #4b5574;
  --text-inverse: #080b14;

  /* ── Accent Colors ── */
  --accent-indigo: #6366f1;
  --accent-indigo-hover: #818cf8;
  --accent-indigo-glow: rgba(99, 102, 241, 0.2);
  --accent-cyan: #22d3ee;
  --accent-magenta: #e879f9;

  /* ── Semantic Status ── */
  --status-success: #10b981;
  --status-success-bg: rgba(16, 185, 129, 0.12);
  --status-warning: #f59e0b;
  --status-warning-bg: rgba(245, 158, 11, 0.12);
  --status-danger: #ef4444;
  --status-danger-bg: rgba(239, 68, 68, 0.12);

  /* ── Effects ── */
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.35), 0 0 12px rgba(99, 102, 241, 0.04);
  --shadow-card-hover: 0 4px 16px rgba(0, 0, 0, 0.5), 0 0 20px rgba(99, 102, 241, 0.08);
  --radius-card: 12px;
  --radius-btn: 8px;
  --radius-badge: 6px;

  /* ── Transitions ── */
  --transition-fast: 120ms ease;
  --transition-base: 180ms ease;
  --transition-slow: 260ms ease;

  /* ── Focus ── */
  --focus-ring: 0 0 0 2px rgba(99, 102, 241, 0.35);

  /* ── Sidebar ── */
  --sidebar-width-expanded: 240px;
  --sidebar-width-collapsed: 60px;
}

body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-geist-sans, system-ui, sans-serif);
}

/* Subtle radial gradient background layer for depth */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(ellipse at 20% 0%, rgba(99, 102, 241, 0.06) 0%, transparent 60%),
    radial-gradient(ellipse at 80% 100%, rgba(34, 211, 238, 0.04) 0%, transparent 60%);
  pointer-events: none;
}
```

- [ ] **Step 2: Verify the app still builds**

Run: `cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx next build 2>&1 | tail -5`
Expected: Build succeeds (pages may look slightly different since components still use hardcoded colors — that's fine, they'll be updated in later tasks).

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style: add CSS custom property token system for visual redesign"
```

---

### Task 2: Sidebar Context Provider

**Files:**
- Create: `src/components/layout/sidebar-context.tsx`

- [ ] **Step 1: Create the sidebar context provider**

Create `src/components/layout/sidebar-context.tsx`:

```tsx
'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'

interface SidebarContextValue {
  expanded: boolean
  toggle: () => void
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

const STORAGE_KEY = 'outboundos-sidebar'

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // Read persisted state after mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'collapsed') {
      setExpanded(false)
    }
    setHydrated(true)
  }, [])

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, next ? 'expanded' : 'collapsed')
      return next
    })
  }, [])

  // Close mobile drawer on route changes (resize past breakpoint)
  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 1024) {
        setMobileOpen(false)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  // Avoid layout flash — render nothing on server, render correct state after hydration
  // The children always render; the sidebar reads context to determine its width
  if (!hydrated) {
    return (
      <SidebarContext.Provider value={{ expanded: true, toggle, mobileOpen: false, setMobileOpen }}>
        {children}
      </SidebarContext.Provider>
    )
  }

  return (
    <SidebarContext.Provider value={{ expanded, toggle, mobileOpen, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext)
  if (!ctx) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return ctx
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/sidebar-context.tsx
git commit -m "feat: add SidebarProvider context with localStorage persistence"
```

---

### Task 3: Collapsible Sidebar

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Rewrite the sidebar component**

Replace the entire contents of `src/components/layout/sidebar.tsx` with:

```tsx
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
} from 'lucide-react'
import { NavItem } from './nav-item'
import { useSidebar } from './sidebar-context'

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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "style: redesign sidebar with collapsible behavior and token-based styling"
```

---

### Task 4: NavItem Expanded/Collapsed States

**Files:**
- Modify: `src/components/layout/nav-item.tsx`

- [ ] **Step 1: Update NavItem to support expanded/collapsed modes**

Replace the entire contents of `src/components/layout/nav-item.tsx` with:

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/nav-item.tsx
git commit -m "style: update NavItem with expanded/collapsed states and token styling"
```

---

### Task 5: Header Redesign with Mobile Hamburger

**Files:**
- Modify: `src/components/layout/header.tsx`

- [ ] **Step 1: Rewrite the header component**

Replace the entire contents of `src/components/layout/header.tsx` with:

```tsx
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
              rootBox: 'text-sm',
              organizationSwitcherTrigger:
                'text-[var(--text-secondary)] hover:text-white py-1 px-2 rounded-md hover:bg-[var(--bg-surface-raised)]',
            },
          }}
        />
        <UserButton />
      </div>
    </header>
  )
}
```

Note: Header is now a client component because it uses `useSidebar`. It was already effectively a client boundary due to Clerk components.

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/header.tsx
git commit -m "style: redesign header with token styling and mobile hamburger"
```

---

### Task 6: Dashboard Layout — Wire Sidebar Context

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Update dashboard layout to use SidebarProvider**

Replace the entire contents of `src/app/(dashboard)/layout.tsx` with:

```tsx
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
```

- [ ] **Step 2: Create the DashboardMain client component**

Create `src/app/(dashboard)/dashboard-main.tsx`:

```tsx
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
```

On mobile (<1024px) the `lg:ml-*` class means no margin is applied (sidebar is a drawer overlay).

- [ ] **Step 3: Verify the shell works**

Run: `cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/layout.tsx src/app/(dashboard)/dashboard-main.tsx
git commit -m "style: wire SidebarProvider into dashboard layout with responsive margins"
```

---

### Task 7: Root Layout — Ensure Body Tokens

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Verify root layout uses token-based body styling**

The root layout's `<body>` tag should not have hardcoded background colors. The current file looks correct — `globals.css` handles body styling. No changes needed unless the body tag has inline styles.

Read `src/app/layout.tsx` and confirm no hardcoded `bg-*` or `style` attributes on `<body>`. If clean, skip to commit.

- [ ] **Step 2: Commit Phase 1 checkpoint (if any changes)**

If no changes needed, skip this step. Phase 1 is complete.

---

## Phase 2 — Shared UI Primitives

### Task 8: Restyle Button Component

**Files:**
- Modify: `src/components/ui/button.tsx`

- [ ] **Step 1: Update button with token-based styling**

Replace the entire contents of `src/components/ui/button.tsx` with:

```tsx
import { clsx } from 'clsx'

type ButtonBaseProps = {
  variant?: 'primary' | 'ghost' | 'outline'
  size?: 'sm' | 'md'
  className?: string
  children: React.ReactNode
  disabled?: boolean
}

type ButtonAsButton = ButtonBaseProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & { as?: 'button' }

type ButtonAsSpan = ButtonBaseProps &
  React.HTMLAttributes<HTMLSpanElement> & { as: 'span' }

type ButtonProps = ButtonAsButton | ButtonAsSpan

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  disabled,
  as: Tag = 'button',
  ...props
}: ButtonProps) {
  const classes = clsx(
    'inline-flex items-center justify-center font-medium transition-all duration-[var(--transition-base)]',
    `rounded-[var(--radius-btn)]`,
    'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
    {
      'bg-[var(--accent-indigo)] text-white hover:bg-[var(--accent-indigo-hover)] shadow-[0_0_12px_rgba(99,102,241,0.15)]': variant === 'primary',
      'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-raised)]': variant === 'ghost',
      'border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent-indigo)] hover:text-[var(--text-primary)]': variant === 'outline',
      'px-3 py-1.5 text-sm': size === 'sm',
      'px-4 py-2 text-sm': size === 'md',
      'opacity-50 cursor-not-allowed': disabled,
    },
    className,
  )

  if (Tag === 'span') {
    return (
      <span className={classes} {...(props as React.HTMLAttributes<HTMLSpanElement>)}>
        {children}
      </span>
    )
  }

  return (
    <button
      className={classes}
      disabled={disabled}
      {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/button.tsx
git commit -m "style: restyle Button with design tokens and focus ring"
```

---

### Task 9: Restyle Badge Component

**Files:**
- Modify: `src/components/ui/badge.tsx`

- [ ] **Step 1: Update badge with token-based styling**

Replace the entire contents of `src/components/ui/badge.tsx` with:

```tsx
import { clsx } from 'clsx'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'muted'
}

export function Badge({ children, variant = 'default' }: BadgeProps) {
  return (
    <span
      className={clsx(
        `inline-flex items-center px-2 py-0.5 rounded-[var(--radius-badge)] text-xs font-medium`,
        {
          'bg-[var(--accent-indigo-glow)] text-[var(--accent-indigo)]': variant === 'default',
          'bg-[var(--status-success-bg)] text-[var(--status-success)]': variant === 'success',
          'bg-[var(--status-warning-bg)] text-[var(--status-warning)]': variant === 'warning',
          'bg-[var(--status-danger-bg)] text-[var(--status-danger)]': variant === 'danger',
          'bg-[var(--bg-surface-raised)] text-[var(--text-secondary)]': variant === 'muted',
        },
      )}
    >
      {children}
    </span>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/badge.tsx
git commit -m "style: restyle Badge with design tokens"
```

---

### Task 10: Restyle Input Component

**Files:**
- Modify: `src/components/ui/input.tsx`

- [ ] **Step 1: Update input with token-based styling**

Replace the entire contents of `src/components/ui/input.tsx` with:

```tsx
import { clsx } from 'clsx'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={clsx(
        'w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)]',
        `rounded-[var(--radius-btn)] px-3 py-2 text-sm`,
        'placeholder:text-[var(--text-muted)]',
        'focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)]',
        'transition-all duration-[var(--transition-base)]',
        className,
      )}
      {...props}
    />
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/input.tsx
git commit -m "style: restyle Input with design tokens and focus ring"
```

---

### Task 11: Create Shared StatCard Component

**Files:**
- Create: `src/components/ui/stat-card.tsx`

- [ ] **Step 1: Create the shared StatCard component**

Create `src/components/ui/stat-card.tsx`:

```tsx
import { clsx } from 'clsx'

interface StatCardProps {
  label: string
  value: number
  sub?: string
  accent?: 'success' | 'warning' | 'danger' | 'cyan'
}

const ACCENT_COLORS: Record<string, string> = {
  success: 'border-l-[var(--status-success)]',
  warning: 'border-l-[var(--status-warning)]',
  danger: 'border-l-[var(--status-danger)]',
  cyan: 'border-l-[var(--accent-cyan)]',
}

const VALUE_COLORS: Record<string, string> = {
  success: 'text-[var(--status-success)]',
  warning: 'text-[var(--status-warning)]',
  danger: 'text-[var(--status-danger)]',
  cyan: 'text-[var(--accent-cyan)]',
}

export function StatCard({ label, value, sub, accent }: StatCardProps) {
  return (
    <div
      className={clsx(
        'bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-5',
        'shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)]',
        'transition-all duration-[var(--transition-base)]',
        accent && 'border-l-[3px]',
        accent && ACCENT_COLORS[accent],
      )}
    >
      <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide font-medium mb-2">
        {label}
      </p>
      <p
        className={clsx(
          'text-3xl font-semibold tabular-nums',
          accent ? VALUE_COLORS[accent] : 'text-[var(--text-primary)]',
        )}
      >
        {value.toLocaleString()}
      </p>
      {sub !== undefined && (
        <p className="text-[var(--text-muted)] text-xs mt-1">{sub}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx next build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/stat-card.tsx
git commit -m "feat: add shared StatCard component with token-based styling"
```

---

## Phase 3 — Page Polish

### Task 12: Restyle Dashboard Page

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: Update dashboard page to use StatCard and tokens**

Replace the entire contents of `src/app/(dashboard)/dashboard/page.tsx` with:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { StatCard } from '@/components/ui/stat-card'
import { RepliesTable } from '@/features/replies/components/replies-table'
import { getReplies } from '@/features/replies/server/get-replies'
import { getDashboardSummary } from '@/features/dashboard/server/get-dashboard-summary'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function DashboardPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/sign-in')
  }

  const org = await resolveOrganization(orgId)

  const [summary, { replies: recentReplies }] = await Promise.all([
    getDashboardSummary({ organizationId: org.id }),
    getReplies({ organizationId: org.id, limit: 5 }),
  ])

  const positiveRate =
    summary.replies > 0
      ? `${((summary.positiveReplies / summary.replies) * 100).toFixed(1)}% positive`
      : undefined

  return (
    <>
      <Header title="Dashboard" />
      <div className="flex-1 p-6 space-y-8">

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Leads"         value={summary.leads} />
          <StatCard label="Campaigns"     value={summary.campaigns} accent="cyan" />
          <StatCard label="Messages Sent" value={summary.messagesSent} />
          <StatCard label="Replies"       value={summary.replies} sub={positiveRate} accent="success" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[var(--text-muted)] text-xs uppercase tracking-wide font-medium">
              Recent Replies
            </h2>
            <Link
              href="/replies"
              className="text-[var(--accent-indigo)] text-xs hover:text-[var(--accent-indigo-hover)] transition-colors"
            >
              View all &rarr;
            </Link>
          </div>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
            <RepliesTable replies={recentReplies} />
          </div>
        </div>

        <div className="flex gap-3">
          <Link
            href="/analytics"
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Full analytics &rarr;
          </Link>
        </div>

      </div>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(dashboard)/dashboard/page.tsx
git commit -m "style: restyle dashboard page with StatCard and design tokens"
```

---

### Task 13: Restyle KPI Grid

**Files:**
- Modify: `src/features/analytics/components/kpi-grid.tsx`

- [ ] **Step 1: Update KpiGrid to use shared StatCard**

Replace the entire contents of `src/features/analytics/components/kpi-grid.tsx` with:

```tsx
import { StatCard } from '@/components/ui/stat-card'
import type { AnalyticsDTO } from '../types'

interface KpiGridProps {
  analytics: AnalyticsDTO
}

function pct(numerator: number, denominator: number): string | undefined {
  if (denominator === 0) return undefined
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

export function KpiGrid({ analytics }: KpiGridProps) {
  const { sent, delivered, opened, clicked, replies, positiveReplies, bounced, unsubscribes } = analytics

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard label="Sent"             value={sent} />
      <StatCard label="Delivered"        value={delivered}       sub={pct(delivered, sent) ? `${pct(delivered, sent)} rate` : undefined} />
      <StatCard label="Opened"           value={opened}          sub={pct(opened, sent) ? `${pct(opened, sent)} rate` : undefined}          accent="success" />
      <StatCard label="Clicked"          value={clicked}         sub={pct(clicked, sent) ? `${pct(clicked, sent)} rate` : undefined}          accent="cyan" />
      <StatCard label="Replies"          value={replies} />
      <StatCard label="Positive Replies" value={positiveReplies} sub={pct(positiveReplies, replies) ? `${pct(positiveReplies, replies)} rate` : undefined} accent="success" />
      <StatCard label="Bounced"          value={bounced}         sub={pct(bounced, sent) ? `${pct(bounced, sent)} rate` : undefined}          accent="danger" />
      <StatCard label="Unsubscribes"     value={unsubscribes}    sub={pct(unsubscribes, sent) ? `${pct(unsubscribes, sent)} rate` : undefined}     accent="danger" />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/analytics/components/kpi-grid.tsx
git commit -m "style: refactor KpiGrid to use shared StatCard"
```

---

### Task 14: Restyle Analytics Page

**Files:**
- Modify: `src/app/(dashboard)/analytics/page.tsx`

- [ ] **Step 1: Update analytics page with tokens**

Replace the entire contents of `src/app/(dashboard)/analytics/page.tsx` with:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { KpiGrid } from '@/features/analytics/components/kpi-grid'
import { getAnalytics } from '@/features/analytics/server/get-analytics'
import { RepliesTable } from '@/features/replies/components/replies-table'
import { getReplies } from '@/features/replies/server/get-replies'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function AnalyticsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)

  const [analytics, { replies: recentReplies }] = await Promise.all([
    getAnalytics({ organizationId: org.id }),
    getReplies({ organizationId: org.id, limit: 5 }),
  ])

  return (
    <>
      <Header title="Analytics" />
      <div className="flex-1 p-6 space-y-8">

        <KpiGrid analytics={analytics} />

        <div>
          <h2 className="text-[var(--text-muted)] text-xs uppercase tracking-wide font-medium mb-3">
            Recent Replies
          </h2>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
            <RepliesTable replies={recentReplies} />
          </div>
        </div>

        <p className="text-[var(--text-muted)] text-xs leading-relaxed">
          Delivered, opened, clicked, bounced, and unsubscribe counts reflect unique emails (one message counted once per event type regardless of how many events were received). Positive replies are classified by AI.
        </p>

      </div>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(dashboard)/analytics/page.tsx
git commit -m "style: restyle analytics page with design tokens"
```

---

### Task 15: Restyle Leads Page

**Files:**
- Modify: `src/app/(dashboard)/leads/page.tsx`
- Modify: `src/app/(dashboard)/leads/leads-client.tsx`
- Modify: `src/features/leads/components/leads-table.tsx`
- Modify: `src/features/leads/components/csv-upload-form.tsx`

- [ ] **Step 1: Update leads page.tsx**

Replace the entire contents of `src/app/(dashboard)/leads/page.tsx` with:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { LeadsPageClient } from './leads-client'
import { getLeads } from '@/features/leads/server/get-leads'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function LeadsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const { leads, total } = await getLeads({ organizationId: org.id })

  return (
    <>
      <Header title="Leads" />
      <div className="flex-1 p-6">
        <LeadsPageClient initialLeads={leads} initialTotal={total} />
      </div>
    </>
  )
}
```

Note: The original `leads/page.tsx` had an inline table and was not using the `LeadsPageClient`. But looking at the actual file tree, `leads-client.tsx` exists and uses `LeadsTable`. The original `page.tsx` at line 46 duplicated a table inline. We replace it to use `LeadsPageClient` which already handles CSV upload, draft generation, etc.

- [ ] **Step 2: Update leads-client.tsx with tokens**

In `src/app/(dashboard)/leads/leads-client.tsx`, replace all hardcoded colors with tokens. The full replacement:

```tsx
'use client'

import { useState } from 'react'
import { CsvUploadForm } from '@/features/leads/components/csv-upload-form'
import { LeadsTable } from '@/features/leads/components/leads-table'
import { DraftReviewDrawer } from '@/features/drafts/components/draft-review-drawer'
import type { LeadDTO, ImportBatchResult } from '@/features/leads/types'
import type { DraftDTO, DraftWithLeadDTO } from '@/features/drafts/types'

interface LeadsPageClientProps {
  initialLeads: LeadDTO[]
  initialTotal: number
}

export function LeadsPageClient({ initialLeads, initialTotal }: LeadsPageClientProps) {
  const [leads, setLeads] = useState<LeadDTO[]>(initialLeads)
  const [total, setTotal] = useState(initialTotal)
  const [lastBatch, setLastBatch] = useState<ImportBatchResult['batch'] | null>(null)

  const [draftsByLeadId, setDraftsByLeadId] = useState<Map<string, DraftWithLeadDTO>>(new Map())
  const [reviewingDraft, setReviewingDraft] = useState<DraftWithLeadDTO | null>(null)
  const [generatingLeadId, setGeneratingLeadId] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)

  const pendingDrafts = new Map(
    [...draftsByLeadId.entries()]
      .filter(([, d]) => d.status === 'PENDING_REVIEW')
      .map(([leadId, d]) => [leadId, d.id]),
  )

  function handleImportSuccess(result: ImportBatchResult) {
    setLeads((prev) => {
      const existingIds = new Set(prev.map((l) => l.id))
      const newLeads = result.leads.filter((l) => !existingIds.has(l.id))
      return [...newLeads, ...prev]
    })
    setTotal((prev) => prev + result.batch.successCount)
    setLastBatch(result.batch)
  }

  function buildDraftWithLead(draft: DraftDTO, leadId: string): DraftWithLeadDTO {
    const lead = leads.find((l) => l.id === leadId)
    return {
      ...draft,
      lead: {
        id: lead?.id ?? leadId,
        email: lead?.email ?? '',
        firstName: lead?.firstName ?? null,
        lastName: lead?.lastName ?? null,
        company: lead?.company ?? null,
      },
    }
  }

  async function handleGenerateDraft(leadId: string) {
    setGeneratingLeadId(leadId)
    setGenerationError(null)
    try {
      const res = await fetch('/api/drafts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })

      const data = await res.json().catch(() => null) as
        | DraftDTO
        | { code: string; draftId: string; message: string }
        | { error?: string }
        | null

      if (res.status === 409 && data && 'code' in data && data.code === 'PENDING_DRAFT_EXISTS') {
        const placeholderDto: DraftDTO = {
          id: (data as { code: string; draftId: string; message: string }).draftId,
          organizationId: '',
          leadId,
          subject: '',
          body: '',
          status: 'PENDING_REVIEW',
          promptTemplateId: null,
          createdByClerkId: null,
          approvedByClerkId: null,
          approvedAt: null,
          rejectedAt: null,
          rejectionReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        setDraftsByLeadId((prev) => new Map(prev).set(leadId, buildDraftWithLead(placeholderDto, leadId)))
        return
      }

      if (!res.ok) {
        const errData = data as { error?: string } | null
        setGenerationError(errData?.error ?? 'Failed to generate draft. Please try again.')
        return
      }

      const draft = buildDraftWithLead(data as DraftDTO, leadId)
      setDraftsByLeadId((prev) => new Map(prev).set(leadId, draft))
      setReviewingDraft(draft)
    } finally {
      setGeneratingLeadId(null)
    }
  }

  function handleReviewDraft(leadId: string) {
    const draft = draftsByLeadId.get(leadId)
    if (draft) setReviewingDraft(draft)
  }

  function handleDraftReviewed(updatedDraft: DraftDTO) {
    setDraftsByLeadId((prev) => new Map(prev).set(updatedDraft.leadId, buildDraftWithLead(updatedDraft, updatedDraft.leadId)))
    setReviewingDraft(null)
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-secondary)] text-sm">
              {total.toLocaleString()} lead{total !== 1 ? 's' : ''}
            </span>
            {lastBatch && (
              <span className="text-[var(--status-success)] text-xs">
                + {lastBatch.successCount} imported
              </span>
            )}
            {generationError && (
              <span className="text-[var(--status-danger)] text-xs">{generationError}</span>
            )}
          </div>
          <CsvUploadForm onSuccess={handleImportSuccess} />
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
          <LeadsTable
            leads={leads}
            pendingDrafts={pendingDrafts}
            onGenerateDraft={handleGenerateDraft}
            onReviewDraft={handleReviewDraft}
            generatingLeadId={generatingLeadId}
          />
        </div>
      </div>

      <DraftReviewDrawer
        draft={reviewingDraft}
        onClose={() => setReviewingDraft(null)}
        onReviewed={handleDraftReviewed}
      />
    </>
  )
}
```

- [ ] **Step 3: Update leads-table.tsx with tokens**

Replace the entire contents of `src/features/leads/components/leads-table.tsx` with:

```tsx
import { Badge } from '@/components/ui/badge'
import type { LeadDTO } from '../types'

interface LeadsTableProps {
  leads: LeadDTO[]
  pendingDrafts?: Map<string, string>
  onGenerateDraft?: (leadId: string) => Promise<void>
  onReviewDraft?: (leadId: string) => void
  generatingLeadId?: string | null
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-[var(--text-muted)] text-xs">&mdash;</span>
  const variant = score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger'
  return <Badge variant={variant}>{score}</Badge>
}

function StatusBadge({ status }: { status: LeadDTO['status'] }) {
  const variantMap: Record<LeadDTO['status'], 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
    NEW: 'default',
    CONTACTED: 'warning',
    REPLIED: 'success',
    BOUNCED: 'danger',
    UNSUBSCRIBED: 'danger',
    CONVERTED: 'success',
  }
  return <Badge variant={variantMap[status]}>{status}</Badge>
}

export function LeadsTable({
  leads,
  pendingDrafts,
  onGenerateDraft,
  onReviewDraft,
  generatingLeadId,
}: LeadsTableProps) {
  const showActions = !!onGenerateDraft

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-[var(--text-muted)] text-sm">No leads yet.</p>
        <p className="text-[var(--text-muted)] text-xs mt-1 opacity-60">Import a CSV to get started.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-default)]">
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Name</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Company</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Title</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Score</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide hidden lg:table-cell">Score Reason</th>
            {showActions && (
              <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Actions</th>
            )}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const hasPendingDraft = pendingDrafts?.has(lead.id) ?? false
            const isGenerating = generatingLeadId === lead.id

            return (
              <tr
                key={lead.id}
                className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)]"
              >
                <td className="py-3 px-4">
                  <div className="text-[var(--text-primary)] font-medium">
                    {[lead.firstName, lead.lastName].filter(Boolean).join(' ') || '\u2014'}
                  </div>
                  <div className="text-[var(--text-muted)] text-xs">{lead.email}</div>
                </td>
                <td className="py-3 px-4 text-[var(--text-secondary)]">{lead.company ?? '\u2014'}</td>
                <td className="py-3 px-4 text-[var(--text-secondary)]">{lead.title ?? '\u2014'}</td>
                <td className="py-3 px-4"><StatusBadge status={lead.status} /></td>
                <td className="py-3 px-4"><ScoreBadge score={lead.score} /></td>
                <td className="py-3 px-4 text-[var(--text-muted)] text-xs hidden lg:table-cell max-w-xs truncate">
                  {lead.scoreReason ?? '\u2014'}
                </td>
                {showActions && (
                  <td className="py-3 px-4">
                    {hasPendingDraft ? (
                      <button
                        onClick={() => onReviewDraft?.(lead.id)}
                        className="text-xs text-[var(--accent-indigo)] hover:text-[var(--accent-indigo-hover)] transition-colors font-medium"
                      >
                        Review Draft
                      </button>
                    ) : (
                      <button
                        onClick={() => void onGenerateDraft?.(lead.id)}
                        disabled={isGenerating}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-50 transition-colors"
                      >
                        {isGenerating ? 'Generating\u2026' : 'Generate Draft'}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Update csv-upload-form.tsx with tokens**

Replace the entire contents of `src/features/leads/components/csv-upload-form.tsx` with:

```tsx
'use client'

import { useState, useRef } from 'react'
import { Upload, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ImportBatchResult } from '../types'

const SAMPLE_CSV = [
  'email,firstName,lastName,company,title',
  'alice@acme.com,Alice,Smith,Acme Corp,VP of Engineering',
  'bob@widgets.io,Bob,Jones,Widgets Inc,Head of Product',
].join('\n')

function downloadSampleCsv() {
  const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'sample-leads.csv'
  a.click()
  URL.revokeObjectURL(url)
}

interface CsvUploadFormProps {
  onSuccess: (result: ImportBatchResult) => void
}

export function CsvUploadForm({ onSuccess }: CsvUploadFormProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/leads/import', {
        method: 'POST',
        body: formData,
      })

      const data = (await response.json()) as ImportBatchResult & { error?: string }

      if (!response.ok) {
        setError(data.error ?? 'Import failed')
        return
      }

      onSuccess(data)
    } catch {
      setError('Network error \u2014 please try again.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileChange}
          id="csv-upload"
        />
        <button
          type="button"
          onClick={downloadSampleCsv}
          className="flex items-center gap-1.5 text-xs text-[var(--accent-indigo)] hover:text-[var(--accent-indigo-hover)] transition-colors"
        >
          <Download size={12} />
          Sample CSV
        </button>
        <label htmlFor="csv-upload">
          <Button
            as="span"
            variant="primary"
            size="sm"
            disabled={uploading}
            className="cursor-pointer"
          >
            <Upload size={14} className="mr-2" />
            {uploading ? 'Importing...' : 'Import CSV'}
          </Button>
        </label>
      </div>
      <p className="text-[var(--text-muted)] text-xs">
        Required: <span className="text-[var(--text-secondary)]">email</span>
        {' \u00B7 '}
        Optional: <span className="text-[var(--text-secondary)]">firstName, lastName, company, title</span>
      </p>
      {error && (
        <span className="text-[var(--status-danger)] text-xs">{error}</span>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/leads/page.tsx src/app/(dashboard)/leads/leads-client.tsx src/features/leads/components/leads-table.tsx src/features/leads/components/csv-upload-form.tsx
git commit -m "style: restyle leads page and components with design tokens"
```

---

### Task 16: Restyle Drafts Pages

**Files:**
- Modify: `src/app/(dashboard)/drafts/drafts-client.tsx`
- Modify: `src/features/drafts/components/drafts-table.tsx`
- Modify: `src/features/drafts/components/draft-review-drawer.tsx`

- [ ] **Step 1: Update drafts-client.tsx with tokens**

Replace the entire contents of `src/app/(dashboard)/drafts/drafts-client.tsx` with:

```tsx
'use client'

import { useState, useMemo } from 'react'
import { DraftsTable } from '@/features/drafts/components/drafts-table'
import { DraftReviewDrawer } from '@/features/drafts/components/draft-review-drawer'
import type { DraftWithLeadDTO, DraftDTO } from '@/features/drafts/types'

type StatusFilter = 'all' | 'pending' | 'approved'

interface DraftsClientProps {
  initialDrafts: DraftWithLeadDTO[]
  initialTotal: number
}

export function DraftsClient({ initialDrafts, initialTotal }: DraftsClientProps) {
  const [drafts, setDrafts] = useState<DraftWithLeadDTO[]>(initialDrafts)
  const [total, setTotal] = useState(initialTotal)
  const [reviewingDraft, setReviewingDraft] = useState<DraftWithLeadDTO | null>(null)
  const [sendingDraftId, setSendingDraftId] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')

  const pendingCount  = useMemo(() => drafts.filter((d) => d.status === 'PENDING_REVIEW').length, [drafts])
  const approvedCount = useMemo(() => drafts.filter((d) => d.status === 'APPROVED').length, [drafts])

  const visibleDrafts = useMemo(() => {
    if (filter === 'pending')  return drafts.filter((d) => d.status === 'PENDING_REVIEW')
    if (filter === 'approved') return drafts.filter((d) => d.status === 'APPROVED')
    return drafts
  }, [drafts, filter])

  function handleReview(draft: DraftWithLeadDTO) {
    setSendError(null)
    setReviewingDraft(draft)
  }

  function handleDraftReviewed(updatedDraft: DraftDTO) {
    if (updatedDraft.status === 'APPROVED') {
      setDrafts((prev) =>
        prev.map((d) => (d.id === updatedDraft.id ? { ...d, ...updatedDraft } : d)),
      )
    } else {
      setDrafts((prev) => prev.filter((d) => d.id !== updatedDraft.id))
      setTotal((prev) => Math.max(0, prev - 1))
    }
    setReviewingDraft(null)
  }

  async function handleSend(draft: DraftWithLeadDTO) {
    setSendingDraftId(draft.id)
    setSendError(null)

    const res = await fetch(`/api/drafts/${draft.id}/send`, { method: 'POST' })
    const data = await res.json().catch(() => null)

    setSendingDraftId(null)

    if (!res.ok) {
      const message =
        data?.code === 'MAILBOX_LIMIT_EXCEEDED'
          ? 'Daily send limit reached. Try again tomorrow.'
          : data?.code === 'NO_ACTIVE_MAILBOX'
            ? 'No active mailbox configured. Add a mailbox in Settings.'
            : data?.code === 'DRAFT_ALREADY_SENT'
              ? 'This draft has already been sent.'
              : (data?.error ?? 'Failed to send \u2014 please try again.')
      setSendError(message)
      return
    }

    setDrafts((prev) => prev.filter((d) => d.id !== draft.id))
    setTotal((prev) => Math.max(0, prev - 1))
  }

  return (
    <>
      <div className="space-y-4">

        {pendingCount > 0 && (
          <div className="flex items-center justify-between bg-[var(--status-warning-bg)] border border-[var(--status-warning)]/30 rounded-[var(--radius-card)] px-4 py-3">
            <p className="text-[var(--status-warning)] text-sm font-medium">
              {pendingCount} draft{pendingCount !== 1 ? 's' : ''} pending review
            </p>
            <button
              onClick={() => setFilter('pending')}
              className="text-[var(--status-warning)] text-xs underline hover:no-underline transition-all"
            >
              Review now &rarr;
            </button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            <TabButton
              active={filter === 'all'}
              onClick={() => setFilter('all')}
              label="All"
              count={total}
            />
            <TabButton
              active={filter === 'pending'}
              onClick={() => setFilter('pending')}
              label="Pending"
              count={pendingCount}
              highlight={pendingCount > 0}
            />
            <TabButton
              active={filter === 'approved'}
              onClick={() => setFilter('approved')}
              label="Approved"
              count={approvedCount}
            />
          </div>
        </div>

        {sendError && (
          <div className="text-[var(--status-danger)] text-sm bg-[var(--status-danger-bg)] border border-[var(--status-danger)]/30 rounded-[var(--radius-btn)] px-4 py-2">
            {sendError}
          </div>
        )}

        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
          <DraftsTable
            drafts={visibleDrafts}
            onReview={handleReview}
            onSend={handleSend}
            sendingDraftId={sendingDraftId}
          />
        </div>
      </div>

      <DraftReviewDrawer
        draft={reviewingDraft}
        onClose={() => setReviewingDraft(null)}
        onReviewed={handleDraftReviewed}
      />
    </>
  )
}

interface TabButtonProps {
  active: boolean
  onClick: () => void
  label: string
  count: number
  highlight?: boolean
}

function TabButton({ active, onClick, label, count, highlight }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-btn)] text-xs font-medium transition-colors duration-[var(--transition-base)]',
        active
          ? 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)]'
          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
      ].join(' ')}
    >
      {label}
      <span
        className={[
          'inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-xs px-1',
          active
            ? highlight
              ? 'bg-[var(--status-warning)] text-[var(--text-inverse)]'
              : 'bg-[var(--bg-surface-overlay)] text-[var(--text-secondary)]'
            : highlight
              ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)]'
              : 'bg-[var(--bg-surface-raised)] text-[var(--text-muted)]',
        ].join(' ')}
      >
        {count}
      </span>
    </button>
  )
}
```

- [ ] **Step 2: Update drafts-table.tsx with tokens**

Replace the entire contents of `src/features/drafts/components/drafts-table.tsx` with:

```tsx
import { Badge } from '@/components/ui/badge'
import type { DraftDTO, DraftWithLeadDTO } from '@/features/drafts/types'

interface DraftsTableProps {
  drafts: DraftWithLeadDTO[]
  onReview: (draft: DraftWithLeadDTO) => void
  onSend?: (draft: DraftWithLeadDTO) => Promise<void>
  sendingDraftId?: string | null
}

export function DraftsTable({ drafts, onReview, onSend, sendingDraftId }: DraftsTableProps) {
  if (drafts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-[var(--text-secondary)] text-sm">No drafts to review.</p>
        <p className="text-[var(--text-muted)] text-xs mt-1">Generate drafts from a campaign to get started.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-default)]">
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Lead</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Subject</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide hidden md:table-cell">Created</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft) => {
            const displayName =
              [draft.lead.firstName, draft.lead.lastName].filter(Boolean).join(' ') ||
              draft.lead.email
            const isSending = sendingDraftId === draft.id

            return (
              <tr key={draft.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)]">
                <td className="px-4 py-3">
                  <div className="text-[var(--text-primary)]">{displayName}</div>
                  <div className="text-[var(--text-secondary)] text-xs">{draft.lead.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[var(--text-primary)] truncate block max-w-[200px]">{draft.subject}</span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={draft.status} />
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)] hidden md:table-cell">
                  {new Date(draft.createdAt).toLocaleDateString('en-US')}
                </td>
                <td className="px-4 py-3">
                  {draft.status === 'PENDING_REVIEW' && (
                    <button
                      onClick={() => onReview(draft)}
                      aria-label={`Review draft for ${displayName}`}
                      className="text-xs px-3 py-1 rounded-[var(--radius-btn)] bg-[var(--bg-surface-raised)] hover:bg-[var(--accent-indigo)] text-[var(--text-primary)] transition-colors duration-[var(--transition-base)]"
                    >
                      Review
                    </button>
                  )}
                  {draft.status === 'APPROVED' && onSend && (
                    <button
                      onClick={() => void onSend(draft)}
                      disabled={isSending}
                      aria-label={`Send draft to ${displayName}`}
                      className="text-xs px-3 py-1 rounded-[var(--radius-btn)] bg-[var(--status-success-bg)] hover:bg-[var(--status-success)]/25 text-[var(--status-success)] transition-colors duration-[var(--transition-base)] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSending ? 'Sending\u2026' : 'Send'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function StatusBadge({ status }: { status: DraftDTO['status'] }) {
  if (status === 'PENDING_REVIEW') {
    return <Badge variant="warning">Pending Review</Badge>
  }
  if (status === 'APPROVED') {
    return <Badge variant="success">Approved</Badge>
  }
  return <Badge variant="danger">Rejected</Badge>
}
```

- [ ] **Step 3: Update draft-review-drawer.tsx with tokens**

Replace the entire contents of `src/features/drafts/components/draft-review-drawer.tsx` with:

```tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import type { DraftDTO, DraftWithLeadDTO } from '../types'

interface DraftReviewDrawerProps {
  draft: DraftWithLeadDTO | null
  onClose: () => void
  onReviewed: (draft: DraftDTO) => void
}

export function DraftReviewDrawer({ draft, onClose, onReviewed }: DraftReviewDrawerProps) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (draft) {
      setSubject(draft.subject)
      setBody(draft.body)
      setShowRejectInput(false)
      setRejectionReason('')
      setError(null)
    }
  }, [draft?.id])

  useEffect(() => {
    if (!draft) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [draft, submitting, onClose])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  if (!draft) return null

  const leadName =
    [draft.lead.firstName, draft.lead.lastName].filter(Boolean).join(' ') ||
    draft.lead.email

  async function handleApprove() {
    if (!draft) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/drafts/${draft.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          subject: subject !== draft.subject ? subject : undefined,
          body: body !== draft.body ? body : undefined,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const data = (await res.json()) as { message?: string; error?: string }
        setError(data.message ?? data.error ?? 'Failed to approve draft')
        return
      }
      const updated = (await res.json()) as DraftDTO
      onReviewed(updated)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReject() {
    if (!draft) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/drafts/${draft.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          rejectionReason: rejectionReason || undefined,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const data = (await res.json()) as { message?: string; error?: string }
        setError(data.message ?? data.error ?? 'Failed to reject draft')
        return
      }
      const updated = (await res.json()) as DraftDTO
      onReviewed(updated)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={submitting ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-review-title"
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-[var(--bg-base)] border-l border-[var(--border-default)] z-50 flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <h2 id="draft-review-title" className="text-[var(--text-primary)] font-semibold text-sm">
            Review Draft
          </h2>
          <button
            onClick={submitting ? undefined : onClose}
            disabled={submitting}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-lg leading-none disabled:opacity-50"
            aria-label="Close"
          >
            \u2715
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">

          {/* Lead context panel */}
          <div className="px-5 py-4 bg-[var(--bg-surface)] border-b border-[var(--border-default)]">
            <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide font-medium mb-2">To</p>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[var(--text-primary)] text-sm font-medium">{leadName}</p>
                {leadName !== draft.lead.email && (
                  <p className="text-[var(--text-secondary)] text-xs mt-0.5">{draft.lead.email}</p>
                )}
                {draft.lead.company && (
                  <p className="text-[var(--text-muted)] text-xs mt-0.5">{draft.lead.company}</p>
                )}
              </div>
              {draft.promptTemplateId && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-badge)] text-xs font-medium bg-[var(--accent-indigo-glow)] text-[var(--accent-indigo)]">
                  \u2726 AI Generated
                </span>
              )}
            </div>
          </div>

          {/* Editable email content */}
          <div className="px-5 py-4 space-y-4">
            <div>
              <label
                htmlFor="draft-subject"
                className="block text-[var(--text-muted)] text-xs font-medium uppercase tracking-wide mb-1"
              >
                Subject
              </label>
              <input
                id="draft-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-btn)] px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] transition-all duration-[var(--transition-base)]"
                disabled={submitting}
              />
            </div>

            <div>
              <label
                htmlFor="draft-body"
                className="block text-[var(--text-muted)] text-xs font-medium uppercase tracking-wide mb-1"
              >
                Body
              </label>
              <textarea
                id="draft-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-btn)] px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] resize-none font-mono leading-relaxed transition-all duration-[var(--transition-base)]"
                disabled={submitting}
              />
              {(subject !== draft.subject || body !== draft.body) && (
                <p className="text-[var(--status-warning)] text-xs mt-1">Edited \u2014 will save on approve</p>
              )}
            </div>

            {showRejectInput && (
              <div>
                <label
                  htmlFor="draft-rejection-reason"
                  className="block text-[var(--text-muted)] text-xs font-medium uppercase tracking-wide mb-1"
                >
                  Rejection reason (optional)
                </label>
                <input
                  id="draft-rejection-reason"
                  type="text"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. Wrong tone, needs revision"
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-btn)] px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] transition-all duration-[var(--transition-base)]"
                  disabled={submitting}
                  autoFocus
                />
              </div>
            )}

            {error && (
              <p className="text-[var(--status-danger)] text-sm bg-[var(--status-danger-bg)] border border-[var(--status-danger)]/30 rounded-[var(--radius-btn)] px-3 py-2">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-[var(--border-default)] flex gap-2">
          {!showRejectInput ? (
            <>
              <button
                onClick={handleApprove}
                disabled={submitting}
                className="flex-1 bg-[var(--accent-indigo)] hover:bg-[var(--accent-indigo-hover)] disabled:opacity-50 text-white rounded-[var(--radius-btn)] px-4 py-2 text-sm font-medium transition-colors duration-[var(--transition-base)]"
              >
                {submitting ? 'Approving\u2026' : 'Approve'}
              </button>
              <button
                onClick={() => setShowRejectInput(true)}
                disabled={submitting}
                className="px-4 py-2 text-sm text-[var(--status-danger)] border border-[var(--status-danger)]/40 rounded-[var(--radius-btn)] hover:bg-[var(--status-danger-bg)] disabled:opacity-50 transition-colors duration-[var(--transition-base)]"
              >
                Reject
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleReject}
                disabled={submitting}
                className="flex-1 bg-[var(--status-danger)] hover:brightness-110 disabled:opacity-50 text-white rounded-[var(--radius-btn)] px-4 py-2 text-sm font-medium transition-colors duration-[var(--transition-base)]"
              >
                {submitting ? 'Rejecting\u2026' : 'Confirm Reject'}
              </button>
              <button
                onClick={() => setShowRejectInput(false)}
                disabled={submitting}
                className="px-4 py-2 text-sm text-[var(--text-muted)] border border-[var(--border-default)] rounded-[var(--radius-btn)] hover:bg-[var(--bg-surface-raised)] disabled:opacity-50 transition-colors duration-[var(--transition-base)]"
              >
                Back
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/drafts/drafts-client.tsx src/features/drafts/components/drafts-table.tsx src/features/drafts/components/draft-review-drawer.tsx
git commit -m "style: restyle drafts pages and drawer with design tokens"
```

---

### Task 17: Restyle Replies Pages

**Files:**
- Modify: `src/app/(dashboard)/replies/replies-client.tsx`
- Modify: `src/features/replies/components/replies-table.tsx`

- [ ] **Step 1: Update replies-client.tsx with tokens**

Replace the entire contents of `src/app/(dashboard)/replies/replies-client.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import type { ReplyClassification } from '@prisma/client'
import { RepliesTable } from '@/features/replies/components/replies-table'
import type { ReplyWithLeadDTO } from '@/features/replies/types'

const ALL_CLASSIFICATIONS: ReplyClassification[] = [
  'POSITIVE',
  'NEUTRAL',
  'NEGATIVE',
  'OUT_OF_OFFICE',
  'UNSUBSCRIBE_REQUEST',
  'REFERRAL',
  'UNKNOWN',
]

const CLASSIFICATION_LABELS: Record<ReplyClassification, string> = {
  POSITIVE:            'Positive',
  NEUTRAL:             'Neutral',
  NEGATIVE:            'Negative',
  OUT_OF_OFFICE:       'Out of Office',
  UNSUBSCRIBE_REQUEST: 'Unsubscribe',
  REFERRAL:            'Referral',
  UNKNOWN:             'Unknown',
}

interface RepliesClientProps {
  initialReplies: ReplyWithLeadDTO[]
  initialTotal: number
}

export function RepliesClient({ initialReplies, initialTotal }: RepliesClientProps) {
  const [filter, setFilter] = useState<ReplyClassification | 'ALL'>('ALL')

  const filtered =
    filter === 'ALL'
      ? initialReplies
      : initialReplies.filter((r) => r.classification === filter)

  const displayCount = filter === 'ALL' ? initialTotal : filtered.length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-[var(--text-secondary)] text-sm">
          {displayCount.toLocaleString()} repl{displayCount !== 1 ? 'ies' : 'y'}
        </span>

        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as ReplyClassification | 'ALL')}
          className="bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] text-xs rounded-[var(--radius-btn)] px-3 py-1.5 focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] transition-all duration-[var(--transition-base)]"
        >
          <option value="ALL">All Classifications</option>
          {ALL_CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {CLASSIFICATION_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
        <RepliesTable replies={filtered} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update replies-table.tsx with tokens**

Replace the entire contents of `src/features/replies/components/replies-table.tsx` with:

```tsx
'use client'

import { Badge } from '@/components/ui/badge'
import type { ReplyClassification } from '@prisma/client'
import type { ReplyWithLeadDTO } from '../types'

interface RepliesTableProps {
  replies: ReplyWithLeadDTO[]
}

const CLASSIFICATION_LABELS: Record<ReplyClassification, string> = {
  POSITIVE:            'Positive',
  NEUTRAL:             'Neutral',
  NEGATIVE:            'Negative',
  OUT_OF_OFFICE:       'Out of Office',
  UNSUBSCRIBE_REQUEST: 'Unsubscribe',
  REFERRAL:            'Referral',
  UNKNOWN:             'Unknown',
}

function ClassificationBadge({ value }: { value: ReplyClassification }) {
  const variantMap: Record<ReplyClassification, 'success' | 'muted' | 'danger' | 'warning' | 'default'> = {
    POSITIVE:            'success',
    NEUTRAL:             'muted',
    NEGATIVE:            'danger',
    OUT_OF_OFFICE:       'warning',
    UNSUBSCRIBE_REQUEST: 'danger',
    REFERRAL:            'default',
    UNKNOWN:             'muted',
  }
  return <Badge variant={variantMap[value]}>{CLASSIFICATION_LABELS[value]}</Badge>
}

export function RepliesTable({ replies }: RepliesTableProps) {
  if (replies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-[var(--text-secondary)] text-sm">No replies yet.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-default)]">
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Lead</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Classification</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Confidence</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide hidden lg:table-cell">Preview</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Received</th>
          </tr>
        </thead>
        <tbody>
          {replies.map((reply) => (
            <tr
              key={reply.id}
              className={
                reply.classification === 'POSITIVE'
                  ? 'border-b border-[var(--border-subtle)] bg-[var(--status-success-bg)] hover:bg-[var(--status-success-bg)] transition-colors duration-[var(--transition-fast)]'
                  : 'border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)]'
              }
            >
              <td className="py-3 px-4 text-[var(--text-primary)]">{reply.leadEmail}</td>
              <td className="py-3 px-4">
                <ClassificationBadge value={reply.classification} />
              </td>
              <td className="py-3 px-4 text-[var(--text-secondary)] text-xs">
                {reply.classificationConfidence !== null
                  ? `${Math.round(reply.classificationConfidence * 100)}%`
                  : '\u2014'}
              </td>
              <td className="py-3 px-4 text-[var(--text-muted)] text-xs hidden lg:table-cell max-w-xs truncate">
                {reply.rawBody.slice(0, 120)}
              </td>
              <td className="py-3 px-4 text-[var(--text-secondary)] text-xs">
                {new Date(reply.receivedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/replies/replies-client.tsx src/features/replies/components/replies-table.tsx
git commit -m "style: restyle replies pages with design tokens"
```

---

### Task 18: Restyle Campaigns Pages

**Files:**
- Modify: `src/app/(dashboard)/campaigns/page.tsx`
- Modify: `src/features/campaigns/components/campaign-card.tsx`
- Modify: `src/app/(dashboard)/campaigns/[id]/page.tsx`

- [ ] **Step 1: Update campaigns page.tsx with StatCard and tokens**

Replace the entire contents of `src/app/(dashboard)/campaigns/page.tsx` with:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { StatCard } from '@/components/ui/stat-card'
import { getCampaigns } from '@/features/campaigns/server/get-campaigns'
import { CampaignCard } from '@/features/campaigns/components/campaign-card'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-[var(--text-muted)] text-sm">No campaigns yet.</p>
      <p className="text-[var(--text-muted)] text-xs mt-1 opacity-60">
        Create a campaign to start sending outreach emails to your leads.
      </p>
    </div>
  )
}

export default async function CampaignsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const { campaigns, total } = await getCampaigns({ organizationId: org.id })

  const totalMessages = campaigns.reduce((s, c) => s + c.messageCount, 0)
  const totalPending  = campaigns.reduce((s, c) => s + c.draftPendingCount, 0)
  const totalReplies  = campaigns.reduce((s, c) => s + c.replyCount, 0)

  return (
    <>
      <Header title="Campaigns" />
      <div className="flex-1 p-6 space-y-6">

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Campaigns"      value={total} accent="cyan" />
          <StatCard label="Messages Sent"  value={totalMessages} />
          <StatCard label="Pending Drafts" value={totalPending} accent={totalPending > 0 ? 'warning' : undefined} />
          <StatCard label="Replies"        value={totalReplies} accent="success" />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[var(--text-secondary)] text-sm">
            {total} campaign{total !== 1 ? 's' : ''}
          </p>
          <Link
            href="/analytics"
            className="text-[var(--text-muted)] text-xs hover:text-[var(--text-secondary)] transition-colors"
          >
            Full analytics &rarr;
          </Link>
        </div>

        {campaigns.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {campaigns.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </div>
        )}

      </div>
    </>
  )
}
```

- [ ] **Step 2: Update campaign-card.tsx with tokens**

Replace the entire contents of `src/features/campaigns/components/campaign-card.tsx` with:

```tsx
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { CampaignSummaryDTO, CampaignStatus } from '@/features/campaigns/server/get-campaigns'

const STATUS_VARIANT: Record<CampaignStatus, 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
  DRAFT:     'muted',
  ACTIVE:    'success',
  PAUSED:    'warning',
  COMPLETED: 'default',
  ARCHIVED:  'muted',
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

export function CampaignCard({ campaign }: { campaign: CampaignSummaryDTO }) {
  const totalDrafts = campaign.draftPendingCount + campaign.draftApprovedCount

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-5 flex flex-col gap-3 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-glow)] transition-all duration-[var(--transition-base)]">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/campaigns/${campaign.id}`}
          className="text-[var(--text-primary)] font-semibold text-sm leading-snug hover:text-[var(--accent-indigo-hover)] transition-colors"
        >
          {campaign.name}
        </Link>
        <Badge variant={STATUS_VARIANT[campaign.status]}>
          {capitalize(campaign.status)}
        </Badge>
      </div>

      {campaign.description && (
        <p className="text-[var(--text-secondary)] text-xs leading-relaxed">
          {campaign.description}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 py-2 border-t border-[var(--border-subtle)]">
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide mb-0.5">Sent</p>
          <p className="text-[var(--text-primary)] text-sm font-medium tabular-nums">{campaign.messageCount.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide mb-0.5">Drafts</p>
          <p className="text-[var(--text-primary)] text-sm font-medium tabular-nums">
            {totalDrafts.toLocaleString()}
            {campaign.draftPendingCount > 0 && (
              <span className="text-[var(--status-warning)] text-xs ml-1">
                ({campaign.draftPendingCount} pending)
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide mb-0.5">Replies</p>
          <p className="text-[var(--text-primary)] text-sm font-medium tabular-nums">{campaign.replyCount.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[var(--text-muted)] text-xs">
          Created {campaign.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <Link
          href={`/campaigns/${campaign.id}`}
          className="text-[var(--accent-indigo)] text-xs hover:text-[var(--accent-indigo-hover)] transition-colors"
        >
          View Details &rarr;
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update campaign detail page with tokens**

Replace the entire contents of `src/app/(dashboard)/campaigns/[id]/page.tsx` with:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/ui/stat-card'
import { getCampaignDetail } from '@/features/campaigns/server/get-campaign-detail'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import type { CampaignStatus, DraftStatus, ReplyClassification } from '@prisma/client'
import type { CampaignDetailDraftDTO, CampaignDetailReplyDTO } from '@/features/campaigns/server/get-campaign-detail'

const CAMPAIGN_STATUS_VARIANT: Record<CampaignStatus, 'default' | 'success' | 'warning' | 'muted'> = {
  DRAFT:     'muted',
  ACTIVE:    'success',
  PAUSED:    'warning',
  COMPLETED: 'default',
  ARCHIVED:  'muted',
}

const DRAFT_STATUS_VARIANT: Record<DraftStatus, 'warning' | 'success' | 'danger'> = {
  PENDING_REVIEW: 'warning',
  APPROVED:       'success',
  REJECTED:       'danger',
}

const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  PENDING_REVIEW: 'Pending Review',
  APPROVED:       'Approved',
  REJECTED:       'Rejected',
}

const REPLY_VARIANT: Record<ReplyClassification, 'success' | 'muted' | 'danger' | 'warning' | 'default'> = {
  POSITIVE:            'success',
  NEUTRAL:             'muted',
  NEGATIVE:            'danger',
  OUT_OF_OFFICE:       'warning',
  UNSUBSCRIBE_REQUEST: 'danger',
  REFERRAL:            'default',
  UNKNOWN:             'muted',
}

const REPLY_LABEL: Record<ReplyClassification, string> = {
  POSITIVE:            'Positive',
  NEUTRAL:             'Neutral',
  NEGATIVE:            'Negative',
  OUT_OF_OFFICE:       'Out of Office',
  UNSUBSCRIBE_REQUEST: 'Unsubscribe',
  REFERRAL:            'Referral',
  UNKNOWN:             'Unknown',
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function DraftsSection({ drafts, draftTotal }: { drafts: CampaignDetailDraftDTO[]; draftTotal: number }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[var(--text-primary)] font-semibold text-sm">
          Drafts
          <span className="ml-2 text-[var(--text-muted)] font-normal">{draftTotal}</span>
        </h2>
        <Link
          href="/drafts"
          className="text-[var(--accent-indigo)] text-xs hover:text-[var(--accent-indigo-hover)] transition-colors"
        >
          Review in Drafts &rarr;
        </Link>
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
        {drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-[var(--text-muted)] text-sm">No drafts for this campaign yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)]">
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Lead</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Subject</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Status</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide hidden md:table-cell">Created</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => {
                  const displayName =
                    [draft.lead.firstName, draft.lead.lastName].filter(Boolean).join(' ') ||
                    draft.lead.email

                  return (
                    <tr
                      key={draft.id}
                      className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)] last:border-0"
                    >
                      <td className="py-3 px-4">
                        <p className="text-[var(--text-primary)]">{displayName}</p>
                        {displayName !== draft.lead.email && (
                          <p className="text-[var(--text-muted)] text-xs">{draft.lead.email}</p>
                        )}
                        {draft.lead.company && (
                          <p className="text-[var(--text-muted)] text-xs opacity-60">{draft.lead.company}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 max-w-[240px]">
                        <span className="text-[var(--text-secondary)] text-xs block truncate">{draft.subject}</span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={DRAFT_STATUS_VARIANT[draft.status]}>
                          {DRAFT_STATUS_LABEL[draft.status]}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-[var(--text-muted)] text-xs hidden md:table-cell">
                        {draft.createdAt.toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function RepliesSection({ replies, replyCount }: { replies: CampaignDetailReplyDTO[]; replyCount: number }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[var(--text-primary)] font-semibold text-sm">
          Replies
          <span className="ml-2 text-[var(--text-muted)] font-normal">{replyCount}</span>
        </h2>
        <Link
          href="/replies"
          className="text-[var(--accent-indigo)] text-xs hover:text-[var(--accent-indigo-hover)] transition-colors"
        >
          View all replies &rarr;
        </Link>
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
        {replies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-[var(--text-muted)] text-sm">No replies for this campaign yet.</p>
            <p className="text-[var(--text-muted)] text-xs mt-1 opacity-60">Replies appear once leads respond to sent messages.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)]">
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Lead</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Classification</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Confidence</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide hidden lg:table-cell">Preview</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Received</th>
                </tr>
              </thead>
              <tbody>
                {replies.map((reply) => (
                  <tr
                    key={reply.id}
                    className={
                      reply.classification === 'POSITIVE'
                        ? 'border-b border-[var(--border-subtle)] bg-[var(--status-success-bg)] hover:bg-[var(--status-success-bg)] transition-colors duration-[var(--transition-fast)] last:border-0'
                        : 'border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)] last:border-0'
                    }
                  >
                    <td className="py-3 px-4 text-[var(--text-primary)] text-xs">{reply.leadEmail}</td>
                    <td className="py-3 px-4">
                      <Badge variant={REPLY_VARIANT[reply.classification]}>
                        {REPLY_LABEL[reply.classification]}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-[var(--text-muted)] text-xs">
                      {reply.classificationConfidence !== null
                        ? `${Math.round(reply.classificationConfidence * 100)}%`
                        : '\u2014'}
                    </td>
                    <td className="py-3 px-4 text-[var(--text-muted)] text-xs hidden lg:table-cell">
                      <span className="line-clamp-1 max-w-xs block">
                        {reply.rawBody.slice(0, 100)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[var(--text-muted)] text-xs">
                      {reply.receivedAt.toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const { id: campaignId } = await params
  const org = await resolveOrganization(orgId)
  const campaign = await getCampaignDetail({ organizationId: org.id, campaignId })

  if (!campaign) {
    notFound()
  }

  const positiveRate =
    campaign.replyCount > 0
      ? `${((campaign.positiveReplyCount / campaign.replyCount) * 100).toFixed(0)}% positive`
      : null

  return (
    <>
      <Header title={campaign.name} />
      <div className="flex-1 p-6 space-y-8">

        <div className="space-y-3">
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1 text-[var(--text-muted)] text-xs hover:text-[var(--text-secondary)] transition-colors"
          >
            &larr; Campaigns
          </Link>

          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[var(--text-primary)] font-semibold text-xl">{campaign.name}</h1>
                <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status]}>
                  {capitalize(campaign.status)}
                </Badge>
              </div>
              {campaign.description && (
                <p className="text-[var(--text-secondary)] text-sm mt-1">{campaign.description}</p>
              )}
              <p className="text-[var(--text-muted)] text-xs mt-1">
                Created {campaign.createdAt.toLocaleDateString('en-US', {
                  month: 'long', day: 'numeric', year: 'numeric',
                })}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Messages Sent"  value={campaign.messageCount} />
          <StatCard label="Total Drafts"   value={campaign.draftTotal} />
          <StatCard label="Pending Review" value={campaign.draftPendingCount} accent={campaign.draftPendingCount > 0 ? 'warning' : undefined} />
          <StatCard label="Replies"        value={campaign.replyCount} />
          <StatCard label="Positive"       value={campaign.positiveReplyCount} accent={campaign.positiveReplyCount > 0 ? 'success' : undefined} />
        </div>

        {positiveRate && (
          <p className="text-[var(--text-muted)] text-xs -mt-4">
            {positiveRate} reply rate
          </p>
        )}

        {campaign.draftPendingCount > 0 && (
          <div className="flex items-center justify-between bg-[var(--status-warning-bg)] border border-[var(--status-warning)]/30 rounded-[var(--radius-card)] px-4 py-3">
            <p className="text-[var(--status-warning)] text-sm font-medium">
              {campaign.draftPendingCount} draft{campaign.draftPendingCount !== 1 ? 's' : ''} pending review
            </p>
            <Link
              href="/drafts"
              className="text-[var(--status-warning)] text-xs underline hover:no-underline transition-all"
            >
              Review now &rarr;
            </Link>
          </div>
        )}

        <DraftsSection drafts={campaign.drafts} draftTotal={campaign.draftTotal} />

        <RepliesSection replies={campaign.replies} replyCount={campaign.replyCount} />

        <div className="flex gap-4 pt-2 border-t border-[var(--border-default)]">
          <Link href="/analytics" className="text-[var(--text-muted)] text-xs hover:text-[var(--text-secondary)] transition-colors">
            Full analytics &rarr;
          </Link>
          <Link href="/campaigns" className="text-[var(--text-muted)] text-xs hover:text-[var(--text-secondary)] transition-colors">
            All campaigns &rarr;
          </Link>
        </div>

      </div>
    </>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/campaigns/page.tsx src/features/campaigns/components/campaign-card.tsx src/app/(dashboard)/campaigns/\[id\]/page.tsx
git commit -m "style: restyle campaigns pages with StatCard and design tokens"
```

---

### Task 19: Restyle Settings Page

**Files:**
- Modify: `src/app/(dashboard)/settings/settings-client.tsx`

- [ ] **Step 1: Update settings-client.tsx with tokens**

Replace the entire contents of `src/app/(dashboard)/settings/settings-client.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import { Mail } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { MailboxDTO } from '@/features/mailboxes/types'

interface SettingsClientProps {
  initialMailboxes: MailboxDTO[]
}

export function SettingsClient({ initialMailboxes }: SettingsClientProps) {
  const [mailboxes, setMailboxes] = useState<MailboxDTO[]>(initialMailboxes)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const res = await fetch('/api/mailboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, displayName }),
    })
    const data = await res.json().catch(() => null)

    setSaving(false)

    if (!res.ok) {
      setError((data as { error?: string } | null)?.error ?? 'Failed to add mailbox.')
      return
    }

    setMailboxes((prev) => [...prev, data as MailboxDTO])
    setEmail('')
    setDisplayName('')
  }

  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h2 className="text-[var(--text-primary)] text-sm font-medium mb-1">Sending mailboxes</h2>
        <p className="text-[var(--text-muted)] text-xs">
          Outbound emails are sent from the active mailbox. Daily limit defaults to 50 emails/day.
        </p>
      </div>

      {mailboxes.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] divide-y divide-[var(--border-subtle)] shadow-[var(--shadow-card)]">
          {mailboxes.map((mb) => (
            <div key={mb.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <Mail size={14} className="text-[var(--text-muted)] shrink-0" />
                <div>
                  <p className="text-[var(--text-primary)] text-sm">{mb.displayName}</p>
                  <p className="text-[var(--text-muted)] text-xs">{mb.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-[var(--radius-badge)] ${mb.isActive ? 'bg-[var(--status-success-bg)] text-[var(--status-success)]' : 'bg-[var(--bg-surface-raised)] text-[var(--text-muted)]'}`}>
                  {mb.isActive ? 'Active' : 'Inactive'}
                </span>
                <span className="text-[var(--text-muted)] text-xs">{mb.sentToday}/{mb.dailyLimit} today</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="space-y-3">
        <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wide">Add mailbox</h3>
        <div className="flex gap-3">
          <Input
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="flex-1"
          />
          <Input
            type="text"
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="flex-1"
          />
        </div>
        {error && <p className="text-[var(--status-danger)] text-xs">{error}</p>}
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? 'Adding\u2026' : 'Add mailbox'}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(dashboard)/settings/settings-client.tsx
git commit -m "style: restyle settings page with design tokens"
```

---

### Task 20: Restyle Placeholder Pages

**Files:**
- Modify: `src/app/(dashboard)/sequences/page.tsx`
- Modify: `src/app/(dashboard)/inbox/page.tsx`
- Modify: `src/app/(dashboard)/templates/page.tsx`

- [ ] **Step 1: Update all three placeholder pages with tokens**

Replace `src/app/(dashboard)/sequences/page.tsx`:

```tsx
import { Header } from '@/components/layout/header'

export default function SequencesPage() {
  return (
    <>
      <Header title="Sequences" />
      <div className="flex-1 p-6">
        <p className="text-[var(--text-muted)] text-sm">Sequences — coming soon.</p>
      </div>
    </>
  )
}
```

Replace `src/app/(dashboard)/inbox/page.tsx`:

```tsx
import { Header } from '@/components/layout/header'

export default function InboxPage() {
  return (
    <>
      <Header title="Inbox" />
      <div className="flex-1 p-6">
        <p className="text-[var(--text-muted)] text-sm">Inbox — coming soon.</p>
      </div>
    </>
  )
}
```

Replace `src/app/(dashboard)/templates/page.tsx`:

```tsx
import { Header } from '@/components/layout/header'

export default function TemplatesPage() {
  return (
    <>
      <Header title="Templates" />
      <div className="flex-1 p-6">
        <p className="text-[var(--text-muted)] text-sm">Templates — coming soon.</p>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(dashboard)/sequences/page.tsx src/app/(dashboard)/inbox/page.tsx src/app/(dashboard)/templates/page.tsx
git commit -m "style: restyle placeholder pages with design tokens"
```

---

### Task 21: Final Build Verification

- [ ] **Step 1: Run full build**

Run: `cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx next build 2>&1 | tail -20`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run tests**

Run: `cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx vitest run 2>&1 | tail -20`
Expected: All existing tests pass. (Tests cover server logic and shouldn't be affected by styling changes.)

- [ ] **Step 3: Fix any issues found**

If build or tests fail, diagnose and fix. These should be purely styling changes so failures would indicate a syntax error or missing import.
