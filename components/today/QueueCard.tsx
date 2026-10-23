import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Queue } from '@/lib/today'

/** One work queue: title + count, the first few rows (each a link to where the work is done). */
export function QueueCard({ queue }: { queue: Queue }) {
  const more = queue.count - queue.items.length
  return (
    <Card>
      <CardHeader>
        <CardTitle>{queue.title}</CardTitle>
        <Badge tone={queue.count > 0 ? 'warning' : 'success'}>{queue.count}</Badge>
      </CardHeader>
      <CardContent>
        {queue.items.length === 0 ? (
          <p className="text-ink-muted">{queue.empty}</p>
        ) : (
          <ul className="divide-y divide-surface-line">
            {queue.items.map((i) => (
              <li key={i.id}>
                <Link href={i.href} className="flex min-h-tap flex-col justify-center py-2 hover:bg-surface-subtle">
                  <span className="font-semibold text-ink">{i.title}</span>
                  {i.detail ? <span className="text-ui-sm text-ink-muted">{i.detail}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {more > 0 ? <p className="pt-2 text-ui-sm text-ink-muted">+ {more} more</p> : null}
      </CardContent>
    </Card>
  )
}

export function KpiTiles({ tiles }: { tiles: Array<{ label: string; value: string | number; href?: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => {
        const body = (
          <div className="rounded-ui border border-surface-line bg-surface p-3">
            <p className="text-ui-sm text-ink-muted">{t.label}</p>
            <p className="text-ui-xl font-bold tabular-nums text-ink">{t.value}</p>
          </div>
        )
        return t.href ? <Link key={t.label} href={t.href} className="block">{body}</Link> : <div key={t.label}>{body}</div>
      })}
    </div>
  )
}
