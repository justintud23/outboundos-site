import { clsx } from 'clsx'
import { ChartSkeleton } from '@/components/ui/skeleton'
import { AlertCircle } from 'lucide-react'

interface DashboardModuleProps {
  title: string
  badge?: number
  children: React.ReactNode
  loading?: boolean
  error?: string | null
  className?: string
}

export function DashboardModule({ title, badge, children, loading, error, className }: DashboardModuleProps) {
  return (
    <div
      className={clsx(
        'bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)]',
        'shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-glow)]',
        'transition-all duration-[var(--transition-base)] p-5 flex flex-col',
        'animate-fade-in-up',
        className,
      )}
    >
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider">
          {title}
        </h3>
        {badge !== undefined && badge > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--accent-indigo-glow)] text-[var(--accent-indigo)] text-[10px] font-semibold tabular-nums">
            {badge}
          </span>
        )}
      </div>
      {loading ? (
        <ChartSkeleton height={180} />
      ) : error ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <AlertCircle size={14} className="text-[var(--status-danger)]" aria-hidden="true" />
          <p className="text-[var(--status-danger)] text-xs">{error}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0">{children}</div>
      )}
    </div>
  )
}
