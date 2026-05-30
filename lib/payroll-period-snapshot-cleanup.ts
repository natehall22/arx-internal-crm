import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Removes immutable payroll artifacts for a period so reopen → re-lock can backfill fresh lines.
 * Order: payout lines (cascades chargeback applications) → job snapshots → period snapshot header.
 */
export async function clearPayrollPeriodLockArtifacts(
  supabase: SupabaseClient,
  orgId: string,
  periodId: string
): Promise<void> {
  const { error: linesErr } = await supabase
    .from('payroll_payout_lines')
    .delete()
    .eq('payroll_period_id', periodId)
    .eq('org_id', orgId)

  if (linesErr) {
    throw new Error('Failed to clear payout lines for period')
  }

  const { error: jobSnapErr } = await supabase
    .from('payroll_job_snapshots')
    .delete()
    .eq('payroll_period_id', periodId)
    .eq('org_id', orgId)

  if (jobSnapErr) {
    throw new Error('Failed to clear job snapshots for period')
  }

  const { error: periodSnapErr } = await supabase
    .from('payroll_period_snapshots')
    .delete()
    .eq('payroll_period_id', periodId)
    .eq('org_id', orgId)

  if (periodSnapErr) {
    throw new Error('Failed to clear period snapshot for period')
  }
}
