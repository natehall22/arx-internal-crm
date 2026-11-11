'use client'

import { PayButton } from '@/components/portal/PortalActions'
import { dayLabel, money, monthDay } from '@/components/portal/format'
import { Panel, type PortalCompany } from '@/components/portal/PortalShell'
import type { PortalJob } from '@/lib/portal/job-progress'

const link = 'inline-flex min-h-[44px] items-center text-base font-bold text-[#1d4ed8] underline'

export const whenText = (w: NonNullable<PortalJob['installs'][number]['when']>): string => (w.kind === 'week' ? `Week of ${monthDay(w.ymd)}` : dayLabel(w.ymd))

/** One job's progress in plain words: the steps, the install days, and what is left to pay. Cancelled / on-hold jobs only say "contact us". */
export default function JobProgressCard({ job, company, payInvoiceId, payOnline }: { job: PortalJob; company: PortalCompany; payInvoiceId: string | null; payOnline: boolean }) {
  const title = job.address || 'Your project'
  if (job.quiet) {
    return (
      <Panel title={title}>
        <p className="text-base">Questions about this project? Contact us{company.phone ? ` at ${company.phone}` : ''} and we will help.</p>
      </Panel>
    )
  }
  const m = job.money
  return (
    <Panel title={title}>
      <ol className="flex flex-col gap-1" aria-label="Project progress">
        {job.stages.map((s) => (
          <li key={s.key} className="flex min-h-[44px] items-center gap-3 text-base" aria-current={s.state === 'current' ? 'step' : undefined}>
            <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${s.state === 'done' ? 'border-[#166534] bg-[#166534] text-white' : s.state === 'current' ? 'border-[#111827] bg-white text-[#111827]' : 'border-[#9ca3af] bg-white text-[#374151]'}`}>
              {s.state === 'done' ? '✓' : s.state === 'current' ? '●' : ''}
            </span>
            <span className={s.state === 'current' ? 'font-bold' : s.state === 'done' ? 'font-semibold' : ''}>
              {s.label}
              <span className="sr-only">{s.state === 'done' ? ' (done)' : s.state === 'current' ? ' (now)' : ' (next)'}</span>
            </span>
          </li>
        ))}
      </ol>

      {job.installs.length > 0 ? (
        <ul className="mt-3 divide-y divide-[#e5e3dc] border-t border-[#e5e3dc]">
          {job.installs.map((i, idx) => (
            <li key={`${i.label}-${idx}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-base">
              <span className="font-bold">{i.label}</span>
              <span>{i.done ? 'Done' : i.when ? whenText(i.when) : i.inProgress ? 'Install in progress' : ''}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {m ? (
        <div className="mt-3 border-t border-[#e5e3dc] pt-3 text-base">
          {m.financedThrough ? (
            <p className="font-semibold">Financed through {m.financedThrough}</p>
          ) : m.contactAboutBalance ? (
            <p>Please contact us about your balance{company.phone ? ` at ${company.phone}` : ''}.</p>
          ) : m.paidInFull ? (
            <p className="font-semibold">Paid in full. Thank you.</p>
          ) : (
            <>
              <p><span className="text-lg font-bold">{money(m.balanceCents)}</span> left to pay of {money(m.totalCents)}</p>
              {payInvoiceId ? (
                payOnline ? <PayButton invoiceId={payInvoiceId} label="Pay now" /> : <a className={link} href={`/portal/invoices/${payInvoiceId}`}>See invoice</a>
              ) : (
                <p>Questions about payment? Contact us{company.phone ? ` at ${company.phone}` : ''}.</p>
              )}
            </>
          )}
        </div>
      ) : null}
    </Panel>
  )
}
