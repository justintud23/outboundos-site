import { clsx } from 'clsx'
import { ChartSkeleton } from '@/components/ui/skeleton'
import { AlertCircle } from 'lucide-react'

interface DashboardModuleProps {
  title: string
  children: React.ReactNode
  loading?: boolean
  error?: string | null
  className?: string
}

export function DashboardModule({ title, children, loading, error, className }: DashboardModuleProps) {
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
      <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-4">
        {title}
      </h3>
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
