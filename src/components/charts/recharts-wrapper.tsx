'use client'

import dynamic from 'next/dynamic'
import { ChartSkeleton } from '@/components/ui/skeleton'

const loading = () => <ChartSkeleton height={250} />

export const LazyAreaChart = dynamic(
  () => import('recharts').then((mod) => mod.AreaChart),
  { ssr: false, loading },
)

export const LazyBarChart = dynamic(
  () => import('recharts').then((mod) => mod.BarChart),
  { ssr: false, loading },
)

export const LazyLineChart = dynamic(
  () => import('recharts').then((mod) => mod.LineChart),
  { ssr: false, loading },
)

export const LazyResponsiveContainer = dynamic(
  () => import('recharts').then((mod) => mod.ResponsiveContainer),
  { ssr: false, loading },
)

// Re-export non-lazy components that don't need dynamic import
export {
  XAxis, YAxis, CartesianGrid, Tooltip, Area, Bar, Line, Legend, Cell,
} from 'recharts'
