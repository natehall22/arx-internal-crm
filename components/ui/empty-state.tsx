import * as React from 'react'

import { cn } from '@/lib/cn'

export function EmptyState({ title, body, action, className }: { title: string; body?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-ui border border-dashed border-surface-line px-4 py-10 text-center', className)}>
      <p className="text-ui-lg font-semibold text-ink">{title}</p>
      {body ? <p className="max-w-sm text-ui-base text-ink-muted">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
