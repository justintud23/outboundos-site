import type { TimelineItem } from '../types'

export type TimelineGroup = 'Today' | 'Yesterday' | 'Earlier'

export interface GroupedTimeline {
  label: TimelineGroup
  items: TimelineItem[]
}

export function groupTimelineItems(items: TimelineItem[]): GroupedTimeline[] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000

  const today: TimelineItem[] = []
  const yesterday: TimelineItem[] = []
  const earlier: TimelineItem[] = []

  for (const item of items) {
    const ts = new Date(item.timestamp).getTime()
    if (ts >= todayStart) {
      today.push(item)
    } else if (ts >= yesterdayStart) {
      yesterday.push(item)
    } else {
      earlier.push(item)
    }
  }

  const groups: GroupedTimeline[] = []
  if (today.length > 0) groups.push({ label: 'Today', items: today })
  if (yesterday.length > 0) groups.push({ label: 'Yesterday', items: yesterday })
  if (earlier.length > 0) groups.push({ label: 'Earlier', items: earlier })

  return groups
}
