/**
 * Writes with preview + confirm — the ONE engine. A write tool never saves anything itself:
 *   1. `proposeChange` — the tool's `prepare` checks the person's own permission and builds the exact preview; we store the
 *      arguments + preview as a `pending` row (`ai_changes`) and hand back a single-use confirm key.
 *   2. `confirmChange` — only the same person, on the same connection, with that key, within 10 minutes, once: re-checks the
 *      permission and that the preview is still true, claims the row, and calls the tool's `apply` (which calls the app's
 *      existing writer). A repeat of a confirmed key returns the first result and writes nothing.
 * The key is stored as a SHA-256 hash; the arguments are hashed and re-checked at confirm so a changed row never applies.
 */
import { writeAudit } from '@/lib/ai-connector/audit'
import { CHANGE_TTL_SECONDS, MAX_PENDING_CHANGES, PENDING_CHANGE_KEEP_DAYS, RATE_LIMITS, WRITE_SCOPE } from '@/lib/ai-connector/config'
import { hashArgs, randomToken, sha256Hex } from '@/lib/ai-connector/crypto'
import { dbRateGate } from '@/lib/ai-connector/rate-limit'
import { wrapUntrusted } from '@/lib/ai-connector/untrusted'
import { ToolError, type ChangeOutcome, type ChangePreview, type McpTool, type ToolContext, type ToolResult, type WriteSpec } from '@/lib/ai-connector/tools/types'
import { orgDb } from '@/lib/supabase/org-db'

export const CONFIRM_PREFIX = 'acf_'
const TOKEN_SHAPE = /^acf_[A-Za-z0-9_-]{30,80}$/
const BAD_KEY = 'That confirmation key is not valid. Ask for the change again to get a new preview.'

type Row = {
  id: string
  user_id: string
  grant_id: string | null
  tool: string
  args: unknown
  args_hash: string
  preview_hash: string
  status: 'pending' | 'applying' | 'applied' | 'failed' | 'expired' | 'cancelled'
  expires_at: string
  result: ChangeOutcome | null
}
const COLS = 'id, user_id, grant_id, tool, args, args_hash, preview_hash, status, expires_at, result'

/** Same text, same hash: the preview is hashed so confirm can tell whether the world changed under it. */
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
    records: p.links.map((l) => ({ label: wrapUntrusted(l.label, 120), page: l.path })),
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
  if ((count ?? 0) >= MAX_PENDING_CHANGES) throw new ToolError('bad_input', 'There are too many changes waiting for a yes. Confirm or drop some first (they expire in 10 minutes).', 'too_many_pending')

  // Permission, validity and the exact preview. Writes nothing.
  const preview = await tool.write.prepare(ctx, args)

  const token = randomToken(CONFIRM_PREFIX, 24)
  const { error } = await db.from('ai_changes').insert({
    user_id: ctx.userId,
    grant_id: ctx.grantId ?? null,
    client_id: ctx.clientId ?? null,
    tool: tool.name,
    token_hash: sha256Hex(token),
    args: args as object,
    args_hash: hashArgs(args),
    preview,
    preview_hash: previewHash(preview),
    status: 'pending',
    expires_at: new Date(nowOf(ctx) + CHANGE_TTL_SECONDS * 1000).toISOString(),
  })
  // Fails closed (nothing to confirm) until migration 202611150070 is applied.
  if (error) {
    console.error('[ai-connector] could not store a proposed change', error.message)
    throw new ToolError('unavailable', 'Changes are not available right now. Nothing was saved.', 'store_failed')
  }
  if (Math.random() < 0.05) void ctx.admin.rpc('ai_prune_changes', { p_days: PENDING_CHANGE_KEEP_DAYS }).then(() => undefined, () => undefined)

  return {
    data: {
      status: 'preview_only_nothing_saved',
      preview: previewForAi(preview),
      confirm_key: token,
      expires_in_seconds: CHANGE_TTL_SECONDS,
      next_step: 'Nothing has been saved. Show this preview to the person in plain words. ONLY if they clearly say yes, call confirm_change with confirm_key. If they want something different, ask for a new preview instead.',
    },
    recordIds: preview.recordIds,
  }
}

async function setStatus(ctx: ToolContext, id: string, from: Row['status'], patch: Record<string, unknown>): Promise<boolean> {
  const { data } = await orgDb(ctx.admin, ctx.orgId).from('ai_changes').update(patch).eq('id', id).eq('status', from).select('id')
  return Array.isArray(data) && data.length > 0
}

export async function confirmChange(ctx: ToolContext, token: string, lookup: (name: string) => (McpTool & { write?: WriteSpec<never> }) | undefined): Promise<ToolResult> {
  assertWritesAllowed(ctx)
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) throw new ToolError('denied', BAD_KEY, 'bad_key')

  const db = orgDb(ctx.admin, ctx.orgId)
  const { data } = await db.from('ai_changes').select(COLS).eq('token_hash', sha256Hex(token)).maybeSingle()
  const row = data as Row | null
  // Another company's key, another person's key, another connection's key: all the same answer.
  if (!row || row.user_id !== ctx.userId || !row.grant_id || row.grant_id !== ctx.grantId) throw new ToolError('denied', BAD_KEY, row ? 'key_not_yours' : 'key_unknown')

  // A confirmed key shown again: the first result, nothing written twice.
  if (row.status === 'applied') return { data: { status: 'saved', already_saved: true, ...(row.result ? { summary: row.result.summary, records: row.result.links } : {}) }, recordIds: row.result?.recordIds ?? [] }
  if (row.status === 'applying') throw new ToolError('bad_input', 'This change is being saved right now. Check the record in a moment before asking again.', 'in_progress')
  if (row.status !== 'pending') throw new ToolError('bad_input', 'This change was not saved and the key is used up. Ask for the change again to get a new preview.', `status_${row.status}`)
  if (new Date(row.expires_at).getTime() <= nowOf(ctx)) {
    await setStatus(ctx, row.id, 'pending', { status: 'expired' })
    throw new ToolError('bad_input', 'That confirmation expired (10 minutes). Ask for the change again to get a new preview.', 'expired')
  }

  const tool = lookup(row.tool)
  if (!tool || !tool.write) throw new ToolError('denied', BAD_KEY, 'tool_unknown')
  const spec = tool.write as WriteSpec<unknown>
  // The row must still say exactly what was previewed.
  if (hashArgs(row.args) !== row.args_hash) {
    await setStatus(ctx, row.id, 'pending', { status: 'cancelled', error: 'args_changed' })
    throw new ToolError('denied', 'This change no longer matches what was previewed, so it was not saved. Ask for it again.', 'args_changed')
  }
  const parsed = tool.schema.safeParse(row.args)
  if (!parsed.success) {
    await setStatus(ctx, row.id, 'pending', { status: 'cancelled', error: 'args_invalid' })
    throw new ToolError('bad_input', 'This change is no longer valid. Ask for it again.', 'args_invalid')
  }

  const rate = ctx.rate ?? dbRateGate(ctx.admin, ctx.now)
  for (const [key, limit, secs] of [
    [`mcp:write-confirm:user:${ctx.userId}`, RATE_LIMITS.writeConfirmPerMinute, 60],
    [`mcp:write-confirm-day:user:${ctx.userId}`, RATE_LIMITS.writeConfirmPerDay, 86_400],
    [`mcp:write-confirm-day:org:${ctx.orgId}`, RATE_LIMITS.orgWriteConfirmPerDay, 86_400],
  ] as const) {
    const r = await rate(key, limit, secs)
    if (!r.ok) throw new ToolError('unavailable', 'Too many changes saved lately. Try again later.', 'rate_limited')
  }

  // The person's permission and the facts are checked AGAIN now, and must still match the preview they saw.
  let fresh: ChangePreview
  try {
    fresh = await spec.prepare(ctx, parsed.data)
  } catch (e) {
    if (e instanceof ToolError) await setStatus(ctx, row.id, 'pending', { status: 'cancelled', error: e.reason ?? e.code })
    throw e
  }
  if (previewHash(fresh) !== row.preview_hash) {
    await setStatus(ctx, row.id, 'pending', { status: 'cancelled', error: 'changed_since_preview' })
    throw new ToolError('bad_input', 'Something changed since the preview, so nothing was saved. Ask for the change again to see the new preview.', 'changed_since_preview')
  }

  // Exactly one caller wins the claim.
  const claimed = await setStatus(ctx, row.id, 'pending', { status: 'applying', confirmed_at: new Date(nowOf(ctx)).toISOString() })
  if (!claimed) throw new ToolError('bad_input', 'This change was just confirmed by another request. Check the record before asking again.', 'lost_claim')

  let outcome: ChangeOutcome
  try {
    outcome = await spec.apply(ctx, parsed.data, row.id)
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : 'Could not save'
    await setStatus(ctx, row.id, 'applying', { status: 'failed', error: msg.slice(0, 300), finished_at: new Date(nowOf(ctx)).toISOString() })
    if (e instanceof ToolError) throw new ToolError(e.code === 'denied' || e.code === 'not_found' ? e.code : 'bad_input', `Not saved. ${e.message} Ask for the change again.`, e.reason ?? e.code)
    console.error('[ai-connector] change failed', row.tool, e)
    throw new ToolError('unavailable', 'Not saved. Something went wrong; check the record and ask again if needed.', 'apply_failed')
  }
  const done = await setStatus(ctx, row.id, 'applying', { status: 'applied', result: outcome, record_ids: outcome.recordIds.slice(0, 50), finished_at: new Date(nowOf(ctx)).toISOString() })
  if (!done) console.error('[ai-connector] change saved but its row could not be closed', row.id)
  // A permanent line in the audit log that names the change (the call itself is audited by the endpoint as `confirm_change`).
  await writeAudit(ctx.admin, { orgId: ctx.orgId, userId: ctx.userId, clientId: ctx.clientId ?? null, tool: `change.${row.tool}`, recordIds: outcome.recordIds, result: 'ok', detail: row.id })
  return { data: { status: 'saved', summary: outcome.summary, records: outcome.links }, recordIds: outcome.recordIds }
}

/** Wraps a `prepare`/`apply` pair as a normal tool: its `run` is "propose". Saving is only ever `confirm_change`. */
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
    description: `${def.description} This only PREPARES the change and returns a preview and a confirm_key; nothing is saved until the person says yes and you call confirm_change.`,
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
