/**
 * Job schedule stages (server). Pure rules: lib/job-schedule.ts. Table: job_stages (the PLAN). A stage tied to a trade is
 * linked to that trade's work_orders row (created with the existing addManualTrade when the job has none): the crew, date
 * and invite stay in the existing install scheduling (JobTradesCard / assign route) — `booked` here only READS the booked date.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { INDUSTRY_PROFILES } from '@/lib/industry-profiles'
import { addManualTrade } from '@/lib/job-trades-db'
import { isYmd, moveStage, pushLate, scheduleFromTemplate, setStageWorkdays, slugifyStageKey, stageEnd, validateStages, type ScheduleStage, type ScheduleTemplate } from '@/lib/job-schedule'
import { loadOrgProfile } from '@/lib/org-profile'
import { loadOrgTrades, tradeLabel } from '@/lib/org-trades'
import { isMissingProjectToolsSchema } from '@/lib/project-tools/budget-db'
import { orgDb } from '@/lib/supabase/org-db'

type Fail = { error: string; status: number }

export type StageView = ScheduleStage & { id: string; end: string; tradeName: string | null; bookedDate: string | null; bookedStatus: string | null }

const STAGE_COLUMNS = 'id, stage_key, name, trade, work_order_id, start_date, workdays, depends_on, sort_order, done_at'

export async function templatesForOrg(admin: SupabaseClient, orgId: string): Promise<ScheduleTemplate[]> {
  const profile = await loadOrgProfile(admin, orgId)
  return [...(INDUSTRY_PROFILES[profile.id].scheduleTemplates ?? [])]
}

export async function loadStages(admin: SupabaseClient, orgId: string, jobId: string): Promise<{ stages: StageView[]; templates: Array<{ id: string; label: string; stageCount: number }>; ready: boolean }> {
  const templates = (await templatesForOrg(admin, orgId)).map((t) => ({ id: t.id, label: t.label, stageCount: t.stages.length }))
  const db = orgDb(admin, orgId)
  const { data, error } = await db.from('job_stages').select(STAGE_COLUMNS).eq('job_id', jobId).order('sort_order', { ascending: true })
  if (error) {
    if (!isMissingProjectToolsSchema(error)) console.error('[stages] load failed', error)
    return { stages: [], templates, ready: false }
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const woIds = Array.from(new Set(rows.map((r) => r.work_order_id).filter((x): x is string => typeof x === 'string')))
  const wo = new Map<string, { scheduled_date: string | null; status: string | null }>()
  if (woIds.length > 0) {
    const { data: wos } = await db.from('work_orders').select('id, scheduled_date, status').in('id', woIds)
    for (const w of (wos ?? []) as Array<{ id: string; scheduled_date: string | null; status: string | null }>) wo.set(w.id, w)
  }
  const orgTrades = await loadOrgTrades(admin, orgId)
  const stages: StageView[] = rows.map((r) => {
    const base: ScheduleStage = { key: String(r.stage_key), name: String(r.name), trade: (r.trade as string | null) ?? null, start: String(r.start_date), workdays: Number(r.workdays) || 1, dependsOn: (r.depends_on as string[]) ?? [], doneAt: (r.done_at as string | null) ?? null }
    const w = typeof r.work_order_id === 'string' ? wo.get(r.work_order_id) : undefined
    return { ...base, id: String(r.id), end: stageEnd(base), tradeName: base.trade ? tradeLabel(base.trade, orgTrades) : null, bookedDate: w?.scheduled_date ?? null, bookedStatus: w?.status ?? null }
  })
  return { stages, templates, ready: true }
}

async function readPlain(admin: SupabaseClient, orgId: string, jobId: string): Promise<Array<ScheduleStage & { id: string }>> {
  const { data } = await orgDb(admin, orgId).from('job_stages').select(STAGE_COLUMNS).eq('job_id', jobId).order('sort_order', { ascending: true })
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ id: String(r.id), key: String(r.stage_key), name: String(r.name), trade: (r.trade as string | null) ?? null, start: String(r.start_date), workdays: Number(r.workdays) || 1, dependsOn: (r.depends_on as string[]) ?? [], doneAt: (r.done_at as string | null) ?? null }))
}

async function writeChanged(admin: SupabaseClient, orgId: string, jobId: string, before: Array<ScheduleStage & { id: string }>, after: ScheduleStage[]): Promise<boolean> {
  const db = orgDb(admin, orgId)
  const byKey = new Map(before.map((s) => [s.key, s]))
  const jobs = after
    .filter((s) => {
      const b = byKey.get(s.key)
      return b && (b.start !== s.start || b.workdays !== s.workdays)
    })
    .map((s) => db.from('job_stages').update({ start_date: s.start, workdays: s.workdays, updated_at: new Date().toISOString() }).eq('job_id', jobId).eq('stage_key', s.key))
  const results = await Promise.all(jobs)
  return results.every((r: { error: unknown }) => !r.error)
}

/** Start a job's schedule from a template. Refuses when stages exist unless `replace` (then the old plan is cleared first). */
export async function applyTemplate(admin: SupabaseClient, ctx: { orgId: string; userId: string; jobId: string }, input: { templateId: unknown; start: unknown; replace?: unknown }): Promise<{ count: number } | Fail> {
  if (!isYmd(input.start)) return { error: 'Pick a start date', status: 400 }
  const templates = await templatesForOrg(admin, ctx.orgId)
  const template = templates.find((t) => t.id === input.templateId)
  if (!template) return { error: 'Pick a template', status: 400 }
  const db = orgDb(admin, ctx.orgId)
  const existing = await readPlain(admin, ctx.orgId, ctx.jobId)
  if (existing.length > 0 && input.replace !== true) return { error: 'This job already has a schedule.', status: 409 }

  const orgTrades = await loadOrgTrades(admin, ctx.orgId)
  const slugFor = (label: string): string | null => {
    const want = label.trim().toLowerCase()
    return orgTrades.find((t) => t.active && t.label.trim().toLowerCase() === want)?.slug ?? null
  }
  const planned = scheduleFromTemplate(template, input.start, slugFor)
  if ('error' in planned) return { error: planned.error, status: 400 }

  // One crew row per trade, shared by every stage of that trade. Reuse what the job already has; add what it does not.
  const { data: wos } = await db.from('work_orders').select('id, trade, status').eq('job_id', ctx.jobId).not('trade', 'is', null).neq('status', 'cancelled').order('created_at', { ascending: true })
  const workOrderByTrade = new Map<string, string>()
  for (const w of (wos ?? []) as Array<{ id: string; trade: string }>) if (!workOrderByTrade.has(w.trade)) workOrderByTrade.set(w.trade, w.id)
  for (const s of planned) {
    if (!s.trade || workOrderByTrade.has(s.trade)) continue
    const added = await addManualTrade(admin, ctx.orgId, ctx.jobId, s.trade, ctx.userId)
    if ('trade' in added) workOrderByTrade.set(s.trade, added.trade.id)
  }

  if (existing.length > 0) {
    const { error } = await db.from('job_stages').delete().eq('job_id', ctx.jobId)
    if (error) return { error: 'Could not replace the old schedule', status: 500 }
  }
  const rows = planned.map((s, i) => ({ job_id: ctx.jobId, stage_key: s.key, name: s.name, trade: s.trade, work_order_id: s.trade ? workOrderByTrade.get(s.trade) ?? null : null, start_date: s.start, workdays: s.workdays, depends_on: s.dependsOn, sort_order: i, template_id: template.id }))
  const { error } = await db.from('job_stages').insert(rows)
  if (error) return isMissingProjectToolsSchema(error) ? { error: 'Project tools need a database update first. Ask your admin to apply it.', status: 409 } : { error: 'Could not build the schedule', status: 500 }
  return { count: rows.length }
}

export type StageAction =
  | { action: 'move'; key: string; start: string }
  | { action: 'duration'; key: string; workdays: number }
  | { action: 'done'; key: string; done: boolean }
  | { action: 'rename'; key: string; name: string }
  | { action: 'add'; name: string; workdays: number; dependsOn?: string[]; start?: string }
  | { action: 'remove'; key: string }
  | { action: 'depends'; key: string; dependsOn: string[] }

export async function editStages(admin: SupabaseClient, ctx: { orgId: string; jobId: string }, input: StageAction): Promise<{ ok: true; clamped?: boolean; changed?: string[] } | Fail> {
  const db = orgDb(admin, ctx.orgId)
  const stages = await readPlain(admin, ctx.orgId, ctx.jobId)
  const has = (k: string) => stages.some((s) => s.key === k)
  switch (input.action) {
    case 'move': {
      if (!has(input.key) || !isYmd(input.start)) return { error: 'Pick a stage and a date', status: 400 }
      const r = moveStage(stages, input.key, input.start)
      if (!(await writeChanged(admin, ctx.orgId, ctx.jobId, stages, r.stages))) return { error: 'Could not move it', status: 500 }
      return { ok: true, clamped: r.clamped, changed: r.changed }
    }
    case 'duration': {
      if (!has(input.key) || !Number.isFinite(input.workdays)) return { error: 'Pick a stage and a length', status: 400 }
      const r = setStageWorkdays(stages, input.key, input.workdays)
      if (!(await writeChanged(admin, ctx.orgId, ctx.jobId, stages, r.stages))) return { error: 'Could not change it', status: 500 }
      return { ok: true, changed: r.changed }
    }
    case 'done': {
      if (!has(input.key)) return { error: 'Stage not found', status: 404 }
      const { error } = await db.from('job_stages').update({ done_at: input.done ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('job_id', ctx.jobId).eq('stage_key', input.key)
      return error ? { error: 'Could not save', status: 500 } : { ok: true }
    }
    case 'rename': {
      const name = String(input.name ?? '').trim().slice(0, 80)
      if (!has(input.key) || !name) return { error: 'Give it a name', status: 400 }
      const { error } = await db.from('job_stages').update({ name, updated_at: new Date().toISOString() }).eq('job_id', ctx.jobId).eq('stage_key', input.key)
      return error ? { error: 'Could not save', status: 500 } : { ok: true }
    }
    case 'depends': {
      if (!has(input.key) || !Array.isArray(input.dependsOn)) return { error: 'Pick a stage', status: 400 }
      const next = stages.map((s) => (s.key === input.key ? { ...s, dependsOn: input.dependsOn.filter((d) => typeof d === 'string') } : s))
      const err = validateStages(next)
      if (err) return { error: err, status: 400 }
      const { error } = await db.from('job_stages').update({ depends_on: next.find((s) => s.key === input.key)?.dependsOn, updated_at: new Date().toISOString() }).eq('job_id', ctx.jobId).eq('stage_key', input.key)
      if (error) return { error: 'Could not save', status: 500 }
      // A new "starts after" can push this stage (and what waits on it) later; never earlier.
      await writeChanged(admin, ctx.orgId, ctx.jobId, stages, pushLate(next))
      return { ok: true }
    }
    case 'add': {
      const name = String(input.name ?? '').trim().slice(0, 80)
      if (!name) return { error: 'Give the stage a name', status: 400 }
      const workdays = Math.min(365, Math.max(1, Math.round(Number(input.workdays) || 1)))
      const key = slugifyStageKey(name, new Set(stages.map((s) => s.key)))
      const dependsOn = (input.dependsOn ?? []).filter(has)
      const start = isYmd(input.start) ? input.start : stages.length ? stages[stages.length - 1].start : null
      if (!start) return { error: 'Pick a start date', status: 400 }
      const row: ScheduleStage = { key, name, trade: null, start, workdays, dependsOn }
      if (validateStages([...stages, row])) return { error: 'That stage cannot start after itself', status: 400 }
      const startAfterDeps = pushLate([...stages, row]).find((s) => s.key === key)?.start ?? start
      const { error } = await db.from('job_stages').insert({ job_id: ctx.jobId, stage_key: key, name, start_date: startAfterDeps, workdays, depends_on: dependsOn, sort_order: stages.length })
      if (error) return { error: 'Could not add it', status: 500 }
      return { ok: true }
    }
    case 'remove': {
      if (!has(input.key)) return { error: 'Stage not found', status: 404 }
      // Whatever waited on it now waits on what IT waited on, so the plan never dangles.
      const removed = stages.find((s) => s.key === input.key) as ScheduleStage
      const writes = stages.filter((s) => s.dependsOn.includes(input.key)).map((s) => {
        const deps = Array.from(new Set(s.dependsOn.filter((d) => d !== input.key).concat(removed.dependsOn)))
        return db.from('job_stages').update({ depends_on: deps, updated_at: new Date().toISOString() }).eq('job_id', ctx.jobId).eq('stage_key', s.key)
      })
      await Promise.all(writes)
      const { error } = await db.from('job_stages').delete().eq('job_id', ctx.jobId).eq('stage_key', input.key)
      return error ? { error: 'Could not remove it', status: 500 } : { ok: true }
    }
  }
}
