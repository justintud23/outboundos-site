'use client'

import { useState, useCallback, useEffect } from 'react'
import { SnapshotBar } from '@/features/dashboard/components/snapshot-bar'
import { DashboardModule } from '@/features/dashboard/components/dashboard-module'
import { KpiSummary } from '@/features/dashboard/components/kpi-summary'
import { FunnelChart } from '@/components/charts/funnel-chart'
import { ClassificationChart } from '@/features/dashboard/components/classification-chart'
import { ActivityChart } from '@/features/dashboard/components/activity-chart'
import { CampaignChart } from '@/features/dashboard/components/campaign-chart'
import { RecentRepliesCompact } from '@/features/dashboard/components/recent-replies-compact'
import type { DashboardRefreshData } from '@/features/analytics/types'

interface DashboardClientProps {
  initialData: DashboardRefreshData
}

export function DashboardClient({ initialData }: DashboardClientProps) {
  const [data, setData] = useState(initialData)
  const [dateRange, setDateRange] = useState<'7d' | '30d'>('30d')
  const [isLive, setIsLive] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(new Date())

  const refresh = useCallback(async (days?: number) => {
    setRefreshing(true)
    try {
      const d = days ?? (dateRange === '7d' ? 7 : 30)
      const res = await fetch(`/api/dashboard/refresh?days=${d}`)
      if (res.ok) {
        const newData = await res.json() as DashboardRefreshData
        setData(newData)
        setLastUpdatedAt(new Date())
      }
    } finally {
      setRefreshing(false)
    }
  }, [dateRange])

  const handleDateRangeChange = useCallback((range: '7d' | '30d') => {
    setDateRange(range)
    void refresh(range === '7d' ? 7 : 30)
  }, [refresh])

  // Live mode polling
  useEffect(() => {
    if (!isLive) return
    const interval = setInterval(() => void refresh(), 60_000)
    return () => clearInterval(interval)
  }, [isLive, refresh])

  // Daily 8 AM auto-refresh
  useEffect(() => {
    const now = new Date()
    const next8am = new Date(now)
    next8am.setHours(8, 0, 0, 0)
    if (next8am <= now) next8am.setDate(next8am.getDate() + 1)
    const ms = next8am.getTime() - now.getTime()
    const timeout = setTimeout(() => void refresh(), ms)
    return () => clearTimeout(timeout)
  }, [refresh])

  return (
    <div className="space-y-6">
      <SnapshotBar
        lastUpdatedAt={lastUpdatedAt}
        dateRange={dateRange}
        isLive={isLive}
        onRefresh={() => void refresh()}
        onDateRangeChange={handleDateRangeChange}
        onLiveToggle={() => setIsLive((v) => !v)}
        refreshing={refreshing}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DashboardModule title="KPI Summary" loading={refreshing}>
          <KpiSummary data={data.summary} />
        </DashboardModule>

        <DashboardModule title="Outreach Funnel" loading={refreshing}>
          <FunnelChart stages={data.funnel} size="compact" />
        </DashboardModule>

        <DashboardModule title="Reply Classification" loading={refreshing}>
          <ClassificationChart data={data.classification} />
        </DashboardModule>

        <DashboardModule title="Daily Activity" loading={refreshing}>
          <ActivityChart data={data.activity} />
        </DashboardModule>

        <DashboardModule title="Campaign Comparison" loading={refreshing}>
          <CampaignChart data={data.campaigns} />
        </DashboardModule>

        <DashboardModule title="Recent Replies" loading={refreshing}>
          <RecentRepliesCompact replies={data.recentReplies} />
        </DashboardModule>
      </div>
    </div>
  )
}
