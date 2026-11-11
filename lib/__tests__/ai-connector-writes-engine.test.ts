/** @jest-environment node */
/**
 * AI connector phase 2 — the preview + confirm engine: nothing is saved by a proposal; a confirm key works once, for the
 * same person on the same connection, within 10 minutes, only while the row is untouched and the preview is still true.
 */
import { z } from 'zod'

import { confirmChange, previewHash, writeTool } from '@/lib/ai-connector/changes'
import { sha256Hex } from '@/lib/ai-connector/crypto'
import { ToolError, type ChangePreview, type McpTool, type ToolContext } from '@/lib/ai-connector/tools/types'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = 'org-a'
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0)

let world = { value: 'one' }
let applied: string[] = []
let allow = true
let applyFails = false

const tool = writeTool({
  name: 'test_change',
  title: 'Test',
  description: 'Test change.',
  inputSchema: { type: 'object' },
  schema: z.object({ n: z.number() }).strict(),
  write: {
    async prepare(_ctx, a): Promise<ChangePreview> {
      if (!allow) throw new ToolError('denied', 'no', 'no_permission')
      return { title: 'Test', lines: [{ label: 'n', value: `${a.n} ${world.value}` }], links: [{ label: 'x', path: '/x' }], recordIds: ['rec'] }
    },
    async apply(_ctx, a) {
      if (applyFails) throw new ToolError('bad_input', 'writer said no')
      applied.push(`n=${a.n}`)
      return { summary: 'done', links: [], recordIds: ['rec'] }
    },
  },
})
const lookup = (n: string) => (n === 'test_change' ? (tool as McpTool & { write: never }) : undefined)

function setup(over: Partial<ToolContext> = {}) {
  const db = createFakeDb({ users: [{ id: 'u1', org_id: ORG }] })
  const ctx: ToolContext = { admin: db.client, profile: { id: 'u1', org_id: ORG } as never, userId: 'u1', orgId: ORG, grantId: 'g1', clientId: 'aic_1', writesAllowed: true, rate: async () => ({ ok: true }), now: T0, ...over }
  return { db, ctx }
}
const propose = async (ctx: ToolContext, n = 1) => {
  const out = await tool.run(ctx, { n } as never)
  return out.data as { confirm_key: string; status: string; preview: { changes: Array<{ value: string }> } }
}
const code = async (p: Promise<unknown>) => {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof ToolError ? (e.reason ?? e.code) : `EXC ${String(e)}`
  }
}

beforeEach(() => {
  world = { value: 'one' }
  applied = []
  allow = true
  applyFails = false
})

describe('proposing', () => {
  it('saves nothing but a pending row; the key is stored only as a hash; text is fenced for the AI', async () => {
    const { db, ctx } = setup()
    const p = await propose(ctx)
    expect(applied).toEqual([])
    expect(p.status).toBe('preview_only_nothing_saved')
    expect(p.preview.changes[0].value).toContain('<untrusted_data>')
    const rows = db.tables.ai_changes
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'pending', user_id: 'u1', grant_id: 'g1', tool: 'test_change', org_id: ORG })
    expect(rows[0].token_hash).toBe(sha256Hex(p.confirm_key))
    expect(JSON.stringify(rows[0])).not.toContain(p.confirm_key)
    expect(new Date(rows[0].expires_at as string).getTime()).toBe(T0 + 600_000)
  })
  it('refuses without crm:write / the company switch (writesAllowed false), before anything is stored', async () => {
    const { db, ctx } = setup({ writesAllowed: false })
    expect(await code(tool.run(ctx, { n: 1 } as never))).toBe('writes_off')
    expect(db.tables.ai_changes ?? []).toHaveLength(0)
  })
  it('a refused permission stores nothing', async () => {
    const { db, ctx } = setup()
    allow = false
    expect(await code(tool.run(ctx, { n: 1 } as never))).toBe('no_permission')
    expect(db.tables.ai_changes ?? []).toHaveLength(0)
  })
  it('is rate limited, and holds at most 20 unconfirmed proposals', async () => {
    const limited = setup({ rate: async () => ({ ok: false, retryAfterSec: 5 }) })
    expect(await code(tool.run(limited.ctx, { n: 1 } as never))).toBe('rate_limited')
    const { ctx } = setup()
    for (let i = 0; i < 20; i++) await propose(ctx, i)
    expect(await code(tool.run(ctx, { n: 99 } as never))).toBe('too_many_pending')
  })
})

describe('confirming', () => {
  it('saves exactly once; the same key again returns the first result and writes nothing more', async () => {
    const { db, ctx } = setup()
    const { confirm_key } = await propose(ctx, 7)
    const first = await confirmChange(ctx, confirm_key, lookup)
    expect(first.data).toMatchObject({ status: 'saved', summary: 'done' })
    expect(applied).toEqual(['n=7'])
    const again = await confirmChange(ctx, confirm_key, lookup)
    expect(again.data).toMatchObject({ status: 'saved', already_saved: true })
    expect(applied).toEqual(['n=7'])
    expect(db.tables.ai_changes[0].status).toBe('applied')
    // the permanent audit line names the change
    expect((db.tables.ai_audit_log ?? []).some((r) => r.tool === 'change.test_change' && r.result === 'ok')).toBe(true)
  })
  it('two confirms racing: one wins, the writer runs once', async () => {
    const { ctx } = setup()
    const { confirm_key } = await propose(ctx)
    const r = await Promise.all([code(confirmChange(ctx, confirm_key, lookup)), code(confirmChange(ctx, confirm_key, lookup))])
    expect(applied).toHaveLength(1)
    expect(r.filter((x) => x === 'ok').length).toBeGreaterThanOrEqual(1)
  })
  it('refuses without writes allowed', async () => {
    const { ctx } = setup()
    const { confirm_key } = await propose(ctx)
    expect(await code(confirmChange({ ...ctx, writesAllowed: false }, confirm_key, lookup))).toBe('writes_off')
    expect(applied).toEqual([])
  })
  it('expired after 10 minutes: refused, never applied, and the key stays dead', async () => {
    const { ctx } = setup()
    const { confirm_key } = await propose(ctx)
    const late = { ...ctx, now: T0 + 601_000 }
    expect(await code(confirmChange(late, confirm_key, lookup))).toBe('expired')
    expect(await code(confirmChange({ ...ctx, now: T0 + 1000 }, confirm_key, lookup))).toBe('status_expired')
    expect(applied).toEqual([])
  })
  it('another person, another connection, another company, garbage: one answer, nothing applied', async () => {
    const { db, ctx } = setup()
    const { confirm_key } = await propose(ctx)
    expect(await code(confirmChange({ ...ctx, userId: 'u2' }, confirm_key, lookup))).toBe('key_not_yours')
    expect(await code(confirmChange({ ...ctx, grantId: 'g2' }, confirm_key, lookup))).toBe('key_not_yours')
    expect(await code(confirmChange({ ...ctx, orgId: 'org-b' }, confirm_key, lookup))).toBe('key_unknown')
    expect(await code(confirmChange(ctx, 'acf_' + 'x'.repeat(40), lookup))).toBe('key_unknown')
    expect(await code(confirmChange(ctx, 'nonsense', lookup))).toBe('bad_key')
    expect(await code(confirmChange(ctx, sha256Hex(confirm_key), lookup))).toBe('bad_key')
    expect(applied).toEqual([])
    expect(db.tables.ai_changes[0].status).toBe('pending') // still usable by its owner
    expect((await confirmChange(ctx, confirm_key, lookup)).data).toMatchObject({ status: 'saved' })
  })
  it('a connection that was replaced (grant gone) cannot confirm', async () => {
    const { db, ctx } = setup()
    const { confirm_key } = await propose(ctx)
    db.tables.ai_changes[0].grant_id = null
    expect(await code(confirmChange(ctx, confirm_key, lookup))).toBe('key_not_yours')
  })
  it('arguments changed after the preview (row tampered): refused and cancelled', async () => {
    const { db, ctx } = setup()
    const { confirm_key } = await propose(ctx, 1)
    db.tables.ai_changes[0].args = { n: 999 }
    expect(await code(confirmChange(ctx, confirm_key, lookup))).toBe('args_changed')
    expect(applied).toEqual([])
    expect(db.tables.ai_changes[0].status).toBe('cancelled')
  })
  it('a different proposal has its own key: the first key does not apply the second one', async () => {
    const { ctx } = setup()
    const a = await propose(ctx, 1)
    const b = await propose(ctx, 2)
    await confirmChange(ctx, a.confirm_key, lookup)
    expect(applied).toEqual(['n=1'])
    await confirmChange(ctx, b.confirm_key, lookup)
    expect(applied).toEqual(['n=1', 'n=2'])
  })
  it('the world changed since the preview: nothing saved, ask again', async () => {
    const { ctx } = setup()
    const { confirm_key } = await propose(ctx)
    world.value = 'two'
    expect(await code(confirmChange(ctx, confirm_key, lookup))).toBe('changed_since_preview')
    expect(applied).toEqual([])
  })
  it('permission taken away between preview and confirm: refused', async () => {
    const { ctx } = setup()
    const { confirm_key } = await propose(ctx)
    allow = false
    expect(await code(confirmChange(ctx, confirm_key, lookup))).toBe('no_permission')
    expect(applied).toEqual([])
  })
  it('a writer that refuses: not saved, the key is used up and never retried on its own', async () => {
    const { db, ctx } = setup()
    const { confirm_key } = await propose(ctx)
    applyFails = true
    expect(await code(confirmChange(ctx, confirm_key, lookup))).toBe('bad_input')
    expect(db.tables.ai_changes[0].status).toBe('failed')
    applyFails = false
    expect(await code(confirmChange(ctx, confirm_key, lookup))).toBe('status_failed')
    expect(applied).toEqual([])
  })
  it('is rate limited', async () => {
    const { ctx } = setup()
    const { confirm_key } = await propose(ctx)
    expect(await code(confirmChange({ ...ctx, rate: async () => ({ ok: false, retryAfterSec: 9 }) }, confirm_key, lookup))).toBe('rate_limited')
    expect(applied).toEqual([])
  })
})

it('the preview hash ignores nothing that the person saw', () => {
  const a: ChangePreview = { title: 't', lines: [{ label: 'a', value: '1' }], links: [], recordIds: [] }
  expect(previewHash(a)).toBe(previewHash({ ...a }))
  expect(previewHash(a)).not.toBe(previewHash({ ...a, lines: [{ label: 'a', value: '2' }] }))
  expect(previewHash(a)).not.toBe(previewHash({ ...a, warnings: ['x'] }))
})
