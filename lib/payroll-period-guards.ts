import type { SupabaseClient } from '@supabase/supabase-js'

export type PayrollPeriodRow = {
  id: string
  status: string
  locked_at?: string | null
  cutoff_at?: string
  period_label?: string
  scheduled_pay_date?: string
}

export function isPayrollPeriodEditable(period: {
  status: string
  locked_at?: string | null
}): boolean {
  return period.status === 'open' && !period.locked_at
}

export async function loadPayrollPeriodForOrg(
  supabase: SupabaseClient,
  orgId: string,
  periodId: string
): Promise<PayrollPeriodRow | null> {
  const { data, error } = await supabase
    .from('payroll_periods')
    .select('id, status, locked_at, cutoff_at, period_label, scheduled_pay_date')
    .eq('id', periodId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error || !data) return null
  return data as PayrollPeriodRow
}
