'use client'

import { useState, useEffect } from 'react'
import type { FunnelStageDTO } from '@/features/analytics/types'

const STAGE_COLORS = [
  'var(--chart-sent)',
  'var(--chart-delivered)',
  'var(--chart-opened)',
  'var(--chart-replied)',
  'var(--chart-positive)',
]

interface FunnelChartProps {
  stages: FunnelStageDTO[]
  size?: 'compact' | 'full'
}

export function FunnelChart({ stages, size = 'compact' }: FunnelChartProps) {
  const [animated, setAnimated] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 100)
    return () => clearTimeout(timer)
  }, [])

  if (stages.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-[var(--text-muted)] text-sm">Send your first outreach to see your pipeline funnel</p>
      </div>
    )
  }

  const maxCount = stages[0]?.count ?? 1
  const barHeight = size === 'full' ? 'h-10' : 'h-7'
  const textSize = size === 'full' ? 'text-sm' : 'text-xs'
  const gap = size === 'full' ? 'gap-3' : 'gap-2'

  return (
    <div className={`flex flex-col ${gap}`}>
      {stages.map((stage, i) => {
        const widthPercent = maxCount === 0 ? 0 : (stage.count / maxCount) * 100

        return (
          <FunnelBar
            key={stage.stage}
            stage={stage}
            index={i}
            widthPercent={widthPercent}
            animated={animated}
            barHeight={barHeight}
            textSize={textSize}
          />
        )
      })}
    </div>
  )
}

function FunnelBar({
  stage, index, widthPercent, animated, barHeight, textSize,
}: {
  stage: FunnelStageDTO
  index: number
  widthPercent: number
  animated: boolean
  barHeight: string
  textSize: string
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div className="flex items-center gap-3">
      <span className={`${textSize} text-[var(--text-secondary)] w-20 text-right flex-shrink-0`}>
        {stage.stage}
      </span>
      <div className="flex-1 relative">
        <div
          className={`${barHeight} rounded-[var(--radius-btn)] transition-all duration-700 ease-out`}
          style={{
            width: animated ? `${Math.max(widthPercent, 2)}%` : '0%',
            backgroundColor: STAGE_COLORS[index] ?? 'var(--accent-indigo)',
            opacity: hovered ? 1 : 0.8,
            boxShadow: hovered ? `0 0 12px ${STAGE_COLORS[index]}40` : 'none',
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        />
      </div>
      <span className={`${textSize} text-[var(--text-muted)] w-24 flex-shrink-0 tabular-nums`}>
        {stage.count.toLocaleString()} · {(stage.rate * 100).toFixed(0)}%
      </span>
    </div>
  )
}
