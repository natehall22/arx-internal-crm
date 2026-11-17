import Link from 'next/link'
import { revalidatePath } from 'next/cache'

import ContractListItem from '@/components/contracts/ContractListItem'
import DeleteOpportunityButton from '@/components/DeleteOpportunityButton'
import DeleteProposalButton from '@/components/opportunities/DeleteProposalButton'
import ReferredByPicker from '@/components/referral-partners/ReferredByPicker'
import { Card, CardContent, CardHeader, CardTitle, StatusPill } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { loadFile } from '@/lib/customer-file/load'
import { formatDate, formatMoney } from '@/lib/format'
import { getOrgFeatures } from '@/lib/org-features-server'
import { loadOrgProfile, outcomeLabel, pageHidden, t } from '@/lib/org-profile'
import { markOpportunityLost } from '@/lib/opportunity-lost'
import { isOrgSuperuserRoleSlug } from '@/lib/permissions'
import { assignedToLabel, canSetReferredBy, getPartnerAccess, type ReferralPartnerRow } from '@/lib/referral-partners'
import { creditLaneWords } from '@/lib/sale-credit-words'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Customer File → Sales tab for companies that are not roofing: the deal's people, the estimate-visit step, quotes and
 * agreements in the same cards as the Overview. Roofing keeps the opportunity page (app/opportunities/[id]/OpportunityView.tsx,
 * its roof sections) — see TabBody. Pieces are the existing ones (ReferredByPicker, DeleteProposalButton, ContractListItem,
 * the one `markOpportunityLost` writer); the next-step line is a short version of the opportunity page's (Known Redundancy).
 */
export default async function SalesTab({ customerId, dealId }: { customerId: string; dealId: string }) {
  const ctx = await loadFile(customerId, dealId)
  const { profile, authUser } = await requireAuth()
  const admin = createServiceClient()
  const orgId = ctx.viewer.orgId
  const [orgProfile, features] = await Promise.all([loadOrgProfile(admin, orgId), getOrgFeatures(orgId)])
  const lane = creditLaneWords(features.canvassing)
  const inspWord = t(orgProfile, 'inspection')
  const propWord = t(orgProfile, 'proposal')
  const lower = (s: string) => s.toLowerCase()

  const [{ data: opp }, { data: proposals }, { data: contracts }] = await Promise.all([
    admin.from('opportunities').select('id, status, project_type, owner_user_id, setter_user_id, lead_id, address_text, customer_name, inspection_outcome, referral_partner_id').eq('id', dealId).eq('org_id', orgId).maybeSingle(),
    admin.from('proposals').select('id, proposal_number, title, status, total, created_at, created_by').eq('opportunity_id', dealId).eq('org_id', orgId).order('created_at', { ascending: false }),
    admin.from('order_form_contracts').select('id, status, signing_token, customer_signed_at, pdf_url, created_at, agreement_type').eq('opportunity_id', dealId).eq('org_id', orgId).order('created_at', { ascending: false }),
  ])
  if (!opp) return null

  const ids = [opp.owner_user_id, opp.setter_user_id].filter(Boolean) as string[]
  const { data: people } = ids.length ? await admin.from('users').select('id, full_name').in('id', ids).eq('org_id', orgId) : { data: [] as Array<{ id: string; full_name: string | null }> }
  const nameOf = (id: string | null) => (people ?? []).find((p) => p.id === id)?.full_name || '—'

  let referredBy: { id: string; name: string; assigned_to: string } | null = null
  if (opp.referral_partner_id) {
    const { data: partner } = await admin
      .from('referral_partners')
      .select('id, name, status, assignee:users!referral_partners_assigned_user_id_fkey(id, full_name)')
      .eq('id', opp.referral_partner_id)
      .eq('org_id', orgId)
      .maybeSingle()
    if (partner) referredBy = { id: partner.id, name: partner.name, assigned_to: assignedToLabel(partner as unknown as Pick<ReferralPartnerRow, 'status' | 'assignee'>) }
  }
  const showReferredBy = !pageHidden(orgProfile, '/referral-partners') || referredBy

  const open = opp.status !== 'lost' && opp.status !== 'won'
  const list = proposals ?? []
  const base = `/c/${customerId}/d/${dealId}`
  const builderUrl = `/proposals/builder?opportunity_id=${dealId}&customer_name=${encodeURIComponent(ctx.customer.name || '')}&customer_address=${encodeURIComponent(opp.address_text || '')}`
  const visitUrl = ctx.deal.lead_id ? `/appointments/feedback?lead_id=${ctx.deal.lead_id}` : null

  // Next step (short version of the opportunity page's): visit → quote → approval → work.
  let step: { title: string; body: string; href?: string; label?: string } | null = null
  if (opp.status === 'won') step = { title: 'Won', body: `Schedule the work from the ${lower(t(orgProfile, 'jobBoard'))}.`, href: '/ops', label: `Go to ${t(orgProfile, 'jobBoard')}` }
  else if (opp.status === 'lost') step = { title: 'Marked as lost', body: 'You can reopen this if the customer comes back.' }
  else if (!opp.inspection_outcome) step = { title: `${inspWord} needed`, body: `Do the ${lower(inspWord)} and log what you found.`, ...(visitUrl ? { href: visitUrl, label: `Log the ${lower(inspWord)}` } : {}) }
  else if (list.length === 0) step = { title: `Build the ${lower(propWord)}`, body: `The ${lower(inspWord)} is done.`, href: builderUrl, label: `Build the ${lower(propWord)}` }
  else if (!list.some((p) => p.status === 'accepted')) step = { title: `Send the ${lower(propWord)} for approval`, body: features.quoteApproval ? 'Open it to send the customer their approval link.' : 'Open it to send it to the customer.', href: `/proposals/${list[0].id}`, label: `Open the ${lower(propWord)}` }
  else step = { title: `${propWord} approved`, body: 'Schedule the work.', href: '/ops', label: `Go to ${t(orgProfile, 'jobBoard')}` }

  const lostAction = async () => {
    'use server'
    await markOpportunityLost(dealId, opp.lead_id ?? null)
    revalidatePath(base)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Deal</CardTitle>
          <StatusPill domain="opportunity" value={opp.status} />
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-ui-base text-ink">
            <dt className="text-ink-muted">{lane.closer}</dt><dd>{nameOf(opp.owner_user_id)}</dd>
            {(lane.showSetter || opp.setter_user_id) && (<><dt className="text-ink-muted">Set by</dt><dd>{nameOf(opp.setter_user_id)}</dd></>)}
            {opp.project_type && opp.project_type !== 'roofing' && opp.project_type !== 'other' && (<><dt className="text-ink-muted">Type</dt><dd className="capitalize">{opp.project_type}</dd></>)}
            <dt className="text-ink-muted">{inspWord}</dt>
            <dd>{opp.inspection_outcome ? outcomeLabel(orgProfile, opp.inspection_outcome, opp.inspection_outcome.replace(/_/g, ' ')) : 'Not done yet'}</dd>
          </dl>
          {showReferredBy && (
            <div className="mt-3">
              <ReferredByPicker opportunityId={dealId} current={referredBy} canEdit={canSetReferredBy(profile.role, await getPartnerAccess(admin, authUser.id, profile))} />
            </div>
          )}
          {(open || isOrgSuperuserRoleSlug(profile.role)) && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-surface-line pt-3">
              {open && (
                <form action={lostAction}>
                  <button type="submit" className="inline-flex min-h-tap items-center rounded-ui border border-surface-line px-4 text-ui-sm font-semibold text-ink hover:bg-surface-sunken">Mark as lost</button>
                </form>
              )}
              {isOrgSuperuserRoleSlug(profile.role) && <DeleteOpportunityButton opportunityId={dealId} customerName={ctx.customer.name ?? undefined} />}
            </div>
          )}
        </CardContent>
      </Card>

      {step && (
        <Card>
          <CardHeader><CardTitle>Next step</CardTitle></CardHeader>
          <CardContent>
            <p className="font-semibold text-ink">{step.title}</p>
            <p className="mt-1 text-ink-muted">{step.body}</p>
            {step.href && <Link href={step.href} className="mt-3 inline-flex min-h-tap items-center rounded-ui bg-brand-700 px-4 text-ui-sm font-semibold text-white">{step.label} ▸</Link>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{`${propWord}s`}</CardTitle>
          <Link href={builderUrl} className="inline-flex min-h-tap items-center rounded-ui bg-brand-700 px-4 text-ui-sm font-semibold text-white">{`Build the ${lower(propWord)}`}</Link>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-ink-muted">{`No ${lower(propWord)}s yet.`}</p>
          ) : (
            <ul className="divide-y divide-surface-line">
              {list.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/proposals/${p.id}`} className="flex min-h-tap min-w-0 flex-1 flex-col justify-center text-ink">
                    <span className="font-medium">{p.proposal_number} · {p.title || `Untitled ${lower(propWord)}`}</span>
                    <span className="text-ui-sm text-ink-muted">
                      <span className="capitalize">{p.status}</span> · {formatDate(p.created_at)}
                      {features.quoteApproval && p.status !== 'accepted' && p.status !== 'declined' ? ' · open to send for approval' : ''}
                    </span>
                  </Link>
                  <span className="shrink-0 font-semibold text-ink">{formatMoney(p.total || 0)}</span>
                  <DeleteProposalButton proposalId={p.id} proposalNumber={p.proposal_number} status={p.status} createdBy={p.created_by} currentUserId={profile.id} userRole={profile.role} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agreements</CardTitle>
          <Link href="/signing" className="inline-flex min-h-tap items-center rounded-ui border border-surface-line px-4 text-ui-sm font-semibold text-ink">Send an agreement</Link>
        </CardHeader>
        <CardContent>
          {(contracts ?? []).length === 0 ? <p className="text-ink-muted">No agreements yet.</p> : (
            <div className="space-y-3">{(contracts ?? []).map((c) => <ContractListItem key={c.id} contract={c as never} />)}</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
