import Link from 'next/link'
import { notFound } from 'next/navigation'

import FilesPanel from '@/components/customer-file/FilesPanel'
import MoneyCards from '@/components/customer-file/MoneyCards'
import ThreadPanel from '@/components/customer-file/ThreadPanel'
import ContractListItem from '@/components/contracts/ContractListItem'
import { Card, CardContent, CardHeader, CardTitle, StatusPill } from '@/components/ui'
import JobView from '@/app/ops/jobs/[id]/JobView'
import OpportunityView from '@/app/opportunities/[id]/OpportunityView'
import { isFileTab, type FileTab } from '@/lib/customer-file/access'
import { loadFile } from '@/lib/customer-file/load'
import { createServiceClient } from '@/lib/supabase/service'

/** One tab's content. Each tab is its own route, so only the active one runs its queries. */
export default async function TabBody({ customerId, dealId, tab }: { customerId: string; dealId: string; tab: string }) {
  if (!isFileTab(tab)) notFound()
  const ctx = await loadFile(customerId, dealId)
  if (!ctx.tabs.includes(tab)) notFound()
  const t: FileTab = tab

  switch (t) {
    case 'overview':
      return <Overview customerId={customerId} dealId={dealId} />
    case 'sales':
      // The existing opportunity page, re-shelled (no second Nav).
      return <OpportunityView params={{ id: dealId }} embedded />
    case 'job':
      return ctx.job ? <JobView params={{ id: ctx.job.id }} embedded /> : notFound()
    case 'money':
      return ctx.job ? (
        <MoneyCards jobId={ctx.job.id} saleAmount={ctx.job.sale_amount} jobSource={null} customerEmail={ctx.customer.email} canBill={ctx.canViewJobBilling} />
      ) : notFound()
    case 'files':
      return <Files customerId={customerId} dealId={dealId} />
    case 'notes':
      return <ThreadPanel customerId={customerId} dealId={dealId} variant="page" />
  }
}

async function Overview({ customerId, dealId }: { customerId: string; dealId: string }) {
  const ctx = await loadFile(customerId, dealId)
  const base = `/c/${customerId}/d/${dealId}`
  const { job, deal, customer } = ctx
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>This deal</CardTitle><StatusPill domain="opportunity" value={deal.status} /></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-ui-base text-ink">
            <dt className="text-ink-muted">Address</dt><dd>{deal.address_text || customer.address_text || '—'}</dd>
            <dt className="text-ink-muted">Phone</dt><dd>{customer.phone || '—'}</dd>
            <dt className="text-ink-muted">Email</dt><dd className="break-all">{customer.email || '—'}</dd>
            <dt className="text-ink-muted">Proposals</dt><dd>{ctx.proposalCount}</dd>
            <dt className="text-ink-muted">Contract</dt><dd>{ctx.signedContract ? 'Signed' : 'Not signed'}</dd>
          </dl>
          {(ctx.viewer.ownerLike || ctx.viewer.managerLike || ctx.viewer.jobBoard) && (
            <Link href={`/customers/${customer.id}`} className="mt-3 mr-4 inline-flex min-h-tap items-center text-ui-sm font-semibold text-brand-800 underline">Customer account (referrals, add-on deals) ▸</Link>
          )}
          {ctx.next && ctx.tabs.includes(ctx.next.tab) && (
            <Link href={`${base}/${ctx.next.tab}`} className="mt-3 inline-flex min-h-tap items-center rounded-ui bg-brand-700 px-4 text-ui-sm font-semibold text-white">{ctx.next.label} ▸</Link>
          )}
        </CardContent>
      </Card>

      {job && (
        <Card>
          <CardHeader><CardTitle>Job {job.job_number}</CardTitle><StatusPill domain="job" value={job.status} /></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-ui-base text-ink">
              <dt className="text-ink-muted">Install date</dt><dd>{job.scheduled_date ? new Date(`${job.scheduled_date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Not scheduled'}</dd>
              <dt className="text-ink-muted">Materials</dt><dd>{job.materials_status || '—'}{job.materials_eta ? ` · ETA ${job.materials_eta}` : ''}</dd>
            </dl>
            {ctx.tabs.includes('job') && <Link href={`${base}/job`} className="mt-3 inline-flex min-h-tap items-center text-ui-sm font-semibold text-brand-800 underline">Open the job ▸</Link>}
          </CardContent>
        </Card>
      )}

      {ctx.deals.length > 1 && (
        <Card>
          <CardHeader><CardTitle>All deals</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {ctx.deals.map((d) => (
                <li key={d.id}><Link href={`/c/${customerId}/d/${d.id}`} className="inline-flex min-h-tap items-center text-ui-base text-brand-800 underline">{d.address_text || 'Deal'} · {new Date(d.created_at).getFullYear()}</Link></li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

async function Files({ customerId, dealId }: { customerId: string; dealId: string }) {
  const ctx = await loadFile(customerId, dealId)
  const admin = createServiceClient()
  const { data: contracts } = await admin
    .from('order_form_contracts')
    .select('id, status, signing_token, customer_signed_at, pdf_url, created_at, agreement_type')
    .eq('opportunity_id', dealId)
    .eq('org_id', ctx.viewer.orgId)
    .order('created_at', { ascending: false })
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Contracts</CardTitle></CardHeader>
        <CardContent>
          {(contracts ?? []).length === 0 ? <p className="text-ui-base text-ink-muted">No contracts yet.</p> : (
            <div className="space-y-3">{(contracts ?? []).map((c) => <ContractListItem key={c.id} contract={c as never} />)}</div>
          )}
        </CardContent>
      </Card>
      {ctx.job && (
        <FilesPanel jobId={ctx.job.id} userRole={ctx.profile.role} canSeeFinancials={ctx.viewer.jobFinancials || ctx.viewer.ownerLike} jobStatus={ctx.job.status} customerEmail={ctx.customer.email} />
      )}
    </div>
  )
}
