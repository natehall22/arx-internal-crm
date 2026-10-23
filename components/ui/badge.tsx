import * as React from 'react'

import { cn } from '@/lib/cn'
import { statusMeta, TONE_CLASS, type StatusDomain, type StatusTone } from '@/lib/status'

export function Badge({ tone = 'neutral', className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-ui-sm font-medium', TONE_CLASS[tone], className)}
      {...props}
    />
  )
}

/** The status pill: label and color come from lib/status.ts only. */
export function StatusPill({ domain, value, className }: { domain: StatusDomain; value: string | null | undefined; className?: string }) {
  const { label, tone } = statusMeta(domain, value)
  return <Badge tone={tone} className={className}>{label}</Badge>
}
