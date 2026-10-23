/**
 * "Close out old appointments": past appointments (older than the Needs-you window) that nobody logged an outcome for are
 * marked "outcome not recorded" — an OWNER action, one batch at a time, every row audited, fully reversible. Nothing else
 * about the appointment changes (status stays), and reports drop them from the efficiency denominator.
 */
import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { APPOINTMENT_NEEDS_YOU_MAX_AGE_DAYS } from '@/lib/data-health'

const cutoff = (now: Date) => new Date(now.getTime() - APPOINTMENT_NEEDS_YOU_MAX_AGE_DAYS * 86_400_000).toISOString()

export type CloseoutPreview = { count: number; oldest: string | null; newest: string | null; recentBatches: Array<{ batchId: string; closed: number; at: string; reverted: boolean }> }

export async function previewCloseout(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<CloseoutPreview> {
  const base = () => admin.from('scheduled_appointments').select('scheduled_for', { count: 'exact' }).eq('org_id', orgId).eq('status', 'scheduled').lt('scheduled_for', cutoff(now)).is('outcome_not_recorded_at', null)
  const [{ count, error }, oldest, newest] = await Promise.all([
    base().limit(1),
    base().order('scheduled_for', { ascending: true }).limit(1),
    base().order('scheduled_for', { ascending: false }).limit(1),
  ])
  if (error) throw error
  const { data: audits } = await admin.from('appointment_closeouts').select('batch_id, created_at, reverted_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(50_000)
  const batches = new Map<string, { batchId: string; closed: number; at: string; reverted: boolean }>()
  for (const a of (audits ?? []) as Array<{ batch_id: string; created_at: string; reverted_at: string | null }>) {
    const b = batches.get(a.batch_id) ?? { batchId: a.batch_id, closed: 0, at: a.created_at, reverted: true }
    b.closed += 1
    if (!a.reverted_at) b.reverted = false
    batches.set(a.batch_id, b)
  }
  return {
    count: count ?? 0,
    oldest: ((oldest.data ?? [])[0] as { scheduled_for: string } | undefined)?.scheduled_for ?? null,
    newest: ((newest.data ?? [])[0] as { scheduled_for: string } | undefined)?.scheduled_for ?? null,
    recentBatches: Array.from(batches.values()).slice(0, 5),
  }
}

const CHUNK = 200
const MAX_PER_BATCH = 20_000

/** Marks every candidate in one batch (in chunks, so a big backlog never builds an oversized request). Returns the batch id (the undo handle). */
export async function closeOutOldAppointments(admin: SupabaseClient, input: { orgId: string; actorUserId: string; now?: Date }): Promise<{ batchId: string; closed: number }> {
  const now = input.now ?? new Date()
  const batchId = randomUUID()
  let closed = 0
  for (let round = 0; round * CHUNK < MAX_PER_BATCH; round++) {
    const { data, error } = await admin
      .from('scheduled_appointments')
      .select('id')
      .eq('org_id', input.orgId)
      .eq('status', 'scheduled')
      .lt('scheduled_for', cutoff(now))
      .is('outcome_not_recorded_at', null)
      .limit(CHUNK)
    if (error) throw error
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
    if (ids.length === 0) break

    // Audit first: if the marking fails we discard the intent; if the audit fails nothing was changed.
    const { error: auditError } = await admin.from('appointment_closeouts').insert(ids.map((id) => ({ org_id: input.orgId, batch_id: batchId, appointment_id: id, actor_user_id: input.actorUserId })))
    if (auditError) throw auditError
    const { data: marked, error: markError } = await admin
      .from('scheduled_appointments')
      .update({ outcome_not_recorded_at: now.toISOString(), outcome_not_recorded_by: input.actorUserId, outcome_not_recorded_batch: batchId })
      .eq('org_id', input.orgId)
      .eq('status', 'scheduled')
      .is('outcome_not_recorded_at', null)
      .in('id', ids)
      .select('id')
    if (markError) {
      await admin.from('appointment_closeouts').delete().eq('org_id', input.orgId).eq('batch_id', batchId).in('appointment_id', ids)
      throw markError
    }
    const markedIds = new Set(((marked ?? []) as Array<{ id: string }>).map((r) => r.id))
    // A racing request may have marked some first: their audit rows (ours) are removed so the history only lists what this batch really closed.
    const lost = ids.filter((id) => !markedIds.has(id))
    if (lost.length) await admin.from('appointment_closeouts').delete().eq('org_id', input.orgId).eq('batch_id', batchId).in('appointment_id', lost)
    closed += markedIds.size
    if (markedIds.size === 0) break
  }
  return { batchId, closed }
}

/** Puts a batch back exactly as it was: clears the mark on rows still marked by this batch, stamps the audit rows reverted. */
export async function undoCloseout(admin: SupabaseClient, input: { orgId: string; actorUserId: string; batchId: string }): Promise<{ restored: number }> {
  const { data, error } = await admin
    .from('scheduled_appointments')
    .update({ outcome_not_recorded_at: null, outcome_not_recorded_by: null, outcome_not_recorded_batch: null })
    .eq('org_id', input.orgId)
    .eq('outcome_not_recorded_batch', input.batchId)
    .select('id')
  if (error) throw error
  await admin.from('appointment_closeouts').update({ reverted_at: new Date().toISOString(), reverted_by: input.actorUserId }).eq('org_id', input.orgId).eq('batch_id', input.batchId).is('reverted_at', null)
  return { restored: (data ?? []).length }
}
