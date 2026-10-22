/**
 * Sale credit on a deal: who closed it, who set it, and whether the closer self-generated it.
 *
 * Owner decision (Nathan, 2026-10-21): sale credit is CONFIRMED on the contract signing
 * screen and saved with the deal. After the contract is signed only a SUPER ADMIN may
 * change it, and every change after signing is logged with who/when/why.
 *
 * Source of truth (unchanged — this module does not add a second one):
 *   closer         → opportunities.owner_user_id  (copied down to projects.owner_user_id and
 *                    production_jobs.salesperson_id by syncCloserAttributionDownstream)
 *   setter         → opportunities.setter_user_id
 *   self-generated → opportunities.is_self_generated (+ self_generated_source = 'manual'),
 *                    the 6% self-gen line in payroll
 * Payroll reads exactly these (collectParticipants + lib/job-self-gen-attribution.ts). The
 * manager override is derived from the org chart at the sale date and is not "credit" a rep
 * confirms; `deal_commission_roles` stays the place for per-job PAY overrides, not credit.
 *
 * Every writer of these three fields goes through `saveDealSaleCredit` — the contract create
 * route, PATCH /api/opportunities/[id] and PATCH /api/admin/payroll/self-generated.
 * (Pre-sale writers that stamp the setter when an inspection is booked — canvass/inspection
 * routes — run before any contract exists, so the lock never applies to them.)
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSuperAdmin, type SuperAdminProfile } from '@/lib/super-admin'
import { syncCloserAttributionDownstream } from '@/lib/payroll-attribution-sync'
import { payableSelfGenFlag } from '@/lib/job-self-gen-attribution'

export type DealSaleCredit = {
  closerUserId: string | null
  setterUserId: string | null
  isSelfGenerated: boolean | null
}

export type SaleCreditActor = {
  id: string
  full_name?: string | null
} & NonNullable<SuperAdminProfile>

const SALE_AGREEMENT_TYPES = ['installation', 'repair']

type OpportunityCreditRow = {
  id: string
  owner_user_id: string | null
  setter_user_id: string | null
  is_self_generated: boolean | null
  self_generated_source: string | null
  lead_id: string | null
}

async function loadOpportunity(admin: SupabaseClient, orgId: string, opportunityId: string) {
  const { data, error } = await admin
    .from('opportunities')
    .select('id, owner_user_id, setter_user_id, is_self_generated, self_generated_source, lead_id')
    .eq('id', opportunityId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) throw error
  return (data as OpportunityCreditRow | null) ?? null
}

/** True once the customer has signed a sale agreement (installation or repair) on this deal. */
export async function isSaleCreditLocked(
  admin: SupabaseClient,
  orgId: string,
  opportunityId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('order_form_contracts')
    .select('id')
    .eq('org_id', orgId)
    .eq('opportunity_id', opportunityId)
    .eq('status', 'completed')
    .in('agreement_type', SALE_AGREEMENT_TYPES)
    .limit(1)
  if (error) throw error
  return (data || []).length > 0
}

/**
 * What the signing screen pre-fills: the deal's stored credit, with the setter falling back
 * to the canvass pin owner on older records where setter_user_id was never populated (the
 * same fallback contract signing already used for its "who sold it" email).
 */
export async function loadDealSaleCredit(
  admin: SupabaseClient,
  orgId: string,
  opportunityId: string
): Promise<{ credit: DealSaleCredit; locked: boolean } | null> {
  const opp = await loadOpportunity(admin, orgId, opportunityId)
  if (!opp) return null
  let setterUserId = opp.setter_user_id
  if (!setterUserId && opp.lead_id) {
    const { data: lead } = await admin
      .from('leads')
      .select('owner_user_id')
      .eq('id', opp.lead_id)
      .eq('org_id', orgId)
      .maybeSingle()
    setterUserId = (lead?.owner_user_id as string | null) ?? null
  }
  return {
    credit: {
      closerUserId: opp.owner_user_id,
      setterUserId,
      // Pre-fill shows the stored guess too; saving it on the signing screen confirms it.
      isSelfGenerated: opp.is_self_generated,
    },
    locked: await isSaleCreditLocked(admin, orgId, opportunityId),
  }
}

export type SaleCreditChange = Partial<DealSaleCredit>

/** Pure: which fields actually change. Absent keys mean "leave alone". */
export function diffSaleCredit(current: DealSaleCredit, next: SaleCreditChange): SaleCreditChange {
  const changed: SaleCreditChange = {}
  if ('closerUserId' in next && (next.closerUserId ?? null) !== (current.closerUserId ?? null)) {
    changed.closerUserId = next.closerUserId ?? null
  }
  if ('setterUserId' in next && (next.setterUserId ?? null) !== (current.setterUserId ?? null)) {
    changed.setterUserId = next.setterUserId ?? null
  }
  if (
    'isSelfGenerated' in next &&
    next.isSelfGenerated != null &&
    next.isSelfGenerated !== (current.isSelfGenerated ?? null)
  ) {
    changed.isSelfGenerated = next.isSelfGenerated
  }
  return changed
}

/**
 * Pure gate. Returns an error (status + plain-English message) or null when the save may go ahead.
 */
export function checkSaleCreditChange(args: {
  locked: boolean
  actor: SaleCreditActor
  merged: DealSaleCredit
  changed: SaleCreditChange
  reason: string | null | undefined
}): { status: number; error: string } | null {
  const { locked, actor, merged, changed, reason } = args
  if (Object.keys(changed).length === 0) return null
  if (locked && !isSuperAdmin(actor)) {
    return {
      status: 403,
      error: 'Sale credit is locked once the contract is signed. Only an owner can change it.',
    }
  }
  if (locked && !(reason || '').trim()) {
    return { status: 400, error: 'Give a reason for changing sale credit after the contract was signed.' }
  }
  // A self-generated deal has no separate setter; paying both would breach the 18% pool.
  if (merged.isSelfGenerated === true && merged.setterUserId && merged.setterUserId !== merged.closerUserId) {
    return {
      status: 400,
      error: 'A self-generated deal has no separate setter. Clear the setter, or untick self-generated.',
    }
  }
  return null
}

export type SaveSaleCreditResult =
  | { ok: true; changed: SaleCreditChange; credit: DealSaleCredit; locked: boolean }
  | { ok: false; status: number; error: string }

/**
 * The one writer of a deal's sale credit. Validates, writes the opportunity (and the closer
 * copies downstream), records an activity note, and — when the contract is already signed —
 * appends a `payroll_override_audit` row ('sale_credit_change'). If that audit row cannot be
 * written the change is reverted: a pay-affecting edit never stands unlogged.
 */
export async function saveDealSaleCredit(
  admin: SupabaseClient,
  args: {
    orgId: string
    opportunityId: string
    actor: SaleCreditActor
    next: SaleCreditChange
    reason?: string | null
  }
): Promise<SaveSaleCreditResult> {
  const { orgId, opportunityId, actor } = args
  const opp = await loadOpportunity(admin, orgId, opportunityId)
  if (!opp) return { ok: false, status: 404, error: 'Opportunity not found' }

  const current: DealSaleCredit = {
    closerUserId: opp.owner_user_id,
    setterUserId: opp.setter_user_id,
    // Payroll only pays a CONFIRMED flag (payableSelfGenFlag): an inferred value counts as
    // unconfirmed, so confirming it is a change that stamps it 'manual'.
    isSelfGenerated: payableSelfGenFlag(opp.is_self_generated, opp.self_generated_source),
  }
  const changed = diffSaleCredit(current, args.next)
  const merged: DealSaleCredit = { ...current, ...changed }
  if (Object.keys(changed).length === 0) {
    return { ok: true, changed, credit: current, locked: false }
  }

  const locked = await isSaleCreditLocked(admin, orgId, opportunityId)
  const gate = checkSaleCreditChange({ locked, actor, merged, changed, reason: args.reason })
  if (gate) return { ok: false, ...gate }

  // Anyone credited must be in this org.
  const userIds = [changed.closerUserId, changed.setterUserId].filter((v): v is string => Boolean(v))
  if (userIds.length > 0) {
    const { data: users, error } = await admin
      .from('users')
      .select('id')
      .eq('org_id', orgId)
      .in('id', userIds)
    if (error) return { ok: false, status: 500, error: 'Could not check users' }
    const found = new Set((users || []).map((u) => u.id as string))
    if (userIds.some((id) => !found.has(id))) {
      return { ok: false, status: 400, error: 'Pick a closer and setter from your team.' }
    }
  }

  const oppUpdate: Record<string, unknown> = {}
  if ('closerUserId' in changed) oppUpdate.owner_user_id = changed.closerUserId
  if ('setterUserId' in changed) oppUpdate.setter_user_id = changed.setterUserId
  if (Object.keys(oppUpdate).length > 0) {
    const { error } = await admin
      .from('opportunities')
      .update(oppUpdate)
      .eq('id', opportunityId)
      .eq('org_id', orgId)
    if (error) return { ok: false, status: 500, error: 'Failed to save sale credit' }
  }
  if ('isSelfGenerated' in changed) {
    const { error } = await admin.rpc('confirm_opportunity_self_generated', {
      p_org_id: orgId,
      p_opportunity_id: opportunityId,
      p_is_self_generated: changed.isSelfGenerated,
      p_confirmed_by: actor.id,
    })
    if (error) {
      if (Object.keys(oppUpdate).length > 0) {
        await admin
          .from('opportunities')
          .update({ owner_user_id: current.closerUserId, setter_user_id: current.setterUserId })
          .eq('id', opportunityId)
          .eq('org_id', orgId)
      }
      return { ok: false, status: 500, error: 'Failed to save self-generated' }
    }
  }

  if (locked) {
    const { data: jobs } = await admin
      .from('production_jobs')
      .select('id, project:projects!inner(opportunity_id)')
      .eq('org_id', orgId)
      .eq('project.opportunity_id', opportunityId)
    const jobIds = (jobs || []).map((j) => j.id as string)
    const auditRows = (jobIds.length > 0 ? jobIds : [null]).map((jobId) => ({
      org_id: orgId,
      override_type: 'sale_credit_change',
      job_id: jobId,
      actor_user_id: actor.id,
      reason: String(args.reason || '').trim(),
      before_value: { opportunity_id: opportunityId, ...current },
      after_value: { opportunity_id: opportunityId, ...merged },
    }))
    const { error: auditError } = await admin.from('payroll_override_audit').insert(auditRows)
    if (auditError) {
      console.error('[deal-sale-credit] audit failed — reverting', auditError)
      await admin
        .from('opportunities')
        .update({ owner_user_id: current.closerUserId, setter_user_id: current.setterUserId })
        .eq('id', opportunityId)
        .eq('org_id', orgId)
      if ('isSelfGenerated' in changed && current.isSelfGenerated != null) {
        await admin.rpc('confirm_opportunity_self_generated', {
          p_org_id: orgId,
          p_opportunity_id: opportunityId,
          p_is_self_generated: current.isSelfGenerated,
          p_confirmed_by: actor.id,
        })
      }
      return { ok: false, status: 500, error: 'Could not record the reason. Sale credit was not changed.' }
    }
  }

  if ('closerUserId' in changed) {
    await syncCloserAttributionDownstream(admin, {
      orgId,
      closerUserId: changed.closerUserId ?? null,
      opportunityId,
    })
  }

  // Readable trail on the deal itself.
  const ids = Array.from(
    new Set(
      [current.closerUserId, current.setterUserId, merged.closerUserId, merged.setterUserId].filter(
        (v): v is string => Boolean(v)
      )
    )
  )
  const nameById = new Map<string, string>()
  if (ids.length > 0) {
    const { data: names } = await admin.from('users').select('id, full_name').eq('org_id', orgId).in('id', ids)
    for (const u of names || []) nameById.set(u.id as string, (u.full_name as string) || 'Unknown')
  }
  const fmt = (id: string | null | undefined) => (id ? nameById.get(id) || 'Unknown' : 'nobody')
  const parts = [
    locked
      ? `Sale credit changed after signing by ${actor.full_name || 'an owner'}. Reason: ${String(args.reason || '').trim()}.`
      : `Sale credit confirmed by ${actor.full_name || 'the rep'} at contract signing.`,
  ]
  if ('closerUserId' in changed) parts.push(`Closer: ${fmt(current.closerUserId)} → ${fmt(merged.closerUserId)}.`)
  if ('setterUserId' in changed) parts.push(`Setter: ${fmt(current.setterUserId)} → ${fmt(merged.setterUserId)}.`)
  if ('isSelfGenerated' in changed) parts.push(`Self-generated: ${merged.isSelfGenerated ? 'yes' : 'no'}.`)
  await admin.from('activities').insert({
    org_id: orgId,
    opportunity_id: opportunityId,
    user_id: actor.id,
    type: 'note',
    body: parts.join(' '),
  })

  return { ok: true, changed, credit: merged, locked }
}
