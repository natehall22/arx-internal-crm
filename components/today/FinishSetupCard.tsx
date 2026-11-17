import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { FinishSetupItem } from '@/lib/finish-setup'

/** Today's "Finish setup" checklist for a new company's owner: each step links to where it is done. */
export default function FinishSetupCard({ items }: { items: FinishSetupItem[] }) {
  const left = items.filter((i) => !i.done).length
  return (
    <Card>
      <CardHeader>
        <CardTitle>Finish setup</CardTitle>
        <Badge tone="warning">{left} left</Badge>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-surface-line">
          {items.map((i) => (
            <li key={i.id}>
              <Link href={i.href} className="flex min-h-tap items-center gap-3 py-2 hover:bg-surface-subtle">
                <span aria-hidden className={i.done ? 'text-green-700' : 'text-ink-muted'}>{i.done ? '✓' : '○'}</span>
                <span className={i.done ? 'text-ink-muted line-through' : 'font-semibold text-ink'}>{i.label}</span>
                <span className="sr-only">{i.done ? ' (done)' : ' (not done)'}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
