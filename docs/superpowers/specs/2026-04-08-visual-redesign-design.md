# OutboundOS Visual Redesign — Design Spec

**Date:** 2026-04-08
**Goal:** Restyle OutboundOS to match a dark neon SaaS dashboard aesthetic. Visual-only changes — no architecture, data flow, or business logic changes.

## Approach

CSS Custom Properties theme layer in `globals.css`. All components reference semantic tokens instead of hardcoded hex values. Tailwind v4 picks up custom properties natively.

## Token Palette

### Backgrounds (surface hierarchy)

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#0a0f1f` | Page background — deep navy |
| `--bg-surface` | `#0f1221` | Cards, panels, table containers |
| `--bg-surface-raised` | `#161a2c` | Hover states, nested panels, sidebar |
| `--bg-surface-overlay` | `#1c2039` | Modals, drawers, dropdowns, tooltips |
| `--bg-sidebar` | `#0c0f1a` | Sidebar background |

### Borders & Dividers

| Token | Value | Usage |
|---|---|---|
| `--border-default` | `#23294a` | Card borders, table dividers |
| `--border-subtle` | `#151833` | Inner dividers, section separators |
| `--border-glow` | `rgba(99, 102, 241, 0.15)` | Accent card border glow |

### Text

| Token | Value | Usage |
|---|---|---|
| `--text-primary` | `#e8eaf0` | Headings, primary content |
| `--text-secondary` | `#94a3b8` | Body text, secondary labels |
| `--text-muted` | `#4b5574` | Captions, timestamps, disabled |
| `--text-inverse` | `#080b14` | Text on bright backgrounds |

### Accent Colors

| Token | Value | Usage |
|---|---|---|
| `--accent-indigo` | `#6366f1` | Primary actions, active nav, links |
| `--accent-indigo-hover` | `#818cf8` | Hover on primary accent |
| `--accent-indigo-glow` | `rgba(99, 102, 241, 0.2)` | Active nav bg, card glow |
| `--accent-cyan` | `#22d3ee` | Secondary accent, alt KPI highlight |
| `--accent-magenta` | `#e879f9` | Tertiary accent, chart highlights |

### Semantic Status

| Token | Value | Usage |
|---|---|---|
| `--status-success` | `#10b981` | Positive, delivered, active |
| `--status-success-bg` | `rgba(16, 185, 129, 0.12)` | Badge/row background |
| `--status-warning` | `#f59e0b` | Pending, contacted |
| `--status-warning-bg` | `rgba(245, 158, 11, 0.12)` | Badge background |
| `--status-danger` | `#ef4444` | Bounced, errors |
| `--status-danger-bg` | `rgba(239, 68, 68, 0.12)` | Badge background |

### Effects

| Token | Value | Usage |
|---|---|---|
| `--shadow-card` | `0 1px 3px rgba(0,0,0,0.4), 0 0 12px rgba(99,102,241,0.04)` | Card elevation |
| `--shadow-card-hover` | `0 4px 16px rgba(0,0,0,0.5), 0 0 20px rgba(99,102,241,0.08)` | Card hover lift |
| `--radius-card` | `12px` | Cards, panels |
| `--radius-btn` | `8px` | Buttons, inputs, badges |
| `--radius-badge` | `6px` | Badges |

### Background Gradient

A subtle radial gradient overlay on the page background for depth:
```
radial-gradient(ellipse at 20% 0%, rgba(99,102,241,0.06) 0%, transparent 60%),
radial-gradient(ellipse at 80% 100%, rgba(34,211,238,0.04) 0%, transparent 60%)
```

## Surface Hierarchy

```
Level 0: --bg-base           <- page background
Level 1: --bg-surface        <- cards, table wrappers
Level 2: --bg-surface-raised <- hover rows, nested sections, active nav
Level 3: --bg-surface-overlay <- modals, drawers, tooltips
```

Cards: `--border-default` border + `--shadow-card`. On hover: border to `--border-glow`, shadow to `--shadow-card-hover`.

## Interaction States

**Buttons:**
- Primary: `--accent-indigo` bg -> `--accent-indigo-hover` on hover
- Ghost: transparent -> `--bg-surface-raised` on hover
- Outline: `--border-default` border -> `--accent-indigo` border on hover

**Table rows:** `--bg-surface` base -> `--bg-surface-raised` on hover, 150ms transition

**Nav items:**
- Default: `--text-muted` icon/label
- Hover: `--text-secondary`, `--bg-surface-raised` bg
- Active: `--accent-indigo` text, `--accent-indigo-glow` bg, 2px left accent bar

**Inputs:** `--bg-surface` bg, `--border-default` border -> `--accent-indigo` border + ring on focus

**Badges:** Semi-transparent semantic bg with solid text. `--radius-badge` corners.

## Sidebar Behavior

**Collapsible sidebar with three modes:**

**Desktop (>=1024px):**
- Expanded: 240px wide, logo + text labels + nav items with labels + settings at bottom
- Collapsed: 60px wide, icon-only with tooltips on hover
- Toggle button at bottom (chevron icon)
- State persisted to `localStorage('outboundos-sidebar')`
- Main content `margin-left` transitions between 240px and 60px

**Mobile (<1024px):**
- Sidebar hidden by default
- Hamburger in header opens sidebar as overlay drawer from left
- Backdrop overlay closes on click
- 200ms ease slide transition

**Implementation:**
- `SidebarProvider` context in new file `sidebar-context.tsx`
- Exposes: `expanded`, `toggle`, `mobileOpen`, `setMobileOpen`
- Dashboard layout wraps children in provider, adjusts `ml-*`
- `nav-item.tsx` conditionally shows/hides labels

## Shared Primitives

**StatCard** (`src/components/ui/stat-card.tsx`):
- Props: `label`, `value`, `sub?`, `accent?`, `icon?`
- Colored left-border accent strip
- Replaces `StatCard` (dashboard), `SummaryCard` (campaigns), `KpiCard` (kpi-grid)

No other new abstractions. Existing `Button`, `Badge`, `Input` are restyled in place.

## Rollout Order

### Phase 1 — Foundation & Shell
1. `src/app/globals.css` — token system + gradient bg
2. `src/components/layout/sidebar-context.tsx` — sidebar state provider (new)
3. `src/components/layout/sidebar.tsx` — collapsible sidebar redesign
4. `src/components/layout/nav-item.tsx` — expanded/collapsed states
5. `src/components/layout/header.tsx` — restyle + mobile hamburger
6. `src/app/(dashboard)/layout.tsx` — wire sidebar context + responsive margin
7. `src/app/layout.tsx` — ensure body tokens applied

### Phase 2 — Shared UI Primitives
8. `src/components/ui/button.tsx` — restyle with tokens
9. `src/components/ui/badge.tsx` — restyle with tokens
10. `src/components/ui/input.tsx` — restyle with tokens
11. `src/components/ui/stat-card.tsx` — new shared KPI card

### Phase 3 — Page Polish
12. `src/app/(dashboard)/dashboard/page.tsx` — use stat-card, restyle
13. `src/features/analytics/components/kpi-grid.tsx` — use stat-card
14. `src/app/(dashboard)/analytics/page.tsx` — restyle
15. `src/app/(dashboard)/leads/page.tsx` — restyle table
16. `src/app/(dashboard)/drafts/page.tsx` + `drafts-client.tsx` — restyle
17. `src/features/drafts/components/drafts-table.tsx` — restyle
18. `src/features/drafts/components/draft-review-drawer.tsx` — restyle
19. `src/app/(dashboard)/replies/page.tsx` + `replies-client.tsx` — restyle
20. `src/features/replies/components/replies-table.tsx` — restyle
21. `src/app/(dashboard)/campaigns/page.tsx` — use stat-card, restyle
22. `src/features/campaigns/components/campaign-card.tsx` — restyle
23. `src/app/(dashboard)/campaigns/[id]/page.tsx` — restyle
24. `src/app/(dashboard)/settings/settings-client.tsx` — restyle
25. `src/app/(dashboard)/sequences/page.tsx` — restyle
26. `src/app/(dashboard)/inbox/page.tsx` — restyle
27. `src/app/(dashboard)/templates/page.tsx` — restyle

## Constraints

- No architecture changes. No new dependencies.
- All data fetching, Clerk auth, Prisma queries, server components unchanged.
- Visual-only: layout, spacing, colors, shadows, borders, typography weight.
- Use current stack: Next.js 16, React 19, Tailwind v4, clsx, lucide-react.
