/**
 * Add lots for a builder (server only). Each lot is a property (the ONE matcher + writer: findOrCreateProperty →
 * createProperty) carrying a development name and lot number. Optionally each gets a job with one crew row per chosen trade
 * (addManualTrade, the same "+ Add trade" the job page uses). A lot job is builder work, not a sale: status 'sold' (the existing
 * "booked, not yet scheduled" step the Jobs-to-schedule list and the crew scheduling read) but no sale date, sale amount, salesperson or
 * commission base, so payroll (which plans only jobs with a sale date), commissions and sales counts never see it. A re-run is safe: a lot already on file is matched by address
 * and only gets its development / lot filled in when blank; a lot that already has an open job gets no second one.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { canonicalDevelopment, listDevelopments } from '@/lib/developments-db'
import { addManualTrade } from '@/lib/job-trades-db'
import { LOTS_BATCH, placeholderLotAddress, type LotRow } from '@/lib/lots'
import { developmentKey } from '@/lib/properties'
import { loadOrgTrades, activeTrades, MIXED_JOB_TYPE } from '@/lib/org-trades'
import { loadCustomerProperties, updateProperty } from '@/lib/properties-db'
import { findOrCreateProperty } from '@/lib/service-plans-db'
import { orgDb } from '@/lib/supabase/org-db'

export type AddLotsInput = { development: string; rows: LotRow[]; trades: string[]; createJobs: boolean }
export type AddLotsResult = {
  added: number
  existed: number
  jobsCreated: number
  jobsSkipped: number
  failed: Array<{ lot: string; error: string }>
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

export function readAddLotsBody(body: unknown): { ok: true; value: AddLotsInput } | { ok: false; error: string } {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const development = clean(b.development, 120)
  if (!development) return { ok: false, error: 'Pick or enter the development' }
  if (!Array.isArray(b.rows) || b.rows.length === 0) return { ok: false, error: 'Add at least one lot' }
  if (b.rows.length > LOTS_BATCH) return { ok: false, error: `At most ${LOTS_BATCH} lots at a time` }
  const rows: LotRow[] = []
  for (const r of b.rows as Array<Record<string, unknown>>) {
    const lot = clean(r?.lot, 40)
    if (!lot) return { ok: false, error: 'Every row needs a lot number' }
    rows.push({ lot, address: clean(r.address, 200), city: clean(r.city, 100), state: clean(r.state, 50), zip: clean(r.zip, 20) })
  }
  const trades = Array.isArray(b.trades) ? Array.from(new Set((b.trades as unknown[]).filter((t): t is string => typeof t === 'string'))) : []
  return { ok: true, value: { development, rows, trades, createJobs: b.createJobs === true } }
}

export async function addLots(admin: SupabaseClient, orgId: string, userId: string, customerId: string, input: AddLotsInput, opts: { accessNotes: boolean }): Promise<{ ok: true; result: AddLotsResult } | { ok: false; status: number; error: string }> {
  const orgTrades = await loadOrgTrades(admin, orgId)
  const allowed = new Set(activeTrades(orgTrades).map((t) => t.slug))
  const tradeSlugs = activeTrades(orgTrades).map((t) => t.slug).filter((s) => input.trades.includes(s)) // the company's own order
  if (input.trades.some((t) => !allowed.has(t))) return { ok: false, status: 400, error: 'One of those trades is not on your list' }
  if (input.createJobs && tradeSlugs.length === 0) return { ok: false, status: 400, error: 'Pick at least one trade to make jobs' }

  // The company's development names, read once for the whole batch and matched once: every lot gets the same spelling.
  const known = [...(await listDevelopments(admin, orgId))]
  const development = canonicalDevelopment(input.development, known) as string
  if (!known.some((d) => d.key === developmentKey(development))) known.push({ name: development, key: developmentKey(development), lots: 0, builders: [] })
  const loaded = await loadCustomerProperties(admin, orgId, customerId, { includeInactive: true, accessNotes: false })
  if (!loaded.ready) return { ok: false, status: 503, error: 'Properties turn on once the database update for them is applied.' }
  const byId = new Map(loaded.properties.map((p) => [p.id, p]))
  const seen = loaded.properties.map((p) => ({ id: p.id, address_text: p.address_text }))

  const result: AddLotsResult = { added: 0, existed: 0, jobsCreated: 0, jobsSkipped: 0, failed: [] }
  const placed: Array<{ propertyId: string; lot: string }> = []
  for (const row of input.rows) {
    const street = row.address || placeholderLotAddress(row.lot, development)
    const body = { community: development, lot: row.lot, address_line1: street, city: row.city || null, state: row.state || null, zip: row.zip || null }
    const found = await findOrCreateProperty(admin, orgId, userId, customerId, [street, row.city, [row.state, row.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), body, { accessNotes: opts.accessNotes, known: seen, knownDevelopments: known })
    if (!found.ok) {
      result.failed.push({ lot: row.lot, error: found.error })
      continue
    }
    if (found.created) result.added += 1
    else {
      result.existed += 1
      const have = byId.get(found.propertyId)
      if (have && !have.community && !have.lot) await updateProperty(admin, orgId, userId, have, { community: development, lot: row.lot }, { accessNotes: false, knownDevelopments: known })
    }
    placed.push({ propertyId: found.propertyId, lot: row.lot })
  }

  if (input.createJobs && placed.length > 0) {
    const db = orgDb(admin, orgId)
    // A lookup that fails must stop here: guessing "no job yet" would make a second job for every lot.
    const { data: open, error: openError } = await db.from('production_jobs').select('property_id').in('property_id', placed.map((p) => p.propertyId)).is('cancelled_at', null)
    if (openError) {
      console.error('[lots] existing-job lookup failed', openError)
      return { ok: false, status: 500, error: 'The lots were saved, but their jobs could not be checked, so none were made. Run it again.' }
    }
    const hasJob = new Set(((open ?? []) as Array<{ property_id: string }>).map((j) => j.property_id))
    const addressOf = new Map(seen.map((p) => [p.id, p.address_text]))
    for (const p of placed) {
      if (hasJob.has(p.propertyId)) {
        result.jobsSkipped += 1
        continue
      }
      const have = byId.get(p.propertyId)
      const made = await createLotJob(admin, orgId, userId, { customerId, propertyId: p.propertyId, addressText: addressOf.get(p.propertyId) ?? '', lat: have?.lat ?? null, lng: have?.lng ?? null, trades: tradeSlugs })
      if (made !== 'failed') result.jobsCreated += 1
      if (made === 'failed') result.failed.push({ lot: p.lot, error: 'The lot was saved, but its job was not' })
      if (made === 'partial') result.failed.push({ lot: p.lot, error: 'The job was made, but not every crew was added: open it and use + Add trade' })
    }
  }
  return { ok: true, result }
}

/**
 * A job for one lot, at the property's FULL address (and its map point when it has one; the crew rows copy the job's address).
 * No sale, no money (see the header). Its project is the plain wrapper every job hangs on; the crews are one work order per trade
 * through the existing addManualTrade. Why not POST /api/ops/jobs: that path turns a signed sale into a job (sale amount, commission
 * base, contract lookups) and a builder's lot has none of that (Known Redundancy #29).
 *
 * Every write is checked. The job number is made by the database (highest + 1), so two jobs made at once can collide: one retry.
 * If the job still cannot be made, the project made for it is set to 'cancelled' (never deleted), so no live orphan is left.
 */
export async function createLotJob(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  a: { customerId: string; propertyId: string; addressText: string; lat: number | null; lng: number | null; trades: string[] }
): Promise<'done' | 'partial' | 'failed'> {
  if (!a.addressText) return 'failed'
  const db = orgDb(admin, orgId)
  const { data: project, error: pe } = await db.from('projects').insert({ customer_id: a.customerId, address_text: a.addressText, lat: a.lat, lng: a.lng, status: 'in_progress', owner_user_id: userId }).select('id').single()
  if (pe || !project) {
    console.error('[lots] project insert failed', pe)
    return 'failed'
  }
  const projectId = (project as { id: string }).id
  const jobRow = { project_id: projectId, customer_id: a.customerId, property_id: a.propertyId, address_text: a.addressText, lat: a.lat, lng: a.lng, job_type: a.trades.length === 1 ? a.trades[0] : MIXED_JOB_TYPE, created_by: userId }
  let job: { id: string } | null = null
  for (let attempt = 0; attempt < 2 && !job; attempt++) {
    const { data, error } = await db.from('production_jobs').insert(jobRow).select('id').single()
    if (data && !error) job = data as { id: string }
    else {
      console.error('[lots] job insert failed', attempt, error)
      if ((error as { code?: string } | null)?.code !== '23505') break
    }
  }
  if (!job) {
    const { error } = await db.from('projects').update({ status: 'cancelled' }).eq('id', projectId)
    if (error) console.error('[lots] could not close the project of a failed job', projectId, error)
    return 'failed'
  }
  let ok = true
  for (const slug of a.trades) {
    const t = await addManualTrade(admin, orgId, job.id, slug, userId)
    if ('error' in t) {
      console.error('[lots] trade failed', slug, t.error)
      ok = false
    }
  }
  return ok ? 'done' : 'partial'
}
