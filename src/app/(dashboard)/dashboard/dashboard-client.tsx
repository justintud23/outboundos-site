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
import { ActionCenterModule } from '@/features/dashboard/components/action-center-module'
import type { DashboardRefreshData } from '@/features/analytics/types'
import type { NextAction } from '@/features/actions/types'

interface DashboardClientProps {
  initialData: DashboardRefreshData
  initialActions: NextAction[]
}

export function DashboardClient({ initialData, initialActions }: DashboardClientProps) {
  const [data, setData] = useState(initialData)
  const [actions, setActions] = useState(initialActions)
  const [dateRange, setDateRange] = useState<'7d' | '30d'>('30d')
  const [isLive, setIsLive] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(new Date())

  const refresh = useCallback(async (days?: number) => {
    setRefreshing(true)
    try {
      const d = days ?? (dateRange === '7d' ? 7 : 30)
      const [dashRes, actionsRes] = await Promise.all([
        fetch(`/api/dashboard/refresh?days=${d}`),
        fetch('/api/actions'),
      ])
      if (dashRes.ok) {
        const newData = await dashRes.json() as DashboardRefreshData
        setData(newData)
      }
      if (actionsRes.ok) {
        const actionsData = await actionsRes.json() as { actions: NextAction[] }
        setActions(actionsData.actions.slice(0, 5))
      }
      setLastUpdatedAt(new Date())
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

      {/* Primary row — KPIs + Funnel + Classification */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 stagger-grid">
        <DashboardModule title="KPI Summary" loading={refreshing}>
          <KpiSummary data={data.summary} />
        </DashboardModule>

        <DashboardModule title="Outreach Funnel" loading={refreshing}>
          <FunnelChart stages={data.funnel} size="compact" />
        </DashboardModule>

        <DashboardModule title="Reply Classification" loading={refreshing}>
          <ClassificationChart data={data.classification} />
        </DashboardModule>
      </div>

      {/* Secondary row — Action Center + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 stagger-grid">
        <DashboardModule
          title="Action Center"
          badge={actions.length > 0 ? actions.length : undefined}
          loading={refreshing}
        >
          <ActionCenterModule actions={actions} />
        </DashboardModule>

        <DashboardModule title="Daily Activity" loading={refreshing} className="lg:col-span-2">
          <ActivityChart data={data.activity} />
        </DashboardModule>
      </div>

      {/* Third row — Campaign + Replies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 stagger-grid">
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
