import type { SupabaseClient } from '@supabase/supabase-js'

import { weeklyPayrollPayDateForCutoff } from '@/lib/weekly-payroll/cutoff'

const ymdEt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

/**
 * The OPEN weekly period one week after `cutoffAt`, created if it does not exist yet (nothing to set up). An existing
 * period whose cutoff is within 36 hours counts (legacy periods have hand-typed cutoffs). The one place "next week" is made.
 */
export async function ensureNextOpenPeriod(admin: SupabaseClient, orgId: string, cutoffAt: string): Promise<{ id: string }> {
  const nextCutoff = new Date(new Date(cutoffAt).getTime() + 7 * 86_400_000)
  const from = new Date(nextCutoff.getTime() - 36 * 3_600_000).toISOString()
  const to = new Date(nextCutoff.getTime() + 36 * 3_600_000).toISOString()
  const find = async () => {
    const { data, error } = await admin.from('payroll_periods').select('id').eq('org_id', orgId).eq('status', 'open').gte('cutoff_at', from).lte('cutoff_at', to).order('created_at', { ascending: true }).limit(1)
    if (error) throw error
    return (data ?? [])[0] as { id: string } | undefined
  }
  let next = await find()
  if (!next) {
    const { error } = await admin.from('payroll_periods').insert({
      org_id: orgId,
      period_label: `Week ending ${ymdEt(nextCutoff)}`,
      cutoff_at: nextCutoff.toISOString(),
      lock_at: nextCutoff.toISOString(),
      scheduled_pay_date: weeklyPayrollPayDateForCutoff(nextCutoff),
      status: 'open',
    })
    // Two people at once: the loser hits the unique label — just read the winner's row.
    if (error && (error as { code?: string }).code !== '23505') throw error
    next = await find()
  }
  if (!next) throw new Error('Could not create next week')
  return next
}
