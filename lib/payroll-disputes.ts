import type { SupabaseClient } from '@supabase/supabase-js'

import { addAdjustment } from '@/lib/payroll-adjustments'

export type OpenDispute = { id: string; userId: string; name: string; label: string; message: string; periodId: string | null; jobId: string | null; createdAt: string }

/** Open questions from reps, oldest first. Quietly empty before the table exists. */
export async function loadOpenDisputes(admin: SupabaseClient, orgId: string): Promise<OpenDispute[]> {
  const { data, error } = await admin.from('payroll_disputes').select('id, user_id, line_label, message, payroll_period_id, job_id, created_at').eq('org_id', orgId).eq('status', 'open').order('created_at', { ascending: true }).limit(200)
  if (error) {
    if ((error as { code?: string }).code === '42P01' || /does not exist|schema cache/i.test(String(error.message))) return []
    throw error
  }
  const ids = Array.from(new Set((data ?? []).map((d) => d.user_id as string)))
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: users } = await admin.from('users').select('id, full_name').eq('org_id', orgId).in('id', ids)
    for (const u of users ?? []) names.set(u.id as string, (u.full_name as string) || 'Unnamed')
  }
  return (data ?? []).map((d) => ({ id: d.id as string, userId: d.user_id as string, name: names.get(d.user_id as string) ?? 'Unknown', label: d.line_label as string, message: d.message as string, periodId: (d.payroll_period_id as string) ?? null, jobId: (d.job_id as string) ?? null, createdAt: d.created_at as string }))
}

export type ResolveResult = { ok: true } | { ok: false; status: number; error: string }

/**
 * Answer a rep's question: "It's correct" / a reply (status answered), or "Add a fix" (a signed line on the open/next
 * week via the one adjustment path, status fixed). The rep sees the status and reply on My pay.
 */
export async function resolveDispute(
  admin: SupabaseClient,
  input: { orgId: string; actorUserId: string; id: string; action: 'reply' | 'fix'; reply?: string; viewedPeriodId?: string; amount?: number }
): Promise<ResolveResult> {
  const { data: d } = await admin.from('payroll_disputes').select('id, user_id, job_id, status, line_label').eq('id', input.id).eq('org_id', input.orgId).maybeSingle()
  if (!d) return { ok: false, status: 404, error: 'Question not found' }
  if (d.status !== 'open') return { ok: false, status: 409, error: 'Someone already answered this' }
  const reply = (input.reply ?? '').trim().slice(0, 500)

  if (input.action === 'reply') {
    if (!reply) return { ok: false, status: 400, error: 'Write a short reply' }
    const { error } = await admin.from('payroll_disputes').update({ status: 'answered', reply, resolved_by: input.actorUserId, resolved_at: new Date().toISOString() }).eq('id', input.id).eq('status', 'open')
    return error ? { ok: false, status: 500, error: 'Could not save the reply' } : { ok: true }
  }

  if (!input.viewedPeriodId || !Number.isFinite(input.amount) || !input.amount) return { ok: false, status: 400, error: 'Enter the amount to add or take off' }
  // Claim the question FIRST (open → fixed, one winner), then add the fix; if the fix fails, put the question back. Two
  // admins clicking at once can therefore never both add a fix.
  const { data: claimed } = await admin.from('payroll_disputes').update({ status: 'fixed', resolved_by: input.actorUserId, resolved_at: new Date().toISOString() }).eq('id', input.id).eq('org_id', input.orgId).eq('status', 'open').select('id').maybeSingle()
  if (!claimed) return { ok: false, status: 409, error: 'Someone already answered this' }
  const adj = await addAdjustment(admin, {
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    viewedPeriodId: input.viewedPeriodId,
    userId: d.user_id as string,
    amount: input.amount,
    reason: reply || `Fix for: ${d.line_label}`,
    jobId: (d.job_id as string) ?? null,
  })
  if (!adj.ok) {
    await admin.from('payroll_disputes').update({ status: 'open', resolved_by: null, resolved_at: null }).eq('id', input.id).eq('status', 'fixed')
    return adj
  }
  const { error } = await admin
    .from('payroll_disputes')
    .update({ reply: reply || (adj.nextWeek ? "Fixed on next week's check." : "Fixed on this week's check."), adjustment_id: adj.id })
    .eq('id', input.id)
  return error ? { ok: false, status: 500, error: 'The fix was added but the note could not be saved' } : { ok: true }
}
