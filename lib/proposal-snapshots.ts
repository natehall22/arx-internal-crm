/**
 * Proposal snapshots — server only. What a customer was shown on a proposal, kept as DATA (the exact figures, lines, theme and
 * notes fed to the PDF renderer, `components/ProposalPDFv2`) so the exact PDF can be rebuilt later with the same renderer.
 * Same idea as the online-quote approval snapshot (`lib/quotes/approve.ts`: the record is data, the PDF is rendered from it,
 * never from the live proposal) — but a proposal is never signed, so there is no approval here, only "what did we quote".
 *
 * ONE writer (`saveProposalSnapshot`) and ONE reader (`listProposalSnapshots` / `loadProposalSnapshot`); the API route
 * `app/api/proposals/[id]/snapshots` is the only caller and applies the same access rule as reading the proposal.
 * The hash is computed HERE from canonical JSON: an unchanged regenerate hits the unique (proposal_id, content_hash) and
 * stores nothing. The table may not exist yet (migration 202611250010): then saving skips quietly and logs once, so a PDF
 * download never fails because of it.
 */
import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { mayAccessDealDoc } from '@/lib/deal-scope'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { orgDb } from '@/lib/supabase/org-db'

export const SNAPSHOT_REASONS = ['pdf', 'sent', 'quote_link'] as const
export type SnapshotReason = (typeof SNAPSHOT_REASONS)[number]
export const MAX_SNAPSHOT_BYTES = 512 * 1024

/** What the renderer is fed: the exact data object and theme. Images are paths / URLs only, never bytes. */
export type ProposalPdfSnapshot = { v: 1; theme: 'dark' | 'print'; data: Record<string, unknown> }

export type SnapshotSummary = { id: string; reason: SnapshotReason; createdAt: string; createdBy: string | null; createdByName: string | null; total: number | null }

export type SaveSnapshotResult =
  | { ok: true; stored: true; id: string; contentHash: string }
  | { ok: true; stored: false; why: 'duplicate' | 'table_missing'; contentHash?: string }
  | { ok: false; status: 400 | 404 | 413 | 500; error: string }

/** Stable JSON: object keys sorted, undefined dropped, so the same content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`
  const o = value as Record<string, unknown>
  const parts: string[] = []
  for (const k of Object.keys(o).sort()) if (o[k] !== undefined) parts.push(`${JSON.stringify(k)}:${canonicalJson(o[k])}`)
  return `{${parts.join(',')}}`
}

export function hashSnapshot(snapshot: unknown): string {
  return createHash('sha256').update(canonicalJson(snapshot)).digest('hex')
}

/** Image bytes never go in the record: any inline `data:` value is dropped (the renderer re-fetches the path / URL it was made from). */
export function stripInlineImages<T>(value: T): T {
  if (typeof value === 'string') return (/^data:/i.test(value) ? undefined : value) as unknown as T
  if (Array.isArray(value)) return value.map((v) => stripInlineImages(v)).filter((v) => v !== undefined) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = stripInlineImages(v)
      if (s !== undefined) out[k] = s
    }
    return out as T
  }
  return value
}

/** Pure: the shape the route accepts, for the proposal it was posted to. */
export function validateSnapshotInput(raw: unknown, proposalId: string): { snapshot: ProposalPdfSnapshot } | { error: string } {
  const s = raw as { v?: unknown; theme?: unknown; data?: { proposal?: { id?: unknown } } } | null
  if (!s || typeof s !== 'object') return { error: 'snapshot is required' }
  if (s.theme !== 'dark' && s.theme !== 'print') return { error: 'snapshot theme must be dark or print' }
  if (!s.data || typeof s.data !== 'object' || Array.isArray(s.data)) return { error: 'snapshot data is required' }
  if (s.data.proposal?.id !== proposalId) return { error: 'snapshot is for a different proposal' }
  return { snapshot: stripInlineImages({ v: 1, theme: s.theme, data: s.data as Record<string, unknown> }) }
}

let warnedMissing = false
function tableMissing(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /proposal_snapshots/.test(error.message ?? '') && /does not exist|schema cache|could not find/i.test(error.message ?? '')
}
function warnMissingOnce() {
  if (warnedMissing) return
  warnedMissing = true
  console.warn('[proposal-snapshots] table proposal_snapshots is missing (migration 202611250010 not applied); snapshots are skipped')
}

/** The one writer. The proposal must be this company's; an identical snapshot already stored is not stored again. */
export async function saveProposalSnapshot(
  admin: SupabaseClient,
  input: { orgId: string; userId: string; proposalId: string; reason: SnapshotReason; snapshot: ProposalPdfSnapshot }
): Promise<SaveSnapshotResult> {
  if (!SNAPSHOT_REASONS.includes(input.reason)) return { ok: false, status: 400, error: 'Unknown reason' }
  const snapshot = stripInlineImages(input.snapshot)
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_SNAPSHOT_BYTES) return { ok: false, status: 413, error: 'Snapshot is too large' }
  const db = orgDb(admin, input.orgId)
  const { data: proposal } = await db.from('proposals').select('id').eq('id', input.proposalId).maybeSingle()
  if (!proposal) return { ok: false, status: 404, error: 'Proposal not found' }
  const contentHash = hashSnapshot(snapshot)
  const { data, error } = await db
    .from('proposal_snapshots')
    .insert({ proposal_id: input.proposalId, reason: input.reason, content_hash: contentHash, snapshot, created_by: input.userId })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return { ok: true, stored: false, why: 'duplicate', contentHash }
    if (tableMissing(error)) {
      warnMissingOnce()
      return { ok: true, stored: false, why: 'table_missing' }
    }
    console.error('[proposal-snapshots] save failed', error.message)
    return { ok: false, status: 500, error: 'Could not save the snapshot' }
  }
  return { ok: true, stored: true, id: String((data as { id: string }).id), contentHash }
}

/** Newest first; the stored data is not sent (a list never needs it). A missing table reads as no history. */
export async function listProposalSnapshots(admin: SupabaseClient, orgId: string, proposalId: string): Promise<SnapshotSummary[]> {
  const db = orgDb(admin, orgId)
  const { data, error } = await db
    .from('proposal_snapshots')
    .select('id, reason, created_by, created_at, total:snapshot->data->proposal->>total')
    .eq('proposal_id', proposalId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    if (tableMissing(error)) warnMissingOnce()
    return []
  }
  const rows = (data ?? []) as Array<{ id: string; reason: SnapshotReason; created_by: string | null; created_at: string; total: string | number | null }>
  const ids = Array.from(new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v)))
  const names = new Map<string, string>()
  if (ids.length > 0) {
    const { data: users } = await db.from('users').select('id, full_name').in('id', ids)
    for (const u of (users ?? []) as Array<{ id: string; full_name: string | null }>) if (u.full_name) names.set(u.id, u.full_name)
  }
  return rows.map((r) => {
    const total = r.total == null || r.total === '' ? null : Number(r.total)
    return { id: r.id, reason: r.reason, createdAt: r.created_at, createdBy: r.created_by, createdByName: r.created_by ? names.get(r.created_by) ?? null : null, total: total != null && Number.isFinite(total) ? total : null }
  })
}

export async function loadProposalSnapshot(admin: SupabaseClient, orgId: string, proposalId: string, snapshotId: string): Promise<ProposalPdfSnapshot | null> {
  const { data } = await orgDb(admin, orgId).from('proposal_snapshots').select('snapshot').eq('id', snapshotId).eq('proposal_id', proposalId).maybeSingle()
  return ((data as { snapshot?: ProposalPdfSnapshot } | null)?.snapshot as ProposalPdfSnapshot | undefined) ?? null
}

/**
 * Who may read or write a proposal's snapshots: exactly who may read the proposal (`GET /api/proposals/[id]`) — not barred from
 * sales documents (setters, inside sales, call center), and a closer only on deals they are on. Another company's proposal is 404.
 */
export async function resolveSnapshotAccess(
  admin: SupabaseClient,
  profile: { id?: string; org_id: string; role: string; custom_role_id?: string | null; is_super_admin?: boolean | null },
  userId: string,
  proposalId: string
): Promise<{ ok: true } | { ok: false; status: 403 | 404 }> {
  if (await resolveSalesDocAccessBarred(admin, userId, profile)) return { ok: false, status: 403 }
  const { data: proposal } = await orgDb(admin, profile.org_id).from('proposals').select('id, created_by, opportunity_id').eq('id', proposalId).maybeSingle()
  if (!proposal) return { ok: false, status: 404 }
  if (!(await mayAccessDealDoc(admin, { id: userId, role: profile.role, is_super_admin: profile.is_super_admin }, proposal as { created_by?: string | null; opportunity_id?: string | null }))) return { ok: false, status: 404 }
  return { ok: true }
}
