import Link from 'next/link'

import CreateAddOnOpportunityButton from '@/components/customers/CreateAddOnOpportunityButton'
import LinkProjectToCustomerButton from '@/components/customers/LinkProjectToCustomerButton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { formatDate } from '@/lib/format'

export type AccountLead = { id: string; homeowner_name: string | null; address_text: string | null; status: string | null }
export type AccountProject = { id: string; project_type: string | null; address_text: string | null }
export type AccountActivity = { id: string; type: string | null; body: string | null; created_at: string; users?: { full_name: string | null } | null }

/**
 * The Customer File's Account card (what the old /customers/[id] page held): start a deal, link a project, new work order,
 * the customer's leads and projects, and a collapsed "Account activity" across their leads, projects and deals. The caller
 * (CustomerCards) loads the rows org-scoped and passes activity through visibleActivities, so this only draws them.
 */
export default function AccountCard({ customerId, customerName, leads, projects, activities }: { customerId: string; customerName: string | null; leads: AccountLead[]; projects: AccountProject[]; activities: AccountActivity[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Account</CardTitle></CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <CreateAddOnOpportunityButton customerId={customerId} />
          <LinkProjectToCustomerButton customerId={customerId} customerName={customerName} />
          <Link href={`/work-orders/new?customer=${customerId}`} className="inline-flex min-h-tap items-center rounded-ui border border-surface-line px-4 text-ui-sm font-semibold text-ink">New work order</Link>
        </div>
        {leads.length > 0 && (
          <div className="mt-4">
            <h3 className="text-ui-sm font-semibold text-ink">Leads</h3>
            <ul className="divide-y divide-surface-line">
              {leads.map((l) => (
                <li key={l.id}>
                  <Link href={`/leads/${l.id}`} className="flex min-h-tap flex-wrap items-center justify-between gap-2 py-2 text-ui-base text-brand-800 underline">
                    <span>{l.homeowner_name || 'Lead'}{l.address_text ? ` · ${l.address_text}` : ''}</span>
                    <span className="text-ui-sm capitalize text-ink">{String(l.status ?? '').replace(/_/g, ' ')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {projects.length > 0 && (
          <div className="mt-4">
            <h3 className="text-ui-sm font-semibold text-ink">Projects</h3>
            <ul className="divide-y divide-surface-line">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="flex min-h-tap items-center py-2 text-ui-base text-brand-800 underline">
                    {p.project_type || 'Project'}{p.address_text ? ` · ${p.address_text}` : ''}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {activities.length > 0 && (
          <details className="mt-4">
            <summary className="flex min-h-tap cursor-pointer items-center text-ui-sm font-semibold text-ink">Account activity ({activities.length})</summary>
            <ul className="divide-y divide-surface-line">
              {activities.map((a) => (
                <li key={a.id} className="py-2 text-ui-base text-ink">
                  <div className="flex flex-wrap justify-between gap-2 text-ui-sm">
                    <span className="font-semibold">{a.users?.full_name || 'Someone'} · <span className="capitalize">{String(a.type ?? '').replace(/_/g, ' ')}</span></span>
                    <span>{formatDate(a.created_at)}</span>
                  </div>
                  {a.body ? <p className="mt-1 whitespace-pre-wrap break-words">{a.body}</p> : null}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
