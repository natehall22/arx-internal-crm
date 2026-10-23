'use client'

import Link from 'next/link'
import * as React from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterBar } from '@/components/ui/filter-bar'
import { filterSettingsGroups, type SettingsGroup } from '@/lib/settings-registry'

export default function SettingsHub({ groups }: { groups: SettingsGroup[] }) {
  const [q, setQ] = React.useState('')
  const shown = filterSettingsGroups(groups, q)
  return (
    <div className="flex flex-col gap-4">
      <FilterBar search={q} onSearch={setQ} searchPlaceholder="Search settings (e.g. commission, pricing, users)" />
      {shown.length === 0 ? <EmptyState title="No settings match" body="Try a shorter word, like “pay” or “user”." /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {shown.map((g) => (
          <Card key={g.id}>
            <CardHeader>
              <CardTitle>{g.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-surface-line">
                {g.items.map((i) => (
                  <li key={i.href}>
                    <Link href={i.href} className="flex min-h-tap flex-col justify-center py-2 hover:bg-surface-subtle">
                      <span className="font-semibold text-ink">{i.title}</span>
                      <span className="text-ui-sm text-ink-muted">{i.description}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
