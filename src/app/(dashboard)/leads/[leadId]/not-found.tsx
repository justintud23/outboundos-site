import Link from 'next/link'
import { UserX } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'

export default function LeadNotFound() {
  return (
    <>
      <Header title="Lead Not Found" />
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-[var(--status-danger-bg)] flex items-center justify-center">
          <UserX size={32} className="text-[var(--status-danger)]" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[var(--text-primary)] text-lg font-semibold mb-1">
            Lead not found
          </p>
          <p className="text-[var(--text-muted)] text-sm max-w-xs mx-auto">
            This lead may have been deleted or you may not have access to it.
          </p>
        </div>
        <Link href="/leads">
          <Button variant="outline" size="sm">
            Back to Leads
          </Button>
        </Link>
      </div>
    </>
  )
}
