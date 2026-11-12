import Link from 'next/link'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { formatAcres, formatCuYd, formatFeet, formatSqft, groupMeasurementHistory, type AreaTotals } from '@/lib/area-measure'
import type { AreaMeasurementRow } from '@/lib/area-measure-db'
import { formatDate } from '@/lib/format'

/**
 * Yard measurement on the Customer File (lawn & landscape companies; the switch decides whether this renders at all).
 * Shows the newest measurement of each property with "Re-measure", and keeps the older ones under "Older measurements".
 * Server component: plain links, no script. Materials are estimates ("est.") at the company numbers saved with the row.
 */
export default function YardMeasureCard({
  customerId,
  opportunityId,
  leadId,
  rows,
  properties,
  canMeasure,
}: {
  customerId?: string | null
  opportunityId?: string | null
  leadId?: string | null
  rows: AreaMeasurementRow[]
  /** The customer's active properties (id + name). */
  properties: Array<{ id: string; name: string }>
  canMeasure: boolean
}) {
  const groups = groupMeasurementHistory(rows)
  const nameOf = (id: string | null) => (id ? properties.find((p) => p.id === id)?.name ?? 'Property' : properties.length > 1 ? 'No property chosen' : null)
  const base = (propertyId: string | null, from?: string) => {
    const q = new URLSearchParams()
    if (customerId) q.set('customer_id', customerId)
    if (leadId) q.set('lead_id', leadId)
    if (opportunityId) q.set('opportunity_id', opportunityId)
    if (propertyId) q.set('property_id', propertyId)
    if (from) q.set('from', from)
    return `/tools/area-measure?${q.toString()}`
  }
  const measured = new Set(groups.map((g) => g.propertyId))
  const unmeasured = properties.filter((p) => !measured.has(p.id))
  const linkClass = 'inline-flex min-h-tap items-center rounded-ui bg-brand-700 px-4 text-ui-base font-semibold text-white'
  const textLink = 'inline-flex min-h-tap items-center text-ui-base font-semibold text-brand-800 underline'

  return (
    <Card data-testid="yard-card">
      <CardHeader>
        <CardTitle>Yard measurement</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {groups.length === 0 ? <p className="text-ui-base text-ink">Not measured yet.</p> : null}

        {groups.map((g) => {
          const t = g.latest.totals as Partial<AreaTotals>
          const m = t.materials
          const name = nameOf(g.propertyId)
          return (
            <div key={g.propertyId ?? 'none'} className="flex flex-col gap-1.5">
              {name ? <p className="break-words text-ui-base font-semibold text-ink">{name}</p> : null}
              <p className="text-ui-base text-ink">
                Lawn {formatSqft(g.latest.lawn_sqft)} ({formatAcres(g.latest.lawn_sqft)}) · Beds {formatSqft(g.latest.bed_sqft)} · Edging {formatFeet(g.latest.line_feet)}
              </p>
              {g.latest.bed_sqft > 0 && m ? (
                <p className="text-ui-base text-ink">
                  Beds: est. {formatCuYd(m.mulchCuYd)} mulch at {m.mulchDepthIn} in · est. {m.strawBales} bale{m.strawBales === 1 ? '' : 's'} pine straw
                </p>
              ) : null}
              <p className="text-ui-sm text-ink">Measured {formatDate(g.latest.created_at)}</p>
              {canMeasure ? (
                <div className="flex flex-wrap gap-x-4">
                  <Link href={base(g.propertyId, g.latest.id)} className={linkClass}>
                    Re-measure
                  </Link>
                  <Link href={base(g.propertyId)} className={textLink}>
                    Start from scratch
                  </Link>
                </div>
              ) : null}
              {g.older.length > 0 ? (
                <details>
                  <summary className="flex min-h-tap cursor-pointer items-center text-ui-base font-semibold text-brand-800 underline">Older measurements ({g.older.length})</summary>
                  <ul className="mt-1 flex flex-col gap-1">
                    {g.older.map((o) => (
                      <li key={o.id} className="text-ui-base text-ink">
                        {formatDate(o.created_at)}: lawn {formatSqft(o.lawn_sqft)}, beds {formatSqft(o.bed_sqft)}, edging {formatFeet(o.line_feet)}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          )
        })}

        {canMeasure && groups.length === 0 && properties.length <= 1 ? (
          <div>
            <Link href={base(properties[0]?.id ?? null)} className={linkClass}>
              Measure yard
            </Link>
          </div>
        ) : null}
        {canMeasure && (groups.length > 0 || properties.length > 1) && unmeasured.length > 0
          ? unmeasured.map((p) => (
              <Link key={p.id} href={base(p.id)} className={`${textLink} break-words`}>
                Measure {p.name}
              </Link>
            ))
          : null}
      </CardContent>
    </Card>
  )
}
