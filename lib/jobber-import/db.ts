/**
 * Move from Jobber — database side (server only, service-role client, everything through orgDb). The three steps:
 *   upload  — addFile: a CSV is parsed and stored on the run (import_run_files); nothing else is written.
 *   check   — checkRun: the plan (lib/jobber-import/plan.ts) against what is in the CRM now → import_run_items + summary.
 *   import  — importBatch: up to BATCH items at a time, in dependency order (SQL import_run_claim), each one idempotent:
 *             a row keeps Jobber's id in import_source_id, so running again updates instead of duplicating, and a batch
 *             cut off half way just runs again. Progress = counts of items by status.
 *   undo    — undoBatch: newest first; a row this run made is removed only if it still holds what the run wrote and
 *             nothing else points at it (SQL import_undo_row); a row it filled in is put back only if unchanged
 *             (import_revert_row). Everything else is kept and listed.
 * Who: owners only (isSuperAdmin), checked by the route.
 */
import { createHash } from 'crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { parseCsv } from '@/lib/csv'
import { CUSTOM_FIELD_DEFINITION_COLUMNS, definitionFromRow } from '@/lib/custom-fields'
import { saveDefinitionChange } from '@/lib/custom-fields-db'
import { insertImportedInvoice, replaceImportedInvoiceLines, IMPORTED_INVOICE_COLUMNS, type ImportedInvoiceLine } from '@/lib/invoices'
import { loadOrgTrades } from '@/lib/org-trades'
import { insertImportedProperty } from '@/lib/properties-db'
import { cleanImportedPlanPatch, createImportedServicePlan } from '@/lib/service-plans-db'
import { ymdInZone } from '@/lib/service-plans'
import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { fetchSupabaseAllPages } from '@/lib/supabase-fetch-all-pages'
import { orgDb } from '@/lib/supabase/org-db'

import { detectFileKind, isColumnTarget, JOBBER_FILE_KINDS, type JobberFileKind } from './columns'
import { addressesOf, buildPlan, readJobberFiles, ITEM_RANK, type CustomerRef, type ExistingSnapshot, type ImportOptions, type PlanSummary, type PropertyRef, type RunFile } from './plan'

export const IMPORT_NOT_READY = 'Move from Jobber turns on once the database update for it is applied (migration 202611120040).'
export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_FILE_ROWS = 20_000
export const MAX_FILES = 30
const BATCH = 40

export type RunStatus = 'draft' | 'importing' | 'done' | 'undoing' | 'undone' | 'discarded'
export type RunOptions = { dateOrder: 'mdy' | 'dmy' | null; trade: string | null; skipArchived: boolean }
export type RunRow = {
  id: string
  status: RunStatus
  mapping: Record<string, Record<string, string>>
  options: RunOptions
  summary: PlanSummary | null
  checked_at: string | null
  started_at: string | null
  finished_at: string | null
  undone_at: string | null
  created_by: string
  created_at: string
}
export type RunFileInfo = { id: string; name: string; kind: JobberFileKind; headers: string[]; row_count: number }
export type Progress = { total: number; pending: number; done: number; failed: number; skipped: number; undone: number; kept: number }

type Fail = { ok: false; status: number; error: string }
const fail = (status: number, error: string): Fail => ({ ok: false, status, error })

export function isImportNotReadyError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return ['42P01', 'PGRST205', '42703', 'PGRST204', '42883', 'PGRST202'].includes(String(error.code)) || /import_run|import_source|paid_outside/.test(String(error.message ?? ''))
}

const RUN_COLS = 'id, status, mapping, options, summary, checked_at, started_at, finished_at, undone_at, created_by, created_at'

function runFromRow(r: Record<string, unknown>): RunRow {
  const o = (r.options ?? {}) as Record<string, unknown>
  return {
    ...(r as unknown as RunRow),
    mapping: (r.mapping ?? {}) as RunRow['mapping'],
    options: {
      dateOrder: o.dateOrder === 'mdy' || o.dateOrder === 'dmy' ? o.dateOrder : null,
      trade: typeof o.trade === 'string' && o.trade ? o.trade : null,
      skipArchived: o.skipArchived === true,
    },
    summary: (r.summary ?? null) as PlanSummary | null,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Runs and files
// ---------------------------------------------------------------------------------------------------------------------

export async function listRuns(admin: SupabaseClient, orgId: string): Promise<{ ready: boolean; runs: RunRow[] }> {
  const { data, error } = await orgDb(admin, orgId).from('import_runs').select(RUN_COLS).neq('status', 'discarded').order('created_at', { ascending: false }).limit(20)
  if (error) {
    if (!isImportNotReadyError(error)) console.error('[jobber-import] list runs', error)
    return { ready: false, runs: [] }
  }
  return { ready: true, runs: ((data ?? []) as Record<string, unknown>[]).map(runFromRow) }
}

export async function loadRun(admin: SupabaseClient, orgId: string, runId: string): Promise<RunRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null
  const { data } = await orgDb(admin, orgId).from('import_runs').select(RUN_COLS).eq('id', runId).maybeSingle()
  return data ? runFromRow(data as Record<string, unknown>) : null
}

export async function loadRunFiles(admin: SupabaseClient, orgId: string, runId: string, withRows = false): Promise<Array<RunFileInfo & { rows?: string[][] }>> {
  const cols = withRows ? 'id, name, kind, headers, row_count, rows' : 'id, name, kind, headers, row_count'
  const { data, error } = await orgDb(admin, orgId).from('import_run_files').select(cols).eq('run_id', runId).order('created_at')
  if (error) throw new Error(`jobber import: files: ${error.message}`)
  return (data ?? []) as Array<RunFileInfo & { rows?: string[][] }>
}

/** The open run (draft / importing / undoing) or a new draft. One open run per company (unique index). */
export async function openRun(admin: SupabaseClient, orgId: string, userId: string): Promise<{ ok: true; run: RunRow } | Fail> {
  const db = orgDb(admin, orgId)
  const { data: open, error } = await db.from('import_runs').select(RUN_COLS).in('status', ['draft', 'importing', 'undoing']).maybeSingle()
  if (error) return isImportNotReadyError(error) ? fail(503, IMPORT_NOT_READY) : fail(500, 'Could not start the import')
  if (open) return { ok: true, run: runFromRow(open as Record<string, unknown>) }
  const { data, error: insErr } = await db.from('import_runs').insert({ source: 'jobber', status: 'draft', created_by: userId }).select(RUN_COLS).single()
  if (insErr?.code === '23505') return openRun(admin, orgId, userId)
  if (insErr || !data) return fail(500, 'Could not start the import')
  return { ok: true, run: runFromRow(data as Record<string, unknown>) }
}

/** Anything that changes what Check would say clears the last check (Import then asks for a new one). */
async function clearCheck(admin: SupabaseClient, orgId: string, runId: string) {
  const db = orgDb(admin, orgId)
  await db.from('import_run_items').delete().eq('run_id', runId)
  await db.from('import_runs').update({ summary: null, checked_at: null, updated_at: new Date().toISOString() }).eq('id', runId).eq('status', 'draft')
}

export async function addFile(admin: SupabaseClient, orgId: string, run: RunRow, name: string, text: string): Promise<{ ok: true; file: RunFileInfo; detected: boolean } | Fail> {
  if (run.status !== 'draft') return fail(409, 'This import has already started')
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) return fail(413, 'That file is over 8 MB — export fewer columns, or split it')
  const rows = parseCsv(text)
  if (rows.length < 2) return fail(400, `${name} has no rows`)
  const headers = rows[0].map((h) => h.trim())
  const body = rows.slice(1)
  if (body.length > MAX_FILE_ROWS) return fail(413, `${name} has more than ${MAX_FILE_ROWS.toLocaleString()} rows — split it`)
  const kind = detectFileKind(headers)
  const files = await loadRunFiles(admin, orgId, run.id)
  if (files.length >= MAX_FILES) return fail(400, `Up to ${MAX_FILES} files per import`)
  const sha256 = createHash('sha256').update(text).digest('hex')
  const { data, error } = await orgDb(admin, orgId)
    .from('import_run_files')
    .insert({ run_id: run.id, name: name.slice(0, 255) || 'file.csv', kind: kind ?? 'unknown', headers, rows: body, row_count: body.length, sha256 })
    .select('id, name, kind, headers, row_count')
    .single()
  if (error?.code === '23505') return fail(409, `${name} is already added`)
  if (error || !data) return fail(500, 'Could not save the file')
  await clearCheck(admin, orgId, run.id)
  return { ok: true, file: data as RunFileInfo, detected: !!kind }
}

export async function removeFile(admin: SupabaseClient, orgId: string, run: RunRow, fileId: string): Promise<{ ok: true } | Fail> {
  if (run.status !== 'draft') return fail(409, 'This import has already started')
  await orgDb(admin, orgId).from('import_run_files').delete().eq('id', fileId).eq('run_id', run.id)
  await clearCheck(admin, orgId, run.id)
  return { ok: true }
}

/** The owner's corrections: a file's kind, a column's target, the options. */
export async function updateDraft(
  admin: SupabaseClient,
  orgId: string,
  run: RunRow,
  body: { fileId?: unknown; kind?: unknown; columns?: unknown; options?: unknown }
): Promise<{ ok: true } | Fail> {
  if (run.status !== 'draft') return fail(409, 'This import has already started')
  const db = orgDb(admin, orgId)
  if (typeof body.fileId === 'string') {
    const files = await loadRunFiles(admin, orgId, run.id)
    const file = files.find((f) => f.id === body.fileId)
    if (!file) return fail(404, 'File not found')
    if (body.kind !== undefined) {
      if (!(JOBBER_FILE_KINDS as readonly unknown[]).includes(body.kind)) return fail(400, 'Pick what this file is')
      await db.from('import_run_files').update({ kind: body.kind }).eq('id', file.id).eq('run_id', run.id)
    }
    if (body.columns !== undefined) {
      const kind = (body.kind as JobberFileKind | undefined) ?? (file.kind as JobberFileKind)
      if (!(JOBBER_FILE_KINDS as readonly string[]).includes(kind)) return fail(400, 'Pick what this file is first')
      const cols = body.columns && typeof body.columns === 'object' ? (body.columns as Record<string, unknown>) : {}
      const clean: Record<string, string> = {}
      for (const [h, t] of Object.entries(cols)) if (file.headers.includes(h) && isColumnTarget(kind, t)) clean[h] = t
      await db.from('import_runs').update({ mapping: { ...run.mapping, [file.id]: clean } }).eq('id', run.id)
    }
  }
  if (body.options && typeof body.options === 'object') {
    const o = body.options as Record<string, unknown>
    const next: RunOptions = { ...run.options }
    if ('dateOrder' in o) next.dateOrder = o.dateOrder === 'mdy' || o.dateOrder === 'dmy' ? o.dateOrder : null
    if ('trade' in o) {
      if (o.trade !== null && typeof o.trade !== 'string') return fail(400, 'Pick a service type')
      if (typeof o.trade === 'string' && !(await loadOrgTrades(admin, orgId)).some((t) => t.slug === o.trade && t.active)) return fail(400, 'Pick one of your service types')
      next.trade = (o.trade as string | null) || null
    }
    if ('skipArchived' in o) next.skipArchived = o.skipArchived === true
    await db.from('import_runs').update({ options: next }).eq('id', run.id)
  }
  await clearCheck(admin, orgId, run.id)
  return { ok: true }
}

export async function discardRun(admin: SupabaseClient, orgId: string, run: RunRow): Promise<{ ok: true } | Fail> {
  if (run.status !== 'draft') return fail(409, 'Only an import that hasn’t started can be thrown away')
  const db = orgDb(admin, orgId)
  await db.from('import_run_items').delete().eq('run_id', run.id)
  await db.from('import_run_files').delete().eq('run_id', run.id)
  await db.from('import_runs').update({ status: 'discarded', mapping: {}, summary: null }).eq('id', run.id).eq('status', 'draft')
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------------------------------------------------

async function loadSnapshot(admin: SupabaseClient, orgId: string): Promise<ExistingSnapshot> {
  const db = orgDb(admin, orgId)
  const all = <T>(table: string, cols: string, extra?: (q: any) => any) =>
    fetchSupabaseAllPages<T>((from, to) => {
      let q = db.from(table).select(cols)
      if (extra) q = extra(q)
      return q.order('id').range(from, to)
    })
  const [customers, properties, defs, priceItems, plans, invoices, trades] = await Promise.all([
    all<ExistingSnapshot['customers'][number]>('customers', 'id, name, email_lower, phone_normalized, address_text, created_at, import_source_id'),
    all<ExistingSnapshot['properties'][number]>('properties', 'id, customer_id, address_key, import_source_id'),
    all<Record<string, unknown>>('custom_field_definitions', `${CUSTOM_FIELD_DEFINITION_COLUMNS}, import_source_id`),
    all<ExistingSnapshot['priceItems'][number]>('pricebook_items', 'id, name, import_source_id'),
    all<ExistingSnapshot['plans'][number]>('service_plans', 'id, import_source_id', (q) => q.not('import_source_id', 'is', null)),
    all<ExistingSnapshot['invoices'][number]>('job_invoices', 'id, invoice_number, import_source_id'),
    loadOrgTrades(admin, orgId),
  ])
  return {
    customers,
    properties,
    fieldDefs: defs.map((d) => ({ ...definitionFromRow(d)!, import_source_id: (d.import_source_id as string | null) ?? null })).filter((d) => d.id),
    priceItems,
    plans,
    invoices,
    trades: trades.filter((t) => t.active).map((t) => ({ slug: t.slug, label: t.label })),
  }
}

export async function checkRun(admin: SupabaseClient, orgId: string, run: RunRow): Promise<{ ok: true; summary: PlanSummary } | Fail> {
  if (run.status !== 'draft') return fail(409, 'This import has already started')
  const files = await loadRunFiles(admin, orgId, run.id, true)
  const usable = files.filter((f) => (JOBBER_FILE_KINDS as readonly string[]).includes(f.kind))
  if (usable.length === 0) return fail(400, 'Add at least one Jobber export first')
  let snapshot: ExistingSnapshot
  try {
    snapshot = await loadSnapshot(admin, orgId)
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (isImportNotReadyError(err)) return fail(503, IMPORT_NOT_READY)
    throw e
  }
  const today = ymdInZone(new Date(), await loadOrgTimeZone(admin, orgId))
  const options: ImportOptions = { ...run.options, today }
  const read = readJobberFiles(usable as RunFile[], run.mapping, options)
  const addresses = addressesOf(read)
  const keys = new Map<string, string>()
  for (let i = 0; i < addresses.length; i += 1000) {
    const chunk = addresses.slice(i, i + 1000)
    const { data, error } = await admin.rpc('property_address_keys', { p: chunk })
    if (error) return isImportNotReadyError(error) ? fail(503, IMPORT_NOT_READY) : fail(500, 'Could not check the addresses')
    ;(data as string[]).forEach((k, j) => keys.set(chunk[j], k))
  }
  const { items, summary } = buildPlan(read, snapshot, keys, options)
  const db = orgDb(admin, orgId)
  const del = await db.from('import_run_items').delete().eq('run_id', run.id)
  if (del.error) return fail(500, 'Could not save the check')
  for (let i = 0; i < items.length; i += 500) {
    const { error } = await db.from('import_run_items').insert(
      items.slice(i, i + 500).map((it) => ({
        run_id: run.id,
        kind: it.kind,
        rank: it.rank,
        seq: it.seq,
        source_id: it.source_id.slice(0, 200),
        label: it.label.slice(0, 300),
        action: it.action,
        status: it.action === 'skip' ? 'skipped' : 'pending',
        payload: it.payload,
        problems: it.problems,
        target_id: it.target_id,
      }))
    )
    if (error) {
      console.error('[jobber-import] save items', error)
      return fail(500, 'Could not save the check')
    }
  }
  await db.from('import_runs').update({ summary, checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', run.id).eq('status', 'draft')
  return { ok: true, summary }
}

// ---------------------------------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------------------------------

export async function runProgress(admin: SupabaseClient, orgId: string, runId: string): Promise<Progress> {
  const rows = await fetchSupabaseAllPages<{ status: string }>((from, to) => orgDb(admin, orgId).from('import_run_items').select('status').eq('run_id', runId).order('id').range(from, to))
  const p: Progress = { total: rows.length, pending: 0, done: 0, failed: 0, skipped: 0, undone: 0, kept: 0 }
  for (const r of rows) {
    if (r.status === 'pending' || r.status === 'working') p.pending += 1
    else if (r.status in p) (p as Record<string, number>)[r.status] += 1
  }
  return p
}

export async function startImport(admin: SupabaseClient, orgId: string, run: RunRow): Promise<{ ok: true } | Fail> {
  if (run.status === 'importing') return { ok: true }
  if (run.status !== 'draft') return fail(409, 'This import has already run')
  if (!run.checked_at || !run.summary) return fail(409, 'Check the files first')
  if (run.summary.nothingToImport) return fail(400, 'Nothing to bring over')
  const { data } = await orgDb(admin, orgId)
    .from('import_runs')
    .update({ status: 'importing', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', run.id)
    .eq('status', 'draft')
    .select('id')
  return (data ?? []).length ? { ok: true } : fail(409, 'This import changed — reload')
}

type Item = {
  id: string
  kind: string
  source_id: string
  action: 'create' | 'update' | 'link' | 'skip'
  payload: Record<string, any>
  target_id: string | null
}

type Ctx = {
  admin: SupabaseClient
  orgId: string
  userId: string
  runId: string
  /** customer / property / custom field item source id → row id (done items of this run) */
  refs: Map<string, string>
}

const RESOLVE_KINDS = ['custom_field', 'customer', 'property']

async function loadRefs(ctx: Ctx): Promise<void> {
  const rows = await fetchSupabaseAllPages<{ kind: string; source_id: string; target_id: string | null }>((from, to) =>
    orgDb(ctx.admin, ctx.orgId).from('import_run_items').select('kind, source_id, target_id').eq('run_id', ctx.runId).in('kind', RESOLVE_KINDS).in('status', ['done']).order('id').range(from, to)
  )
  ctx.refs.clear()
  for (const r of rows) if (r.target_id) ctx.refs.set(`${r.kind}:${r.source_id}`, r.target_id)
}

function customerIdOf(ctx: Ctx, ref: CustomerRef | undefined): string | null {
  if (!ref) return null
  return 'customer_id' in ref ? ref.customer_id : ctx.refs.get(`customer:${ref.source_id}`) ?? null
}
function propertyIdOf(ctx: Ctx, ref: PropertyRef | null | undefined): string | null {
  if (!ref) return null
  return 'property_id' in ref ? ref.property_id : ctx.refs.get(`property:${ref.source_id}`) ?? null
}
/** { "customer:gate code": v } → { <definition id>: v } */
function fieldIds(ctx: Ctx, values: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values ?? {})) {
    const id = ctx.refs.get(`custom_field:${k}`)
    if (id) out[id] = v
  }
  return out
}

/** Two stored values the same? (numbers as numbers, objects by their JSON with sorted keys). */
function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (v === undefined) return null
    if (typeof v === 'string' && v !== '' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v)
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]))
    return v
  }
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}
const pick = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]))

/** The values a previous import last wrote on this row (its newest done item), or null. */
async function lastApplied(ctx: Ctx, kind: string, sourceId: string, targetId: string): Promise<Record<string, unknown> | null> {
  const { data } = await orgDb(ctx.admin, ctx.orgId)
    .from('import_run_items')
    .select('applied')
    .eq('kind', kind)
    .eq('source_id', sourceId)
    .eq('target_id', targetId)
    .eq('status', 'done')
    .neq('run_id', ctx.runId)
    .order('done_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return ((data as { applied?: Record<string, unknown> } | null)?.applied as Record<string, unknown>) ?? null
}

type Outcome = { status: 'done' | 'failed' | 'skipped'; target_table?: string; target_id?: string | null; applied?: Record<string, unknown> | null; before?: Record<string, unknown> | null; error?: string }

/**
 * A re-run's update of a row an earlier import made: only if the row still holds what that import wrote (nobody changed it
 * here since). Otherwise it is kept as it is and the item says so.
 */
async function guardedUpdate(ctx: Ctx, table: string, item: Item, values: Record<string, unknown>, cols: string): Promise<Outcome> {
  const db = orgDb(ctx.admin, ctx.orgId)
  const { data: row } = await db.from(table).select(cols).eq('id', item.target_id).maybeSingle()
  if (!row) return { status: 'failed', error: 'The row this import made earlier is gone' }
  const prev = await lastApplied(ctx, item.kind, item.source_id, String(item.target_id))
  const current = row as Record<string, unknown>
  if (prev && Object.keys(prev).some((k) => !same(current[k], prev[k])))
    return { status: 'skipped', target_table: table, target_id: item.target_id, error: 'Changed here since the last import — kept as it is' }
  const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => !same(current[k], v)))
  if (Object.keys(changed).length === 0) return { status: 'done', target_table: table, target_id: item.target_id, applied: pick(current, Object.keys(values)), before: null }
  const { data: after, error } = await db.from(table).update(changed).eq('id', item.target_id).select(cols).single()
  if (error || !after) return { status: 'failed', error: error?.message ?? 'Could not update' }
  return { status: 'done', target_table: table, target_id: item.target_id, applied: pick(after as Record<string, unknown>, Object.keys(changed)), before: pick(current, Object.keys(changed)) }
}

const CUSTOMER_COLS = 'id, name, email, phone, address_text, custom_fields, import_source, import_source_id'
const PROPERTY_COLS = 'id, label, address_line1, address_line2, city, state, zip, address_text, custom_fields, import_source, import_source_id'
const PRICE_COLS = 'id, name, unit_price, cost_price, is_taxable, active, adder_category, import_source, import_source_id'
const PLAN_COLS = 'id, status, name, description, price, billing_basis, taxable, seasons, preferred_weekday, start_date, end_date, trade, property_id, import_source, import_source_id'

const defaultPricebook = new Map<string, string>()

async function pricebookId(ctx: Ctx): Promise<string | null> {
  const hit = defaultPricebook.get(ctx.orgId)
  if (hit) return hit
  const db = orgDb(ctx.admin, ctx.orgId)
  const { data } = await db.from('pricebooks').select('id, is_default').order('is_default', { ascending: false }).limit(1)
  let id = ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null
  if (!id) {
    // A new company may have no price book yet: make its default one (kept by undo — it is the company's, not the import's).
    const { data: made } = await db.from('pricebooks').insert({ name: 'Price book', is_default: true }).select('id').single()
    id = (made as { id: string } | null)?.id ?? null
  }
  if (id) defaultPricebook.set(ctx.orgId, id)
  return id
}

async function doItem(ctx: Ctx, item: Item): Promise<Outcome> {
  const db = orgDb(ctx.admin, ctx.orgId)
  const p = item.payload
  const source = { import_source: 'jobber' as const, import_source_id: item.source_id.slice(0, 200) }
  switch (item.kind) {
    case 'custom_field': {
      if (item.action === 'link') return { status: 'done', target_table: undefined, target_id: item.target_id }
      const r = await saveDefinitionChange(ctx.admin, ctx.orgId, ctx.userId, { action: 'add', entity: p.entity, label: p.label, field_type: 'text' })
      const def = r.ok ? r.value.find((d) => d.entity === p.entity && d.label.toLowerCase() === String(p.label).toLowerCase()) : null
      if (!r.ok && r.status !== 409) return { status: 'failed', error: r.error }
      // 409 = a field with that name appeared since Check (made by hand, or by a cut-off batch of this run): use it.
      let id = def?.id ?? null
      if (!id) {
        const { data: same } = await db.from('custom_field_definitions').select('id, label').eq('entity', p.entity)
        id = ((same ?? []) as Array<{ id: string; label: string }>).find((d) => d.label.trim().toLowerCase() === String(p.label).trim().toLowerCase())?.id ?? null
      }
      if (!id) return { status: 'failed', error: 'Could not add the field' }
      if (!r.ok) return { status: 'done', target_id: id }
      const { data } = await db.from('custom_field_definitions').update(source).eq('id', id).is('import_source_id', null).select('id, label, import_source, import_source_id').maybeSingle()
      return { status: 'done', target_table: data ? 'custom_field_definitions' : undefined, target_id: id, applied: data ? pick(data as Record<string, unknown>, ['label', 'import_source', 'import_source_id']) : null }
    }
    case 'price_item': {
      const values = {
        name: p.name,
        unit_price: Number(p.unit_price_cents) / 100,
        cost_price: p.cost_cents === null || p.cost_cents === undefined ? null : Number(p.cost_cents) / 100,
        is_taxable: p.taxable === true,
        active: p.active !== false,
        adder_category: (p.category as string | null) || 'Other',
      }
      if (item.action === 'update') return guardedUpdate(ctx, 'pricebook_items', item, values, PRICE_COLS)
      const pb = await pricebookId(ctx)
      if (!pb) return { status: 'failed', error: 'No price book to add to' }
      const { data, error } = await db
        .from('pricebook_items')
        .insert({ ...values, ...source, pricebook_id: pb, category: 'addons', item_type: 'addon', unit: 'each', is_adder: true, price_type: 'fixed', is_commissionable: false, show_to_customer: true, visibility: 'sales_reps' })
        .select(PRICE_COLS)
        .single()
      if (error?.code === '23505') return adoptBySource(ctx, 'pricebook_items', item)
      if (error || !data) return { status: 'failed', error: error?.message ?? 'Could not add the item' }
      return { status: 'done', target_table: 'pricebook_items', target_id: (data as { id: string }).id, applied: pick(data as Record<string, unknown>, [...Object.keys(values), 'import_source', 'import_source_id']) }
    }
    case 'customer': {
      const custom = fieldIds(ctx, p.custom_fields)
      if (item.action === 'link') return linkCustomer(ctx, item, custom)
      if (item.action === 'update') {
        const { data: cur } = await db.from('customers').select('custom_fields').eq('id', item.target_id).maybeSingle()
        const merged = { ...(((cur as { custom_fields?: Record<string, unknown> } | null)?.custom_fields as Record<string, unknown>) ?? {}), ...custom }
        return guardedUpdate(ctx, 'customers', item, { name: p.name, email: p.email ?? null, phone: p.phone ?? null, address_text: p.address_text ?? null, custom_fields: merged }, CUSTOMER_COLS)
      }
      const { data, error } = await db
        .from('customers')
        .insert({ name: p.name, email: p.email ?? null, phone: p.phone ?? null, address_text: p.address_text ?? null, custom_fields: custom, ...source })
        .select(CUSTOMER_COLS)
        .single()
      if (error?.code === '23505') return adoptBySource(ctx, 'customers', item)
      if (error || !data) return { status: 'failed', error: error?.message ?? 'Could not add the customer' }
      return { status: 'done', target_table: 'customers', target_id: (data as { id: string }).id, applied: pick(data as Record<string, unknown>, ['name', 'email', 'phone', 'address_text', 'custom_fields', 'import_source', 'import_source_id']) }
    }
    case 'property': {
      const customerId = customerIdOf(ctx, p.customer)
      if (!customerId) return { status: 'failed', error: 'Its customer wasn’t brought over' }
      const input = { label: p.label ?? null, address_line1: p.address_line1, address_line2: p.address_line2 ?? null, city: p.city ?? null, state: p.state ?? null, zip: p.zip ?? null }
      const custom = fieldIds(ctx, p.custom_fields)
      if (item.action === 'update') {
        const { data: cur } = await db.from('properties').select('custom_fields').eq('id', item.target_id).maybeSingle()
        const merged = { ...(((cur as { custom_fields?: Record<string, unknown> } | null)?.custom_fields as Record<string, unknown>) ?? {}), ...custom }
        return guardedUpdate(ctx, 'properties', item, { label: input.label, custom_fields: merged }, PROPERTY_COLS)
      }
      const r = await insertImportedProperty(ctx.admin, ctx.orgId, ctx.userId, customerId, input, { custom_fields: custom, ...source })
      if (!r.ok) return { status: 'failed', error: r.error }
      // Already on file at that address: used as it is (nothing written, nothing to undo).
      if ('existingId' in r) return { status: 'done', target_id: r.existingId }
      return { status: 'done', target_table: 'properties', target_id: String(r.property.id), applied: pick(r.property, ['label', 'address_text', 'custom_fields', 'import_source', 'import_source_id']) }
    }
    case 'plan': {
      const customerId = customerIdOf(ctx, p.customer)
      const propertyId = propertyIdOf(ctx, p.property)
      if (!customerId || !propertyId) return { status: 'failed', error: 'Its customer or property wasn’t brought over' }
      const body = {
        property_id: propertyId,
        trade: p.trade,
        name: p.name,
        description: p.description,
        price: p.price,
        billing_basis: p.billing_basis,
        taxable: p.taxable === true,
        seasons: p.seasons,
        preferred_weekday: p.preferred_weekday,
        start_date: p.start_date,
        end_date: p.end_date,
      }
      if (item.action === 'update') {
        const patch = await cleanImportedPlanPatch(ctx.admin, ctx.orgId, customerId, body)
        if (!patch.ok) return { status: 'failed', error: patch.error }
        // A plan someone has reviewed and turned on (or ended) is theirs now: guardedUpdate keeps it (status is compared).
        return guardedUpdate(ctx, 'service_plans', item, patch.patch, PLAN_COLS)
      }
      const r = await createImportedServicePlan(ctx.admin, ctx.orgId, ctx.userId, customerId, body, { importSource: 'jobber', importSourceId: source.import_source_id, ended: p.ended === true })
      if (!r.ok) return r.status === 409 ? adoptBySource(ctx, 'service_plans', item) : { status: 'failed', error: r.error }
      const row = r.plan as unknown as Record<string, unknown>
      return { status: 'done', target_table: 'service_plans', target_id: r.plan.id, applied: pick(row, ['status', 'name', 'price', 'seasons', 'start_date', 'end_date', 'property_id']) }
    }
    case 'invoice': {
      const customerId = customerIdOf(ctx, p.customer)
      if (!customerId) return { status: 'failed', error: 'Its customer wasn’t brought over' }
      const header = {
        invoice_number: p.invoice_number,
        status: p.status,
        void_reason: p.void_reason ?? null,
        issued_at: p.issued_at ?? null,
        due_at: p.due_at ?? null,
        subtotal_cents: p.subtotal_cents,
        tax_cents: p.tax_cents ?? null,
        tax_lines: p.tax_lines ?? null,
        total_cents: p.total_cents,
        paid_outside_cents: p.paid_outside_cents ?? null,
        public_note: p.public_note ?? null,
        internal_note: p.internal_note ?? null,
      }
      const lines = (p.lines ?? []) as ImportedInvoiceLine[]
      if (item.action === 'update') {
        const out = await guardedUpdate(ctx, 'job_invoices', item, header, IMPORTED_INVOICE_COLUMNS)
        if (out.status === 'done' && out.before) {
          const r = await replaceImportedInvoiceLines(ctx.admin, String(item.target_id), lines)
          if (!r.ok) return { status: 'failed', error: r.error }
        }
        return out
      }
      const r = await insertImportedInvoice(ctx.admin, ctx.orgId, { customerId, propertyId: propertyIdOf(ctx, p.property), createdBy: ctx.userId, header, lines, importSourceId: source.import_source_id })
      if (!r.ok) return r.duplicate ? adoptBySource(ctx, 'job_invoices', item) : { status: 'failed', error: r.error }
      return { status: 'done', target_table: 'job_invoices', target_id: String(r.row.id), applied: pick(r.row, ['status', 'total_cents', 'paid_outside_cents', 'invoice_number', 'import_source', 'import_source_id']) }
    }
    case 'history': {
      const customerId = customerIdOf(ctx, p.customer)
      if (!customerId) return { status: 'failed', error: 'Its customer wasn’t brought over' }
      // Kept on the run as read-only history for the Customer File (no deal, job or quote is made from it).
      return { status: 'done', target_id: customerId }
    }
  }
  return { status: 'failed', error: 'Unknown item' }
}

/** The row with this Jobber id already exists (a batch cut off after the write, or two tabs): adopt it, made by this run. */
async function adoptBySource(ctx: Ctx, table: string, item: Item): Promise<Outcome> {
  const { data } = await orgDb(ctx.admin, ctx.orgId).from(table).select('id').eq('import_source', 'jobber').eq('import_source_id', item.source_id.slice(0, 200)).maybeSingle()
  if (!data) return { status: 'failed', error: 'Already imported, but the row could not be found' }
  // Made by an earlier run (that run's undo owns it) or by a cut-off batch of this one: used, and left alone by this undo.
  return { status: 'done', target_id: (data as { id: string }).id, error: 'Was already there — used as it is (Undo leaves it)' }
}

/** An existing customer the import matched: only blanks are filled; Jobber's id is noted so the next run updates it. */
async function linkCustomer(ctx: Ctx, item: Item, custom: Record<string, unknown>): Promise<Outcome> {
  const db = orgDb(ctx.admin, ctx.orgId)
  const { data: row } = await db.from('customers').select(CUSTOMER_COLS).eq('id', item.target_id).maybeSingle()
  if (!row) return { status: 'failed', error: 'The matching customer is gone' }
  const cur = row as Record<string, any>
  const p = item.payload
  const patch: Record<string, unknown> = {}
  for (const k of ['name', 'email', 'phone', 'address_text']) if (!cur[k] && p[k]) patch[k] = p[k]
  const curFields = (cur.custom_fields ?? {}) as Record<string, unknown>
  const addFields = Object.fromEntries(Object.entries(custom).filter(([k]) => curFields[k] === undefined || curFields[k] === null || curFields[k] === ''))
  if (Object.keys(addFields).length) patch.custom_fields = { ...curFields, ...addFields }
  if (!cur.import_source_id) Object.assign(patch, { import_source: 'jobber', import_source_id: item.source_id.slice(0, 200) })
  if (Object.keys(patch).length === 0) return { status: 'done', target_id: item.target_id }
  const { data: after, error } = await db.from('customers').update(patch).eq('id', item.target_id).select(CUSTOMER_COLS).single()
  if (error || !after) return { status: 'failed', error: error?.message ?? 'Could not update the customer' }
  return { status: 'done', target_table: 'customers', target_id: item.target_id, applied: pick(after as Record<string, unknown>, Object.keys(patch)), before: pick(cur, Object.keys(patch)) }
}

/** One batch (≤ 40 items). Call again until `pending` is 0. Safe to call twice at once and after a cut-off. */
export async function importBatch(admin: SupabaseClient, orgId: string, userId: string, run: RunRow): Promise<{ ok: true; progress: Progress; finished: boolean } | Fail> {
  if (run.status !== 'importing') return fail(409, run.status === 'draft' ? 'Press Import first' : 'This import is not running')
  const { data: claimed, error } = await admin.rpc('import_run_claim', { p_org: orgId, p_run: run.id, p_limit: BATCH })
  if (error) return isImportNotReadyError(error) ? fail(503, IMPORT_NOT_READY) : fail(500, 'Could not continue the import')
  const items = (claimed ?? []) as Item[]
  const ctx: Ctx = { admin, orgId, userId, runId: run.id, refs: new Map() }
  if (items.length) await loadRefs(ctx)
  const db = orgDb(admin, orgId)
  for (const item of items) {
    let out: Outcome
    try {
      out = await doItem(ctx, item)
    } catch (e) {
      out = { status: 'failed', error: e instanceof Error ? e.message : String(e) }
    }
    if (out.status === 'done' && out.target_id && RESOLVE_KINDS.includes(item.kind)) ctx.refs.set(`${item.kind}:${item.source_id}`, out.target_id)
    await db
      .from('import_run_items')
      .update({
        status: out.status,
        target_table: out.target_table ?? null,
        target_id: out.target_id ?? item.target_id ?? null,
        applied: out.applied ?? null,
        before: out.before ?? null,
        error: out.error ? out.error.slice(0, 500) : null,
        done_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .eq('status', 'working')
  }
  const progress = await runProgress(admin, orgId, run.id)
  const finished = progress.pending === 0
  if (finished) await db.from('import_runs').update({ status: 'done', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', run.id).eq('status', 'importing')
  return { ok: true, progress, finished }
}

// ---------------------------------------------------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------------------------------------------------

const UNDO_ORDER = ['history', 'invoice', 'plan', 'property', 'customer', 'price_item', 'custom_field']
const UNDO_NOTES: Record<string, string> = {
  changed: 'Changed here since the import — kept',
  in_use: 'Used by something added since the import — kept',
  gone: 'Already removed',
}

export async function startUndo(admin: SupabaseClient, orgId: string, run: RunRow): Promise<{ ok: true } | Fail> {
  if (run.status === 'undoing') return { ok: true }
  if (run.status !== 'done') return fail(409, run.status === 'importing' ? 'Wait for the import to finish' : 'Only a finished import can be undone')
  // Only the newest finished import: undoing an older one under a newer one would fight over the same rows.
  const { data: newer } = await orgDb(admin, orgId).from('import_runs').select('id').in('status', ['done', 'importing']).gt('created_at', run.created_at).limit(1)
  if ((newer ?? []).length) return fail(409, 'Undo the newer import first')
  const { data } = await orgDb(admin, orgId).from('import_runs').update({ status: 'undoing', undo_started_at: new Date().toISOString() }).eq('id', run.id).eq('status', 'done').select('id')
  return (data ?? []).length ? { ok: true } : fail(409, 'This import changed — reload')
}

export async function undoBatch(admin: SupabaseClient, orgId: string, run: RunRow): Promise<{ ok: true; progress: Progress; finished: boolean } | Fail> {
  if (run.status !== 'undoing') return fail(409, 'Press Undo first')
  const db = orgDb(admin, orgId)
  let left = BATCH
  for (const kind of UNDO_ORDER) {
    if (left <= 0) break
    const { data } = await db
      .from('import_run_items')
      .select('id, kind, target_table, target_id, applied, before')
      .eq('run_id', run.id)
      .eq('kind', kind)
      .eq('status', 'done')
      .order('seq', { ascending: false })
      .limit(left)
    const items = (data ?? []) as Array<{ id: string; kind: string; target_table: string | null; target_id: string | null; applied: Record<string, unknown> | null; before: Record<string, unknown> | null }>
    for (const it of items) {
      left -= 1
      let result = 'deleted'
      if (it.target_table && it.target_id && it.applied) {
        const rpc = it.before
          ? await admin.rpc('import_revert_row', { p_org: orgId, p_table: it.target_table, p_id: it.target_id, p_applied: it.applied, p_before: it.before })
          : await admin.rpc('import_undo_row', { p_org: orgId, p_table: it.target_table, p_id: it.target_id, p_applied: it.applied, p_ignore: it.target_table === 'job_invoices' ? ['job_invoice_items'] : [] })
        if (rpc.error) {
          await db.from('import_run_items').update({ status: 'kept', undo_note: `Could not undo: ${rpc.error.message}`.slice(0, 500) }).eq('id', it.id)
          continue
        }
        result = String(rpc.data)
      }
      const undone = result === 'deleted' || result === 'reverted'
      await db.from('import_run_items').update({ status: undone ? 'undone' : 'kept', undo_note: undone ? null : UNDO_NOTES[result] ?? result }).eq('id', it.id).eq('status', 'done')
    }
  }
  const progress = await runProgress(admin, orgId, run.id)
  const { count } = await db.from('import_run_items').select('id', { count: 'exact', head: true }).eq('run_id', run.id).eq('status', 'done')
  const finished = (count ?? 0) === 0
  if (finished) await db.from('import_runs').update({ status: 'undone', undone_at: new Date().toISOString() }).eq('id', run.id).eq('status', 'undoing')
  return { ok: true, progress, finished }
}

// ---------------------------------------------------------------------------------------------------------------------
// Lists for the screens
// ---------------------------------------------------------------------------------------------------------------------

export type ItemView = { id: string; kind: string; label: string; action: string; status: string; problems: unknown[]; error: string | null; undo_note: string | null }

/** Items that need a look after an import or undo (failed, skipped with a reason, kept). ≤ 300. */
export async function itemsNeedingALook(admin: SupabaseClient, orgId: string, runId: string): Promise<ItemView[]> {
  const { data } = await orgDb(admin, orgId)
    .from('import_run_items')
    .select('id, kind, label, action, status, problems, error, undo_note')
    .eq('run_id', runId)
    .in('status', ['failed', 'kept', 'skipped'])
    .order('rank')
    .order('seq')
    .limit(300)
  return ((data ?? []) as ItemView[]).filter((i) => i.status !== 'skipped' || i.error || (Array.isArray(i.problems) && i.problems.length))
}

/** Plans this run brought in that still wait for review (paused, no resume date). */
export async function plansToReview(admin: SupabaseClient, orgId: string, runId: string): Promise<Array<{ planId: string; customerId: string; name: string; review: string[] }>> {
  const { data } = await orgDb(admin, orgId).from('import_run_items').select('target_id, payload').eq('run_id', runId).eq('kind', 'plan').eq('status', 'done').limit(1000)
  const items = (data ?? []) as Array<{ target_id: string; payload: Record<string, any> }>
  if (!items.length) return []
  const ids = items.map((i) => i.target_id)
  const plans: Array<{ id: string; customer_id: string; name: string; status: string; paused_until: string | null }> = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data: rows } = await orgDb(admin, orgId).from('service_plans').select('id, customer_id, name, status, paused_until').in('id', ids.slice(i, i + 200))
    plans.push(...((rows ?? []) as typeof plans))
  }
  const review = new Map(items.map((i) => [i.target_id, (i.payload.review as string[]) ?? []]))
  return plans.filter((p) => p.status === 'paused' && !p.paused_until).map((p) => ({ planId: p.id, customerId: p.customer_id, name: p.name, review: review.get(p.id) ?? [] }))
}

/** "From Jobber" on the Customer File: this customer's quotes and one-off jobs as Jobber had them (read-only). */
export async function loadJobberHistory(admin: SupabaseClient, orgId: string, customerId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await orgDb(admin, orgId)
    .from('import_run_items')
    .select('label, payload, done_at')
    .eq('kind', 'history')
    .eq('status', 'done')
    .eq('target_id', customerId)
    .order('done_at', { ascending: false })
    .limit(100)
  if (error) return []
  // A re-run makes a new history item per quote/job: show each once (newest).
  const seen = new Set<string>()
  const out: Array<Record<string, unknown>> = []
  for (const r of (data ?? []) as Array<{ label: string; payload: Record<string, unknown> }>) {
    const key = `${r.payload.type}:${r.payload.number}`
    if (seen.has(key)) continue
    seen.add(key)
    const { customer: _c, ...rest } = r.payload
    out.push({ label: r.label, ...rest })
  }
  return out
}

export { ITEM_RANK }
