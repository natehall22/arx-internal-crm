/**
 * Multi-state warning (no tax math): a person paid this week for a job in a state other than the one they are paid in.
 * Home state = users.payroll_state, else the company's own state (read from its address). Provider owns tax: this only tells the
 * owner to check withholding / registration there. Unknown on either side = no warning (never a guess).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { stateFromAddress } from '@/lib/us-state'

export type StateWarning = { code: 'multi_state'; text: string }

export function buildMultiStateWarnings(args: {
  people: ReadonlyArray<{ userId: string; name: string; jobIds: readonly string[] }>
  jobs: ReadonlyMap<string, { jobNumber: string; address: string | null }>
  home: ReadonlyMap<string, string | null>
  companyState: string | null
}): StateWarning[] {
  const out: StateWarning[] = []
  for (const p of args.people) {
    const home = args.home.get(p.userId) ?? args.companyState
    if (!home) continue
    const away = new Map<string, string[]>()
    for (const id of Array.from(new Set(p.jobIds))) {
      const j = args.jobs.get(id)
      const st = stateFromAddress(j?.address)
      if (j && st && st !== home) away.set(st, [...(away.get(st) ?? []), j.jobNumber])
    }
    if (away.size === 0) continue
    const where = Array.from(away.entries()).map(([st, nums]) => `${nums.join(', ')} in ${st}`).join('; ')
    out.push({ code: 'multi_state', text: `${p.name} is paid in ${home} but is being paid for work outside it (job ${where}). Check with your payroll provider that the other state is set up.` })
  }
  return out
}

/** Each person's payroll state and the company's state. Missing column / table (before the migration) = nothing known. */
export async function loadPayrollStates(admin: SupabaseClient, orgId: string, userIds: string[]): Promise<{ home: Map<string, string | null>; companyState: string | null }> {
  const home = new Map<string, string | null>()
  if (userIds.length) {
    const { data, error } = await admin.from('users').select('id, payroll_state').eq('org_id', orgId).in('id', userIds)
    if (!error) for (const u of data ?? []) home.set(u.id as string, (u.payroll_state as string | null) ?? null)
  }
  const { data: org } = await admin.from('orgs').select('address').eq('id', orgId).maybeSingle()
  return { home, companyState: stateFromAddress(org?.address as string | null) }
}
