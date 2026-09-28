import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/charts/recharts-wrapper', () => ({
  LazyResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LazyAreaChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  LazyBarChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  LazyLineChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  CartesianGrid: () => null,
  Area: () => null,
  Bar: () => null,
  Cell: () => null,
  Line: () => null,
}))

import { DashboardClient } from './dashboard-client'
import type { DashboardRefreshData } from '@/features/analytics/types'

const emptyData: DashboardRefreshData = {
  summary: { leads: 0, campaigns: 0, messagesSent: 0, replies: 0, positiveReplies: 0 },
  funnel: [],
  activity: [],
  classification: [],
  campaigns: [],
  recentReplies: [],
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/actions')) {
      return Promise.resolve(new Response(JSON.stringify({ actions: [] }), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(emptyData), { status: 200 }))
  })
})

describe('DashboardClient — refresh honors the view', () => {
  it('includes ?view=mine in the refresh URL when the current view is mine', async () => {
    render(<DashboardClient initialData={emptyData} initialActions={[]} view="mine" />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh dashboard' }))

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => c[0] as string)
      expect(urls.some((u) => u.startsWith('/api/dashboard/refresh') && u.includes('view=mine'))).toBe(true)
    })
  })

  it('includes ?view=team in the refresh URL when the current view is team', async () => {
    render(<DashboardClient initialData={emptyData} initialActions={[]} view="team" />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh dashboard' }))

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => c[0] as string)
      expect(urls.some((u) => u.startsWith('/api/dashboard/refresh') && u.includes('view=team'))).toBe(true)
    })
  })
})
