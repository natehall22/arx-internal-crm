import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Job notes live in the deal's thread (`activities`). These two functions are what every old
 * `production_job_notes` reader/writer now goes through, so there is still exactly one place notes are stored.
 * A job with no deal (should not exist) falls back to the legacy table rather than losing the note.
 */

/** job → project → opportunity (the deal that owns the thread). */
export async function dealIdForJob(admin: SupabaseClient, orgId: string, jobId: string): Promise<{ dealId: string | null; customerId: string | null; leadId: string | null }> {
  const { data: job } = await admin.from('production_jobs').select('project_id').eq('id', jobId).eq('org_id', orgId).maybeSingle()
  const projectId = (job as { project_id: string | null } | null)?.project_id
  if (!projectId) return { dealId: null, customerId: null, leadId: null }
  const { data: project } = await admin.from('projects').select('opportunity_id').eq('id', projectId).eq('org_id', orgId).maybeSingle()
  const oppId = (project as { opportunity_id: string | null } | null)?.opportunity_id
  if (!oppId) return { dealId: null, customerId: null, leadId: null }
  const { data: opp } = await admin.from('opportunities').select('customer_id, lead_id').eq('id', oppId).eq('org_id', orgId).maybeSingle()
  const o = opp as { customer_id: string | null; lead_id: string | null } | null
  return { dealId: oppId, customerId: o?.customer_id ?? null, leadId: o?.lead_id ?? null }
}

/** The production job (if any) behind a deal, so Production/Crew messages can be listed per job. */
export async function jobIdForDeal(admin: SupabaseClient, orgId: string, dealId: string): Promise<string | null> {
  const { data: project } = await admin.from('projects').select('id').eq('opportunity_id', dealId).eq('org_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const projectId = (project as { id: string } | null)?.id
  if (!projectId) return null
  const { data: job } = await admin.from('production_jobs').select('id').eq('project_id', projectId).eq('org_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (job as { id: string } | null)?.id ?? null
}

/**
 * System/handoff job notes (cancellation, supplier order, project handoff). Audience Production, so setters never see
 * them. `system` rows collapse into "⟳ n updates" in the thread; `handoff` is a real, pinned Production message.
 */
export async function writeJobNote(
  admin: SupabaseClient,
  args: { orgId: string; jobId: string; userId: string | null; body: string; kind: 'system' | 'handoff' }
): Promise<{ ok: boolean; error?: string }> {
  const { dealId, customerId, leadId } = await dealIdForJob(admin, args.orgId, args.jobId)
  if (!dealId) {
    const { error } = await admin.from('production_job_notes').insert({ job_id: args.jobId, user_id: args.userId, note: args.body, is_internal: true })
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  const { error } = await admin.from('activities').insert({
    org_id: args.orgId,
    opportunity_id: dealId,
    customer_id: customerId,
    lead_id: leadId,
    production_job_id: args.jobId,
    user_id: args.userId,
    type: 'note',
    body: args.body,
    origin: args.kind === 'system' ? 'system' : 'human',
    audience: 'production',
    source: 'system',
    pinned_at: args.kind === 'handoff' ? new Date().toISOString() : null,
    pin_scope: args.kind === 'handoff' ? 'deal' : null,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

export type JobNote = { id: string; note: string; created_at: string; user_id: string | null; author_name: string | null; share_with_sub: boolean }

/**
 * Notes for a job, newest first. `crewOnly` = what may go on a sub/crew packet: Crew-audience messages that are not
 * price-flagged, plus legacy notes explicitly shared with the sub. Otherwise Production + Crew (the job page).
 * Legacy `production_job_notes` rows that were not copied into the thread yet are included so nothing disappears
 * between deploy and data fix; copied ones are matched by legacy_ref and not shown twice.
 */
export async function loadJobNotes(
  admin: SupabaseClient,
  orgId: string,
  jobId: string,
  opts: { crewOnly?: boolean; limit?: number } = {}
): Promise<JobNote[]> {
  const limit = opts.limit ?? 50
  const { dealId } = await dealIdForJob(admin, orgId, jobId)
  const out: JobNote[] = []
  const copied = new Set<string>()
  if (dealId) {
    const audiences = opts.crewOnly ? ['crew'] : ['production', 'crew']
    const { data } = await admin
      .from('activities')
      .select('id, body, created_at, user_id, audience, restricted_pricing, origin, legacy_ref, users(full_name)')
      .eq('org_id', orgId)
      .eq('opportunity_id', dealId)
      .in('audience', audiences)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit)
    for (const r of (data ?? []) as unknown as Array<{ id: string; body: string; created_at: string; user_id: string | null; audience: string; restricted_pricing: boolean | null; legacy_ref: { table?: string; id?: string } | null; users: { full_name: string | null } | { full_name: string | null }[] | null }>) {
      if (opts.crewOnly && r.restricted_pricing) continue
      if (r.legacy_ref?.table === 'production_job_notes' && r.legacy_ref.id) copied.add(r.legacy_ref.id)
      const u = Array.isArray(r.users) ? r.users[0] : r.users
      out.push({ id: r.id, note: r.body, created_at: r.created_at, user_id: r.user_id, author_name: u?.full_name ?? null, share_with_sub: r.audience === 'crew' })
    }
    // copies outside the page window must still suppress their legacy twin
    const { data: refs } = await admin.from('activities').select('legacy_ref').eq('org_id', orgId).eq('opportunity_id', dealId).not('legacy_ref', 'is', null)
    for (const r of (refs ?? []) as Array<{ legacy_ref: { table?: string; id?: string } | null }>) {
      if (r.legacy_ref?.table === 'production_job_notes' && r.legacy_ref.id) copied.add(r.legacy_ref.id)
    }
  }
  let legacy = admin.from('production_job_notes').select('id, note, created_at, user_id, share_with_sub, users(full_name)').eq('job_id', jobId)
  if (opts.crewOnly) legacy = legacy.eq('share_with_sub', true)
  const { data: old } = await legacy.order('created_at', { ascending: false }).limit(limit)
  for (const r of (old ?? []) as unknown as Array<{ id: string; note: string; created_at: string; user_id: string | null; share_with_sub: boolean | null; users: { full_name: string | null } | { full_name: string | null }[] | null }>) {
    if (copied.has(r.id)) continue
    const u = Array.isArray(r.users) ? r.users[0] : r.users
    out.push({ id: r.id, note: r.note, created_at: r.created_at, user_id: r.user_id, author_name: u?.full_name ?? null, share_with_sub: r.share_with_sub === true })
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit)
}
