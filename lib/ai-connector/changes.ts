/**
 * Writes with preview + approval by the PERSON — the ONE engine. The AI never holds the power to save anything:
 *   1. `proposeChange` (the AI's write tool) — `prepare` checks the person's own permission and builds the exact preview;
 *      we store the arguments + preview as a `pending` row (`ai_changes`) and hand the AI only a preview and a link.
 *   2. The signed-in PERSON opens `/ai-changes/<id>` in the CRM and taps Approve or Decline (`approveChange` /
 *      `declineChange`: session cookie, same person, 10 minutes, once). Approve re-checks permission and that the preview is
 *      still true, claims the row, and calls the tool's `apply` (the app's existing writer).
 *   3. `checkChange` (the AI's `confirm_change` tool) only REPORTS the state: pending / saved / declined. It never applies.
 * Arguments are hashed and re-checked at approval so a changed row never applies.
 */
import { writeAudit } from '@/lib/ai-connector/audit'
import { APPLY_STALE_SECONDS, CHANGE_TTL_SECONDS, FAILED_CHANGE_KEEP_DAYS, MAX_APPLY_ATTEMPTS, MAX_PENDING_CHANGES, PENDING_CHANGE_KEEP_DAYS, RATE_LIMITS, WRITE_SCOPE } from '@/lib/ai-connector/config'
import { hashArgs } from '@/lib/ai-connector/crypto'
import { dbRateGate } from '@/lib/ai-connector/rate-limit'
import { wrapUntrusted } from '@/lib/ai-connector/untrusted'
import { ID, ToolError, type ChangeOutcome, type ChangePreview, type McpTool, type ToolContext, type ToolResult, type WriteSpec } from '@/lib/ai-connector/tools/types'
import { orgDb } from '@/lib/supabase/org-db'

export const REVIEW_PATH = (id: string) => `/ai-changes/${id}`
const GONE = 'This change was not found, or it is not yours to approve.'

type Status = 'pending' | 'applying' | 'applied' | 'failed' | 'expired' | 'cancelled' | 'declined'
export type ChangeRow = {
  id: string
  user_id: string
  grant_id: string | null
  client_id: string | null
  tool: string
  args: unknown
  args_hash: string
  preview: ChangePreview
  preview_hash: string
  status: Status
  expires_at: string
  confirmed_at: string | null
  attempts: number
  result: ChangeOutcome | null
  error: string | null
}
const COLS = 'id, user_id, grant_id, client_id, tool, args, args_hash, preview, preview_hash, status, expires_at, confirmed_at, attempts, result, error'

/** Same text, same hash: the preview is hashed so approval can tell whether the world changed under it. */
export function previewHash(p: ChangePreview): string {
  return hashArgs({ t: p.title, l: p.lines, k: p.links, r: p.recordIds, w: p.warnings ?? [] })
}

const nowOf = (ctx: ToolContext) => ctx.now ?? Date.now()

/** Every write door starts here: the connection carries `crm:write` and the company's switch is on (decided this request). */
export function assertWritesAllowed(ctx: ToolContext): void {
  if (ctx.writesAllowed !== true) {
    throw new ToolError('denied', 'This connection cannot make changes. Changes are off for this company, or the person did not allow them when connecting. You can still look things up.', 'writes_off')
  }
}

/** The AI sees preview text as data (fenced); screens render the same rows as plain text. */
function previewForAi(p: ChangePreview) {
  return {
    title: p.title,
    changes: p.lines.map((l) => ({ label: l.label, value: wrapUntrusted(l.value, 600) })),
    ...(p.warnings && p.warnings.length ? { warnings: p.warnings.map((w) => wrapUntrusted(w, 300)) } : {}),
  }
}

export async function proposeChange<A>(tool: McpTool & { write: WriteSpec<A> }, ctx: ToolContext, args: A): Promise<ToolResult> {
  assertWritesAllowed(ctx)
  const rate = ctx.rate ?? dbRateGate(ctx.admin, ctx.now)
  const r = await rate(`mcp:write-preview:user:${ctx.userId}`, RATE_LIMITS.writePreviewPerMinute, 60)
  if (!r.ok) throw new ToolError('unavailable', 'Too many change requests. Wait a minute and try again.', 'rate_limited')

  const db = orgDb(ctx.admin, ctx.orgId)
  const nowIso = new Date(nowOf(ctx)).toISOString()
  const { count } = await db.from('ai_changes').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('status', 'pending').gt('expires_at', nowIso)
  if ((count ?? 0) >= MAX_PENDING_CHANGES) throw new ToolError('bad_input', 'There are too many changes waiting for the person. Ask them to approve or decline some first (they expire in 10 minutes).', 'too_many_pending')

  // Permission, validity and the exact preview. Writes nothing.
  const preview = await tool.write.prepare(ctx, args)

  const { data: made, error } = await db
    .from('ai_changes')
    .insert({
      user_id: ctx.userId,
      grant_id: ctx.grantId ?? null,
      client_id: ctx.clientId ?? null,
      tool: tool.name,
      args: args as object,
      args_hash: hashArgs(args),
      preview,
      preview_hash: previewHash(preview),
      status: 'pending',
      expires_at: new Date(nowOf(ctx) + CHANGE_TTL_SECONDS * 1000).toISOString(),
    })
    .select('id')
    .single()
  const id = (made as { id?: string } | null)?.id
  // Fails closed (nothing to approve) until migration 202611150070 is applied.
  if (error || !id) {
    console.error('[ai-connector] could not store a proposed change', error?.message)
    throw new ToolError('unavailable', 'Changes are not available right now. Nothing was saved.', 'store_failed')
  }
  if (Math.random() < 0.05) void ctx.admin.rpc('ai_prune_changes', { p_days: PENDING_CHANGE_KEEP_DAYS, p_failed_days: FAILED_CHANGE_KEEP_DAYS }).then(() => undefined, () => undefined)

  return {
    data: {
      status: 'waiting_for_the_person_to_approve_nothing_saved',
      change_id: id,
      review_link: `${ctx.origin ?? ''}${REVIEW_PATH(id)}`,
      preview: previewForAi(preview),
      expires_in_seconds: CHANGE_TTL_SECONDS,
      next_step: 'Nothing has been saved and you cannot save it. Tell the person what you prepared and give them review_link: they open it in the CRM, check the exact change and tap Approve or Decline. You can call confirm_change with change_id to see whether they did. Do not ask them to paste anything back, and do not retry.',
    },
    recordIds: preview.recordIds,
  }
}

async function setStatus(ctx: ToolContext, id: string, from: Status, patch: Record<string, unknown>): Promise<boolean> {
  const { data } = await orgDb(ctx.admin, ctx.orgId).from('ai_changes').update(patch).eq('id', id).eq('status', from).select('id')
  return Array.isArray(data) && data.length > 0
}

/** What the AI may learn about a change it proposed: its state, never a way to move it. */
export async function checkChange(ctx: ToolContext, changeId: string): Promise<ToolResult> {
  assertWritesAllowed(ctx)
  if (typeof changeId !== 'string' || !ID.test(changeId)) throw new ToolError('not_found', undefined, 'bad_id')
  const { data } = await orgDb(ctx.admin, ctx.orgId).from('ai_changes').select(COLS).eq('id', changeId).maybeSingle()
  const row = data as ChangeRow | null
  // Another person's change, another connection's change and no such change look the same.
  if (!row || row.user_id !== ctx.userId || !row.grant_id || row.grant_id !== ctx.grantId) throw new ToolError('not_found', undefined, row ? 'not_yours' : 'unknown')
  const expired = row.status === 'pending' && new Date(row.expires_at).getTime() <= nowOf(ctx)
  const status = expired ? 'expired' : row.status
  const words: Record<string, string> = {
    pending: 'waiting_for_the_person_to_approve',
    applying: 'being_saved',
    applied: 'saved',
    declined: 'declined_by_the_person',
    expired: 'expired_not_saved',
    cancelled: 'not_saved',
    failed: 'not_saved',
  }
  return {
    data: {
      status: words[status] ?? 'not_saved',
      change_id: row.id,
      ...(status === 'pending' ? { review_link: `${ctx.origin ?? ''}${REVIEW_PATH(row.id)}` } : {}),
      ...(status === 'applied' && row.result ? { summary: row.result.summary, records: row.result.links } : {}),
      ...(status === 'declined' || status === 'cancelled' || status === 'expired' || status === 'failed' ? { next_step: 'Not saved. Only ask for it again if the person wants that.' } : {}),
    },
    recordIds: row.result?.recordIds ?? [],
  }
}

export type ChangeLookup = (name: string) => (McpTool & { write?: WriteSpec<never> }) | undefined

type Approver = { ctx: ToolContext; lookup: ChangeLookup }

async function grantLive(ctx: ToolContext, grantId: string | null): Promise<boolean> {
  if (!grantId) return false
  const { data } = await ctx.admin.from('ai_oauth_grants').select('id, revoked_at').eq('id', grantId).eq('org_id', ctx.orgId).eq('user_id', ctx.userId).maybeSingle()
  return !!data && !(data as { revoked_at: string | null }).revoked_at
}

async function clientNameOf(ctx: ToolContext, clientId: string | null): Promise<string> {
  if (!clientId) return 'an AI app'
  const { data } = await ctx.admin.from('ai_oauth_clients').select('client_name').eq('client_id', clientId).maybeSingle()
  // The app chose this name when it registered: treat it as untrusted text.
  const name = String((data as { client_name?: string } | null)?.client_name ?? '').replace(/<[^>]*>/g, '').replace(/[^\w .'-]/g, '').trim().slice(0, 40)
  return name || 'an AI app'
}

/** The person's own decision. `ctx` is built from THEIR session (never from an AI connection). */
export async function approveChange(ctx: ToolContext, changeId: string, lookup: ChangeLookup): Promise<ToolResult> {
  try {
    return await approveInner({ ctx, lookup }, changeId)
  } catch (e) {
    if (e instanceof ToolError) {
      await writeAudit(ctx.admin, { orgId: ctx.orgId, userId: ctx.userId, clientId: null, tool: 'change.refused', result: e.code === 'denied' || e.code === 'not_found' ? 'denied' : 'error', detail: `${changeId}:${e.reason ?? e.code}` }).catch(() => undefined)
    }
    throw e
  }
}

async function loadMine(ctx: ToolContext, changeId: string): Promise<ChangeRow> {
  if (typeof changeId !== 'string' || !ID.test(changeId)) throw new ToolError('not_found', GONE, 'bad_id')
  const { data } = await orgDb(ctx.admin, ctx.orgId).from('ai_changes').select(COLS).eq('id', changeId).maybeSingle()
  const row = data as ChangeRow | null
  // Only the person it was prepared for: not an owner, not a teammate, not the AI.
  if (!row || row.user_id !== ctx.userId) throw new ToolError('not_found', GONE, row ? 'not_yours' : 'unknown')
  return row
}

async function approveInner({ ctx, lookup }: Approver, changeId: string): Promise<ToolResult> {
  assertWritesAllowed(ctx)
  const row = await loadMine(ctx, changeId)

  // Shown again after a save: the first result, nothing written twice.
  if (row.status === 'applied') return { data: { status: 'saved', already_saved: true, ...(row.result ? { summary: row.result.summary, records: row.result.links } : {}) }, recordIds: row.result?.recordIds ?? [] }

  const tool = lookup(row.tool)
  if (!tool || !tool.write) throw new ToolError('denied', GONE, 'tool_unknown')
  const spec = tool.write as WriteSpec<unknown>

  let retry = false
  if (row.status === 'applying') {
    const stale = !!row.confirmed_at && nowOf(ctx) - new Date(row.confirmed_at).getTime() > APPLY_STALE_SECONDS * 1000
    // A save that never finished (crash) is tried ONE more time, only for writers that dedupe on this change's id. The rest go to the owner screen.
    if (!(stale && spec.idempotent === true && row.attempts < MAX_APPLY_ATTEMPTS)) throw new ToolError('bad_input', 'This change is being saved. Check the record in a minute.', 'in_progress')
    retry = true
  } else if (row.status !== 'pending') {
    throw new ToolError('bad_input', 'This change was not saved and cannot be approved now. Ask the AI app for it again.', `status_${row.status}`)
  } else if (new Date(row.expires_at).getTime() <= nowOf(ctx)) {
    await setStatus(ctx, row.id, 'pending', { status: 'expired' })
    throw new ToolError('bad_input', 'This change expired (10 minutes). Ask the AI app for it again.', 'expired')
  }

  if (!(await grantLive(ctx, row.grant_id))) {
    await setStatus(ctx, row.id, row.status, { status: 'cancelled', error: 'connection_ended' })
    throw new ToolError('denied', 'The AI app was disconnected, so this change was not saved.', 'connection_ended')
  }

  if (hashArgs(row.args) !== row.args_hash) {
    await setStatus(ctx, row.id, row.status, { status: 'cancelled', error: 'args_changed' })
    throw new ToolError('denied', 'This change no longer matches what was prepared, so it was not saved.', 'args_changed')
  }
  const parsed = tool.schema.safeParse(row.args)
  if (!parsed.success) {
    await setStatus(ctx, row.id, row.status, { status: 'cancelled', error: 'args_invalid' })
    throw new ToolError('bad_input', 'This change is no longer valid.', 'args_invalid')
  }

  const rate = ctx.rate ?? dbRateGate(ctx.admin, ctx.now)
  for (const [key, limit, secs] of [
    [`mcp:write-confirm:user:${ctx.userId}`, RATE_LIMITS.writeConfirmPerMinute, 60],
    [`mcp:write-confirm-day:user:${ctx.userId}`, RATE_LIMITS.writeConfirmPerDay, 86_400],
    [`mcp:write-confirm-day:org:${ctx.orgId}`, RATE_LIMITS.orgWriteConfirmPerDay, 86_400],
  ] as const) {
    const r = await rate(key, limit, secs)
    if (!r.ok) throw new ToolError('unavailable', 'Too many AI changes saved lately. Try again later.', 'rate_limited')
  }

  const applyCtx: ToolContext = { ...ctx, clientName: await clientNameOf(ctx, row.client_id), grantId: row.grant_id ?? undefined, clientId: row.client_id ?? undefined }

  if (!retry) {
    // The person's permission and the facts are checked AGAIN now, and must still match the preview they are looking at.
    let fresh: ChangePreview
    try {
      fresh = await spec.prepare(applyCtx, parsed.data)
    } catch (e) {
      if (e instanceof ToolError) await setStatus(ctx, row.id, 'pending', { status: 'cancelled', error: e.reason ?? e.code })
      throw e
    }
    if (previewHash(fresh) !== row.preview_hash) {
      await setStatus(ctx, row.id, 'pending', { status: 'cancelled', error: 'changed_since_preview' })
      throw new ToolError('bad_input', 'Something changed since the AI prepared this, so nothing was saved. Ask for the change again to see the new one.', 'changed_since_preview')
    }
    // Exactly one click wins the claim.
    if (!(await setStatus(ctx, row.id, 'pending', { status: 'applying', confirmed_at: new Date(nowOf(ctx)).toISOString(), attempts: row.attempts + 1 }))) {
      throw new ToolError('bad_input', 'This change was just approved by another request. Check the record.', 'lost_claim')
    }
  } else {
    const { data: won } = await orgDb(ctx.admin, ctx.orgId).from('ai_changes').update({ confirmed_at: new Date(nowOf(ctx)).toISOString(), attempts: row.attempts + 1 }).eq('id', row.id).eq('status', 'applying').eq('attempts', row.attempts).select('id')
    if (!Array.isArray(won) || won.length === 0) throw new ToolError('bad_input', 'This change is being saved. Check the record in a minute.', 'lost_claim')
  }

  let outcome: ChangeOutcome
  try {
    outcome = await spec.apply(applyCtx, parsed.data, row.id)
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : 'Could not save'
    await setStatus(ctx, row.id, 'applying', { status: 'failed', error: msg.slice(0, 300), finished_at: new Date(nowOf(ctx)).toISOString() })
    if (e instanceof ToolError) throw new ToolError(e.code === 'denied' || e.code === 'not_found' ? e.code : 'bad_input', `Not saved. ${e.message}`, e.reason ?? e.code)
    console.error('[ai-connector] change failed', row.tool, e)
    throw new ToolError('unavailable', 'Not saved. Something went wrong; check the record and ask again if needed.', 'apply_failed')
  }
  const done = await setStatus(ctx, row.id, 'applying', { status: 'applied', result: outcome, record_ids: outcome.recordIds.slice(0, 50), finished_at: new Date(nowOf(ctx)).toISOString() })
  if (!done) console.error('[ai-connector] change saved but its row could not be closed', row.id)
  // A permanent line in the audit log that names the change and the person who approved it.
  await writeAudit(ctx.admin, { orgId: ctx.orgId, userId: ctx.userId, clientId: row.client_id, tool: `change.${row.tool}`, recordIds: outcome.recordIds, result: 'ok', detail: row.id })
  return { data: { status: 'saved', summary: outcome.summary, records: outcome.links }, recordIds: outcome.recordIds }
}

/** The person says no. Nothing is written; the AI sees `declined_by_the_person`. */
export async function declineChange(ctx: ToolContext, changeId: string): Promise<ToolResult> {
  const row = await loadMine(ctx, changeId)
  if (row.status === 'declined') return { data: { status: 'declined' } }
  if (row.status !== 'pending') throw new ToolError('bad_input', 'This change can no longer be declined.', `status_${row.status}`)
  if (!(await setStatus(ctx, row.id, 'pending', { status: 'declined', finished_at: new Date(nowOf(ctx)).toISOString() }))) throw new ToolError('bad_input', 'This change was just handled by another request.', 'lost_claim')
  await writeAudit(ctx.admin, { orgId: ctx.orgId, userId: ctx.userId, clientId: row.client_id, tool: 'change.declined', result: 'ok', detail: row.id }).catch(() => undefined)
  return { data: { status: 'declined' } }
}

/** What the approval page needs: only the person it was prepared for may read it. */
export async function loadChangeForReview(ctx: ToolContext, changeId: string): Promise<{ row: ChangeRow; clientName: string; expired: boolean }> {
  const row = await loadMine(ctx, changeId)
  const expired = row.status === 'pending' && new Date(row.expires_at).getTime() <= nowOf(ctx)
  return { row, clientName: await clientNameOf(ctx, row.client_id), expired }
}

/** Wraps a `prepare`/`apply` pair as a normal tool: its `run` is "propose". Saving is only ever the person's click. */
export function writeTool<S extends import('zod').ZodTypeAny>(def: {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  schema: S
  destructive?: boolean
  write: WriteSpec<import('zod').infer<S>>
}): McpTool & { write: WriteSpec<import('zod').infer<S>> } {
  const tool: McpTool & { write: WriteSpec<import('zod').infer<S>> } = {
    name: def.name,
    title: def.title,
    description: `${def.description} This only PREPARES the change: it returns a preview and a review_link. Nothing is saved until the PERSON opens that link in the CRM and taps Approve; you cannot approve it.`,
    inputSchema: def.inputSchema,
    schema: def.schema,
    readOnly: false,
    needsWrites: true,
    destructive: def.destructive === true,
    write: def.write,
    run: (ctx, args) => proposeChange(tool, ctx, args as never),
  }
  return tool
}

export { WRITE_SCOPE }
