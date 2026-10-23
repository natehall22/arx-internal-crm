import Link from 'next/link'

import { StatusPill } from '@/components/ui'
import type { FileContext } from '@/lib/customer-file/load'
import { TAB_LABELS } from '@/lib/customer-file/access'

/** Sticky identity block: who, where, how to reach them, which deal, where the deal stands, what's next, pinned alerts. */
export default function FileHeader({ ctx }: { ctx: FileContext }) {
  const { customer, deal, deals, job, stages, next, pinned } = ctx
  const base = `/c/${customer.id}/d/${deal.id}`
  const tel = customer.phone?.replace(/[^\d+]/g, '')
  const maps = deal.address_text || customer.address_text
  return (
    <div className="border-b border-surface-line bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="break-words text-ui-xl font-bold text-ink">{customer.name || 'Customer'}</h1>
            {maps && (
              <a href={`https://maps.google.com/?q=${encodeURIComponent(maps)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-tap items-center break-words text-ui-base text-brand-800 underline">
                {maps}
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {tel && <a href={`tel:${tel}`} className="inline-flex min-h-tap items-center rounded-ui bg-brand-700 px-4 text-ui-sm font-semibold text-white">Call</a>}
            {tel && <a href={`sms:${tel}`} className="inline-flex min-h-tap items-center rounded-ui border border-surface-line px-4 text-ui-sm font-semibold text-ink">Text</a>}
            <Link href={`${base}/notes`} className="inline-flex min-h-tap items-center rounded-ui border border-surface-line px-4 text-ui-sm font-semibold text-ink lg:hidden">+ Note</Link>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-ui-sm text-ink-muted">
          {deals.length > 1 && (
            <nav aria-label="Deals" className="flex flex-wrap gap-1">
              {deals.map((d) => (
                <Link key={d.id} href={`/c/${customer.id}/d/${d.id}`} aria-current={d.id === deal.id ? 'page' : undefined} className={`inline-flex min-h-tap items-center rounded-ui border px-3 text-ui-sm ${d.id === deal.id ? 'border-brand-700 bg-brand-50 font-semibold text-ink' : 'border-surface-line text-ink'}`}>
                  {(d.address_text || 'Deal').slice(0, 28)} · {new Date(d.created_at).getFullYear()}
                </Link>
              ))}
            </nav>
          )}
          {job && (
            <>
              <span className="font-semibold text-ink">Job {job.job_number}</span>
              <StatusPill domain="job" value={job.status} />
            </>
          )}
        </div>

        <ol aria-label="Progress" className="mt-2 flex gap-1 overflow-x-auto pb-1">
          {stages.map((s) => {
            const allowed = ctx.tabs.includes(s.tab)
            const cls = `inline-flex min-h-tap items-center whitespace-nowrap rounded-full border px-3 text-ui-sm ${s.state === 'done' ? 'border-green-700 bg-green-50 text-ink' : s.state === 'current' ? 'border-brand-700 bg-brand-100 font-semibold text-ink' : 'border-surface-line text-ink-muted'}`
            return (
              <li key={s.key}>
                {allowed ? <Link href={`${base}/${s.tab}`} className={cls} title={`Open ${TAB_LABELS[s.tab]}`}>{s.state === 'done' ? '✓ ' : ''}{s.label}</Link> : <span className={cls}>{s.state === 'done' ? '✓ ' : ''}{s.label}</span>}
              </li>
            )
          })}
        </ol>
        {next && ctx.tabs.includes(next.tab) && (
          <Link href={`${base}/${next.tab}`} className="mt-1 inline-flex min-h-tap items-center text-ui-sm font-semibold text-brand-800 underline">
            Next: {next.label} ▸
          </Link>
        )}

        {pinned.length > 0 && (
          <ul aria-label="Pinned alerts" className="mt-2 space-y-1">
            {pinned.slice(0, 3).map((p) => (
              <li key={p.id} className="rounded-ui border-l-4 border-amber-600 bg-amber-50 px-3 py-2 text-ui-sm font-semibold text-ink">⚠ {p.body}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
