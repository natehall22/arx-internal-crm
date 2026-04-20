/**
 * Merge payroll_sent_at onto job rows without including the column in the main ops board select.
 * If migration 124 is not applied yet, the enrichment query fails — we log and leave jobs unchanged
 * so the board still loads.
 */
export async function enrichOpsJobsWithPayrollSentAt(
  client: any,
  orgId: string,
  jobs: Array<{ id: string } & Record<string, unknown>>
): Promise<void> {
  if (jobs.length === 0) return
  const ids = jobs.map((j) => j.id)
  const { data, error } = await client
    .from('production_jobs')
    .select('id, payroll_sent_at')
    .eq('org_id', orgId)
    .in('id', ids)

  if (error) {
    console.warn('[ops] payroll_sent_at enrichment skipped:', error.message)
    return
  }
  const rows = (data || []) as Array<{ id: string; payroll_sent_at: string | null }>
  const map = new Map(rows.map((r) => [r.id, r.payroll_sent_at ?? null]))
  for (const j of jobs) {
    j.payroll_sent_at = map.has(j.id) ? map.get(j.id)! : null
  }
}
