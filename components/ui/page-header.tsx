import * as React from 'react'

import { cn } from '@/lib/cn'

/** Title + one line of context on the left, the page's primary action(s) on the right (below the title on a phone). */
export function PageHeader({ title, subtitle, actions, className }: { title: string; subtitle?: string; actions?: React.ReactNode; className?: string }) {
  return (
    <header className={cn('flex flex-col gap-3 pb-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <h1 className="truncate text-ui-xl font-bold text-ink">{title}</h1>
        {subtitle ? <p className="text-ui-base text-ink-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  )
}
