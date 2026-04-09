'use client'

import { useState, useCallback, useEffect } from 'react'
import { SnapshotBar } from '@/features/dashboard/components/snapshot-bar'
import { KpiStrip } from '@/features/analytics/components/kpi-strip'
import { FunnelChart } from '@/components/charts/funnel-chart'
import { ActivityLineChart } from '@/features/analytics/components/activity-line-chart'
import { CampaignTable } from '@/features/analytics/components/campaign-table'
import { ClassificationBars } from '@/features/analytics/components/classification-bars'
import { DashboardModule } from '@/features/dashboard/components/dashboard-module'
import type { AnalyticsRefreshData } from '@/features/analytics/types'

interface AnalyticsClientProps {
  initialData: AnalyticsRefreshData
}

export function AnalyticsClient({ initialData }: AnalyticsClientProps) {
  const [data, setData] = useState(initialData)
  const [dateRange, setDateRange] = useState<'7d' | '30d'>('30d')
  const [isLive, setIsLive] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(new Date())

  const refresh = useCallback(async (days?: number) => {
    setRefreshing(true)
    try {
      const d = days ?? (dateRange === '7d' ? 7 : 30)
      const res = await fetch(`/api/analytics/refresh?days=${d}`)
      if (res.ok) {
        const newData = await res.json() as AnalyticsRefreshData
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

  useEffect(() => {
    if (!isLive) return
    const interval = setInterval(() => void refresh(), 60_000)
    return () => clearInterval(interval)
  }, [isLive, refresh])

  useEffect(() => {
    const now = new Date()
    const next8am = new Date(now)
    next8am.setHours(8, 0, 0, 0)
    if (next8am <= now) next8am.setDate(next8am.getDate() + 1)
    const timeout = setTimeout(() => void refresh(), next8am.getTime() - now.getTime())
    return () => clearTimeout(timeout)
  }, [refresh])

  return (
    <div className="space-y-8">
      <SnapshotBar
        lastUpdatedAt={lastUpdatedAt}
        dateRange={dateRange}
        isLive={isLive}
        onRefresh={() => void refresh()}
        onDateRangeChange={handleDateRangeChange}
        onLiveToggle={() => setIsLive((v) => !v)}
        refreshing={refreshing}
      />

      <KpiStrip analytics={data.analytics} />

      <DashboardModule title="Outreach Funnel" loading={refreshing}>
        <FunnelChart stages={data.funnel} size="full" />
      </DashboardModule>

      <DashboardModule title="Daily Activity" loading={refreshing}>
        <ActivityLineChart data={data.activity} />
      </DashboardModule>

      <DashboardModule title="Campaign Performance" loading={refreshing}>
        <CampaignTable data={data.campaigns} />
      </DashboardModule>

      <DashboardModule title="Reply Classification" loading={refreshing}>
        <ClassificationBars data={data.classification} totalReplies={data.analytics.replies} />
      </DashboardModule>

      <p className="text-[var(--text-muted)] text-xs leading-relaxed">
        Delivered, opened, clicked, bounced, and unsubscribe counts reflect unique emails (one message counted once per event type regardless of how many events were received). Positive replies are classified by AI.
      </p>
    </div>
  )
}
