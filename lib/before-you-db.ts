/** Database side of "before you" (server only): lib/before-you.ts has the rules. Callers check the company's property-tools switch first. */
import type { SupabaseClient } from '@supabase/supabase-js'

import { beforeYouFor, type BeforeYouLine, type CrewRow } from '@/lib/before-you'
import { jobIsCancelled } from '@/lib/development-board'
import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { loadOrgTrades } from '@/lib/org-trades'
import { isMissingProjectToolsSchema } from '@/lib/project-tools/budget-db'
import { ymdInZone } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'

const CHUNK = 100
const COLUMNS = 'id, job_id, property_id, trade, status, scheduled_date, completed_at'

/**
 * For each crew row given, its "before you" lines. Reads the company's other crew rows on the same properties and the jobs'
 * stage plans; a failed or missing read just means fewer lines. Callers check the company's property-tools switch first.
 */
export async function loadBeforeYou(admin: SupabaseClient, orgId: string, crew: Array<Pick<CrewRow, 'id' | 'job_id' | 'property_id' | 'trade'>>): Promise<Map<string, BeforeYouLine[]>> {
  const out = new Map<string, BeforeYouLine[]>()
  const withProperty = crew.filter((c) => c.property_id && c.trade)
  if (withProperty.length === 0) return out
  const db = orgDb(admin, orgId)
  const propertyIds = Array.from(new Set(withProperty.map((c) => c.property_id as string)))
  const siblings: CrewRow[] = []
  for (let i = 0; i < propertyIds.length; i += CHUNK) {
    const { data, error } = await db.from('work_orders').select(COLUMNS).in('property_id', propertyIds.slice(i, i + CHUNK)).eq('work_order_type', 'install').not('trade', 'is', null).neq('status', 'cancelled')
    if (error) {
      console.error('[before-you] siblings failed', error)
      return out
    }
    siblings.push(...((data ?? []) as CrewRow[]))
  }

  // Only crews on this property's CURRENT jobs count: a cancelled job's crews, and an older job already closed out, are not "ahead of" this one
  // (the job a crew itself is on always counts). Same "live job" rule as the Development board.
  const siblingJobIds = Array.from(new Set(siblings.map((x) => x.job_id).filter((j): j is string => !!j)))
  const jobState = new Map<string, { status: string | null; cancelled_at: string | null }>()
  for (let i = 0; i < siblingJobIds.length; i += CHUNK) {
    const { data, error } = await db.from('production_jobs').select('id, status, cancelled_at').in('id', siblingJobIds.slice(i, i + CHUNK))
    if (error) {
      console.error('[before-you] jobs failed', error)
      return out
    }
    for (const j of (data ?? []) as Array<{ id: string; status: string | null; cancelled_at: string | null }>) jobState.set(j.id, j)
  }
  const myJobs = new Set(withProperty.map((c) => c.job_id).filter((j): j is string => !!j))
  const current = siblings.filter((x) => {
    const j = x.job_id ? jobState.get(x.job_id) : null
    if (!j || jobIsCancelled(j)) return false
    return (x.job_id !== null && myJobs.has(x.job_id)) || (j.status !== 'complete' && j.status !== 'collected')
  })

  // Schedule stages tied to a crew: this crew's stage depends_on keys → the crew rows of those stages.
  const predecessors = new Map<string, Set<string>>()
  const jobIds = Array.from(new Set(withProperty.map((c) => c.job_id).filter((j): j is string => !!j)))
  const stages: Array<{ job_id: string; stage_key: string; work_order_id: string | null; depends_on: string[] | null }> = []
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const { data, error } = await db.from('job_stages').select('job_id, stage_key, work_order_id, depends_on').in('job_id', jobIds.slice(i, i + CHUNK))
    if (error) {
      if (!isMissingProjectToolsSchema(error)) console.error('[before-you] stages failed', error)
      break
    }
    stages.push(...((data ?? []) as typeof stages))
  }
  for (const st of stages) {
    if (!st.work_order_id || !st.depends_on?.length) continue
    const set = predecessors.get(st.work_order_id) ?? new Set<string>()
    for (const key of st.depends_on) {
      const pred = stages.find((x) => x.job_id === st.job_id && x.stage_key === key)
      if (pred?.work_order_id) set.add(pred.work_order_id)
    }
    predecessors.set(st.work_order_id, set)
  }

  const [orgTrades, tz] = await Promise.all([loadOrgTrades(admin, orgId), loadOrgTimeZone(admin, orgId)])
  const doneDay = (at: string) => ymdInZone(new Date(at), tz)
  for (const c of withProperty) {
    const lines = beforeYouFor(c, current, predecessors.get(c.id) ?? new Set(), orgTrades, doneDay)
    if (lines.length > 0) out.set(c.id, lines)
  }
  return out
}
