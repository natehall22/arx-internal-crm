/**
 * "From Jobber" on a customer page: the quotes and one-off jobs Jobber had for this customer, read-only, as brought over
 * by Move from Jobber (lib/jobber-import/db.ts loadJobberHistory). No deal, job or quote is made from them; an open quote
 * is marked so the office can follow up. Server component; the page decides who sees it (prices are on it).
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { formatDate, formatMoney } from '@/lib/format'

type Entry = { label: string; type?: string; status?: string | null; open?: boolean; total_cents?: number | null; lines?: string | null; dates?: Record<string, string | null> }

export default function JobberHistoryCard({ entries }: { entries: Array<Record<string, unknown>> }) {
  if (!entries.length) return null
  const list = entries as Entry[]
  const open = list.filter((e) => e.type === 'quote' && e.open).length
  return (
    <Card>
      <CardHeader>
        <CardTitle>From Jobber</CardTitle>
      </CardHeader>
      <CardContent>
        <details open={open > 0}>
          <summary className="min-h-tap cursor-pointer text-ui-base font-semibold text-ink">
            {list.length} quote{list.length === 1 ? '' : 's'} & past job{list.length === 1 ? '' : 's'}
            {open ? ` · ${open} quote${open === 1 ? '' : 's'} still open` : ''}
          </summary>
          <ul className="mt-2 divide-y divide-surface-line text-ui-base text-ink">
            {list.map((e, i) => {
              const day = e.dates?.approved ?? e.dates?.sent ?? e.dates?.closed ?? e.dates?.start ?? e.dates?.drafted ?? e.dates?.created ?? null
              return (
                <li key={i} className="py-2">
                  <p className="font-semibold">
                    {e.label}
                    {e.type === 'quote' && e.open ? <span className="ml-2 rounded-full border border-amber-500 px-2 text-ui-sm">Open — follow up</span> : null}
                  </p>
                  <p className="text-ui-sm">
                    {[e.status, typeof e.total_cents === 'number' ? formatMoney(e.total_cents / 100) : null, day ? formatDate(day) : null].filter(Boolean).join(' · ')}
                  </p>
                  {e.lines ? <p className="break-words text-ui-sm">{e.lines}</p> : null}
                </li>
              )
            })}
          </ul>
        </details>
      </CardContent>
    </Card>
  )
}
