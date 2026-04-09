import { clsx } from 'clsx'
import { ChartSkeleton } from '@/components/ui/skeleton'

interface DashboardModuleProps {
  title: string
  children: React.ReactNode
  loading?: boolean
  error?: string | null
}

export function DashboardModule({ title, children, loading, error }: DashboardModuleProps) {
  return (
    <div
      className={clsx(
        'bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)]',
        'shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-glow)]',
        'transition-all duration-[var(--transition-base)] p-4 flex flex-col',
      )}
    >
      <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wide mb-3">
        {title}
      </h3>
      {loading ? (
        <ChartSkeleton height={180} />
      ) : error ? (
        <div className="flex items-center justify-center py-8">
          <p className="text-[var(--status-danger)] text-xs">{error}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0">{children}</div>
      )}
    </div>
  )
}
