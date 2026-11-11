/**
 * "What would this pay change do?" — shown to the owner BEFORE saving a pay plan edit. Re-runs the last 4 pay weeks twice with the
 * same planner as Pay this week (simulatePayWeek): once with the plan as stored, once with the proposed terms, and lists each
 * person's pay both ways. Nothing is written and no approved week changes (the save path is effective-dated: only jobs sold on or
 * after the date change, and a settled-pay check refuses a date that would restate paid work). Covers commission and the weekly
 * minimum, like the dry run it is built on.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { roundMoney } from '@/lib/money'
import { seedCompPlanVersionsForPreview } from '@/lib/payroll-export'
import { simulatePayWeek } from '@/lib/payroll-simulate-week'
import { addWeeks, cutoffYmd, lastCutoffAtOrBefore } from '@/lib/payroll-week-schedule'
import { loadPayWeekSchedule } from '@/lib/payroll-week-schedule-server'
import { createServiceClient } from '@/lib/supabase/service'

export type PlanPreviewPerson = { userId: string; name: string; weeks: Array<{ weekEnding: string; before: number; after: number }>; before: number; after: number; difference: number }
export type PlanPreview = { weeks: string[]; people: PlanPreviewPerson[]; note: string }

export const PREVIEW_WEEKS = 4

/** Pure: pairs the two runs per person and keeps the people whose pay differs in any week, biggest change first. */
export function comparePlanRuns(weeks: string[], before: Array<Map<string, { name: string; total: number }>>, after: Array<Map<string, { name: string; total: number }>>): PlanPreviewPerson[] {
  const ids = new Set<string>()
  for (const m of [...before, ...after]) Array.from(m.keys()).forEach((k) => ids.add(k))
  const out: PlanPreviewPerson[] = []
  for (const userId of Array.from(ids)) {
    const per = weeks.map((weekEnding, i) => ({ weekEnding, before: before[i].get(userId)?.total ?? 0, after: after[i].get(userId)?.total ?? 0 }))
    if (per.every((w) => roundMoney(w.before) === roundMoney(w.after))) continue
    const name = before.map((m) => m.get(userId)?.name).find(Boolean) ?? after.map((m) => m.get(userId)?.name).find(Boolean) ?? 'Unknown'
    const b = roundMoney(per.reduce((s, w) => s + w.before, 0))
    const a = roundMoney(per.reduce((s, w) => s + w.after, 0))
    out.push({ userId, name, weeks: per, before: b, after: a, difference: roundMoney(a - b) })
  }
  return out.sort((x, y) => Math.abs(y.difference) - Math.abs(x.difference) || x.name.localeCompare(y.name))
}

export async function previewPlanChange(admin: SupabaseClient, orgId: string, input: { planId: string; body: Record<string, unknown>; weeklyMinimum: unknown; now?: Date }): Promise<PlanPreview> {
  const now = input.now ?? new Date()
  const s = await loadPayWeekSchedule(admin, orgId)
  let cutoff = lastCutoffAtOrBefore(now, s)
  const weeks: string[] = []
  for (let i = 0; i < PREVIEW_WEEKS; i++) {
    weeks.unshift(cutoffYmd(cutoff, s))
    cutoff = addWeeks(cutoff, -1, s)
  }
  const proposed = createServiceClient()
  await seedCompPlanVersionsForPreview(proposed, orgId, input.planId, input.body)
  const before: Array<Map<string, { name: string; total: number }>> = []
  const after: Array<Map<string, { name: string; total: number }>> = []
  const toMap = (w: { people: Array<{ userId: string; name: string; total: number }> }) => new Map(w.people.map((p) => [p.userId, { name: p.name, total: p.total }]))
  for (const w of weeks) {
    before.push(toMap(await simulatePayWeek(admin, orgId, w, now)))
    after.push(toMap(await simulatePayWeek(proposed, orgId, w, now, { weeklyMinimumOverride: { planId: input.planId, value: input.weeklyMinimum } })))
  }
  return { weeks, people: comparePlanRuns(weeks, before, after), note: 'What these four weeks would have paid with the new terms. Weeks already approved do not change: the new terms apply only to jobs sold from the date you choose.' }
}
