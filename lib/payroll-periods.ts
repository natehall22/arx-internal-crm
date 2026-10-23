import type { SupabaseClient } from '@supabase/supabase-js'

import { weeklyPayrollPayDateForCutoff } from '@/lib/weekly-payroll/cutoff'

const ymdEt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

/**
 * The OPEN weekly period one week after `cutoffAt`, created if it does not exist yet (nothing to set up). An existing
 * period whose cutoff is within 36 hours counts (legacy periods have hand-typed cutoffs). The one place "next week" is made.
 */
export async function ensureNextOpenPeriod(admin: SupabaseClient, orgId: string, cutoffAt: string): Promise<{ id: string }> {
  // Walk forward week by week from the viewed week: the first week that is OPEN takes the line; a week that exists but
  // is already approved is skipped (a fix for an old week lands on the next week that can still change); a week that
  // does not exist yet is created.
  for (let k = 1; k <= 8; k++) {
    const target = new Date(new Date(cutoffAt).getTime() + k * 7 * 86_400_000)
    const from = new Date(target.getTime() - 36 * 3_600_000).toISOString()
    const to = new Date(target.getTime() + 36 * 3_600_000).toISOString()
    const find = async () => {
      const { data, error } = await admin.from('payroll_periods').select('id, status').eq('org_id', orgId).neq('status', 'cancelled').gte('cutoff_at', from).lte('cutoff_at', to).order('created_at', { ascending: true }).limit(1)
      if (error) throw error
      return (data ?? [])[0] as { id: string; status: string } | undefined
    }
    let row = await find()
    if (!row) {
      const { error } = await admin.from('payroll_periods').insert({
        org_id: orgId,
        period_label: `Week ending ${ymdEt(target)}`,
        cutoff_at: target.toISOString(),
        lock_at: target.toISOString(),
        scheduled_pay_date: weeklyPayrollPayDateForCutoff(target),
        status: 'open',
      })
      // Two people at once: the loser hits the unique label — just read the winner's row.
      if (error && (error as { code?: string }).code !== '23505') throw error
      row = await find()
    }
    if (row && row.status === 'open') return { id: row.id }
  }
  throw new Error('Could not find an open week to put this on')
}
