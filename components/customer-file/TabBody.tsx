import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CustomerDocuments, CustomerRecords } from '@/components/customer-file/CustomerRecords'
import FilesPanel from '@/components/customer-file/FilesPanel'
import MoneyCards from '@/components/customer-file/MoneyCards'
import ThreadPanel from '@/components/customer-file/ThreadPanel'
import ContractListItem from '@/components/contracts/ContractListItem'
import { Card, CardContent, CardHeader, CardTitle, StatusPill } from '@/components/ui'
import JobView from '@/app/ops/jobs/[id]/JobView'
import OpportunityView from '@/app/opportunities/[id]/OpportunityView'
import { loadCheckups } from '@/lib/checkups'
import { formatDate } from '@/lib/format'
import { isFileTab, type FileTab } from '@/lib/customer-file/access'
import { loadFile } from '@/lib/customer-file/load'
import { loadCustomerExtras } from '@/lib/customer-file/customer-extras'
import { createServiceClient } from '@/lib/supabase/service'
import PhoneLink from '@/components/PhoneLink'
import TaxExemptionCard from '@/components/customer/TaxExemptionCard'
import { loadCustomerTaxExemption, loadOrgSalesTax } from '@/lib/sales-tax-server'
import { orgDb } from '@/lib/supabase/org-db'

async function loadTaxExemptionCard(orgId: string, customerId: string) {
  const admin = createServiceClient()
  if (!(await loadOrgSalesTax(admin, orgId))) return null
  const [initial, { data: docs }] = await Promise.all([
    loadCustomerTaxExemption(admin, orgId, customerId),
    orgDb(admin, orgId).from('documents').select('id, title, filename').eq('customer_id', customerId).is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
  ])
  const documents = ((docs ?? []) as Array<{ id: string; title: string | null; filename: string | null }>).map((d) => ({ id: d.id, label: d.title || d.filename || 'File' }))
  return { initial, documents }
}

/** One tab's content. Each tab is its own route, so only the active one runs its queries. */
export default async function TabBody({ customerId, dealId, tab, jobTab = null }: { customerId: string; dealId: string; tab: string; jobTab?: string | null }) {
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
      return ctx.job ? (
        <JobView
          params={{ id: ctx.job.id }}
          embedded
          initialTab={jobTab}
          notesSlot={<ThreadPanel customerId={customerId} dealId={dealId} variant="page" />}
        />
      ) : notFound()
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
  // Checkups are job-side: only people with the job board see them (field roles never do).
  const admin = createServiceClient()
  const [checkups, extras, taxExemption] = await Promise.all([
    ctx.viewer.jobBoard || ctx.viewer.ownerLike
      ? loadCheckups(admin, ctx.viewer.orgId, { customerId: customer.id }).catch(() => null)
      : Promise.resolve(null),
    // The customer's own records: properties and the company's custom fields (lib/customer-file/customer-extras.ts).
    loadCustomerExtras(admin, ctx.viewer, customer.id).catch(() => null),
    // Sales tax exemption: billing staff, and only once the company has set up sales tax (lib/sales-tax.ts).
    ctx.canViewJobBilling ? loadTaxExemptionCard(ctx.viewer.orgId, customer.id).catch(() => null) : Promise.resolve(null),
  ])
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>This deal</CardTitle><StatusPill domain="opportunity" value={deal.status} /></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-ui-base text-ink">
            <dt className="text-ink-muted">Address</dt><dd>{deal.address_text || customer.address_text || '—'}</dd>
            <dt className="text-ink-muted">Phone</dt><dd><PhoneLink value={customer.phone} /></dd>
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

      {extras && <CustomerRecords customerId={customer.id} extras={extras} />}

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

      {taxExemption && <TaxExemptionCard proposalWord={ctx.proposalWord} customerId={customer.id} initial={taxExemption.initial} documents={taxExemption.documents} />}

      {checkups && checkups.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Checkups</CardTitle><Link href="/ops/checkups" className="text-ui-sm font-semibold text-brand-800 underline">All checkups ▸</Link></CardHeader>
          <CardContent>
            <ul className="divide-y divide-surface-line">
              {checkups.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-ui-base text-ink">
                  <span className="font-medium">{c.label}</span>
                  <span>
                    {c.status === 'done'
                      ? `Done ${c.done_at ? formatDate(c.done_at) : ''}${c.result ? ` · ${c.result === 'green' ? 'Green' : c.result === 'yellow' ? 'Yellow' : 'Red'}` : ''}`
                      : c.status === 'booked'
                        ? `Booked ${formatDate(c.booked_for)}`
                        : c.status === 'declined'
                          ? 'Customer declined'
                          : c.status === 'unreachable'
                            ? 'Couldn’t reach'
                            : `Due ${formatDate(c.due_on)}`}
                  </span>
                  {c.notes && <p className="w-full whitespace-pre-wrap text-ui-sm">{c.notes}</p>}
                </li>
              ))}
            </ul>
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
  const extras = await loadCustomerExtras(admin, ctx.viewer, customerId).catch(() => null)
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
      {extras && <CustomerDocuments customerId={customerId} orgId={ctx.viewer.orgId} extras={extras} />}
      {ctx.job && (
        <FilesPanel jobId={ctx.job.id} userRole={ctx.profile.role} canSeeFinancials={ctx.viewer.jobFinancials || ctx.viewer.ownerLike} jobStatus={ctx.job.status} customerEmail={ctx.customer.email} />
      )}
    </div>
  )
}
