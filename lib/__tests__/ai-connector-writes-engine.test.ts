/** @jest-environment node */
/**
 * AI connector phase 2 — the preview + PERSON-approval engine: the AI's proposal saves nothing and hands back no key; only the
 * signed-in person's Approve (same person, once, within 10 minutes, row untouched, preview still true, permission re-checked,
 * connection still live) saves. The AI-side status tool only reports.
 */
import { randomUUID } from 'crypto'

import { z } from 'zod'

import { approveChange, checkChange, declineChange, loadChangeForReview, previewHash, writeTool } from '@/lib/ai-connector/changes'
import { confirmChangeTool } from '@/lib/ai-connector/tools/confirm'
import { MCP_TOOLS } from '@/lib/ai-connector/tools'
import { ToolError, type ChangePreview, type McpTool, type ToolContext } from '@/lib/ai-connector/tools/types'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = 'org-a'
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0)

let world = { value: 'one' }
let applied: string[] = []
let allow = true
let applyFails = false
let appliedWith: string[] = []

const tool = writeTool({
  name: 'test_change',
  title: 'Test',
  description: 'Test change.',
  inputSchema: { type: 'object' },
  schema: z.object({ n: z.number() }).strict(),
  write: {
    idempotent: true,
    async prepare(_ctx, a): Promise<ChangePreview> {
      if (!allow) throw new ToolError('denied', 'no', 'no_permission')
      return { title: 'Test', lines: [{ label: 'n', value: `${a.n} ${world.value}` }], links: [{ label: 'x', path: '/x' }], recordIds: ['rec'] }
    },
    async apply(ctx, a, changeId) {
      appliedWith.push(`${changeId}|${ctx.clientName ?? ''}`)
      if (applyFails) throw new ToolError('bad_input', 'writer said no')
      applied.push(`n=${a.n}`)
      return { summary: 'done', links: [], recordIds: ['rec'] }
    },
  },
})
const lookup = (n: string) => (n === 'test_change' ? (tool as McpTool & { write: never }) : undefined)

function setup(over: Partial<ToolContext> = {}) {
  const db = createFakeDb({
    users: [{ id: 'u1', org_id: ORG }],
    ai_oauth_grants: [{ id: 'g1', org_id: ORG, user_id: 'u1', revoked_at: null }],
    ai_oauth_clients: [{ client_id: 'aic_1', client_name: 'Claude <b>x</b>' }],
  }, { idFactory: () => randomUUID() })
  // The AI's connection context, and the PERSON's own session context (no grant on it).
  const ai: ToolContext = { admin: db.client, profile: { id: 'u1', org_id: ORG } as never, userId: 'u1', orgId: ORG, grantId: 'g1', clientId: 'aic_1', origin: 'https://acme.crm.test', writesAllowed: true, rate: async () => ({ ok: true }), now: T0, ...over }
  const me: ToolContext = { admin: db.client, profile: { id: 'u1', org_id: ORG } as never, userId: 'u1', orgId: ORG, writesAllowed: true, rate: async () => ({ ok: true }), now: T0 + 1000 }
  return { db, ai, me, ctx: ai }
}
const propose = async (ctx: ToolContext, n = 1) => {
  const out = await tool.run(ctx, { n } as never)
  return out.data as { change_id: string; review_link: string; status: string; preview: { changes: Array<{ value: string }> } }
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
  appliedWith = []
  allow = true
  applyFails = false
})

describe('proposing (the AI side)', () => {
  it('saves nothing but a pending row; the AI gets a preview and a link, NEVER a key; text is fenced', async () => {
    const { db, ai } = setup()
    const p = await propose(ai)
    expect(applied).toEqual([])
    expect(p.status).toBe('waiting_for_the_person_to_approve_nothing_saved')
    expect(p.review_link).toBe(`https://acme.crm.test/ai-changes/${p.change_id}`)
    expect(JSON.stringify(p)).not.toMatch(/confirm_key|acf_|token/)
    expect(p.preview.changes[0].value).toContain('<untrusted_data>')
    const rows = db.tables.ai_changes
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'pending', user_id: 'u1', grant_id: 'g1', tool: 'test_change', org_id: ORG })
    expect(rows[0]).not.toHaveProperty('token_hash')
    expect(new Date(rows[0].expires_at as string).getTime()).toBe(T0 + 600_000)
  })
  it('refuses without crm:write / the company switch (writesAllowed false), before anything is stored', async () => {
    const { db, ai } = setup({ writesAllowed: false })
    expect(await code(tool.run(ai, { n: 1 } as never))).toBe('writes_off')
    expect(db.tables.ai_changes ?? []).toHaveLength(0)
  })
  it('a refused permission stores nothing', async () => {
    const { db, ai } = setup()
    allow = false
    expect(await code(tool.run(ai, { n: 1 } as never))).toBe('no_permission')
    expect(db.tables.ai_changes ?? []).toHaveLength(0)
  })
  it('is rate limited, and holds at most 20 waiting proposals', async () => {
    const limited = setup({ rate: async () => ({ ok: false, retryAfterSec: 5 }) })
    expect(await code(tool.run(limited.ai, { n: 1 } as never))).toBe('rate_limited')
    const { ai } = setup()
    for (let i = 0; i < 20; i++) await propose(ai, i)
    expect(await code(tool.run(ai, { n: 99 } as never))).toBe('too_many_pending')
  })
})

describe('the AI cannot apply anything (injection)', () => {
  it('no tool the AI can call saves a proposal: confirm_change only reports, whatever it is given', async () => {
    const { db, ai } = setup()
    const p = await propose(ai)
    for (const arg of [{ change_id: p.change_id }, { change_id: p.change_id, confirm: true }, { confirm_key: 'acf_' + 'x'.repeat(40) }]) {
      const parsed = confirmChangeTool.schema.safeParse(arg)
      if (parsed.success) {
        const out = await confirmChangeTool.run(ai, parsed.data as never)
        expect(out.data.status).toBe('waiting_for_the_person_to_approve')
      }
    }
    expect(applied).toEqual([])
    expect(db.tables.ai_changes[0].status).toBe('pending')
    expect(confirmChangeTool.readOnly).toBe(true)
  })
  it('the AI side exposes no function that approves: only the person-side functions can, and they need a session context', () => {
    expect(MCP_TOOLS.map((t) => t.name)).toContain('confirm_change')
    for (const t of MCP_TOOLS) expect(JSON.stringify(t.inputSchema)).not.toMatch(/confirm_key|approve/i)
  })
  it('no confirm key or token appears anywhere in what the AI is told, even after the person approves', async () => {
    const { ai, me } = setup()
    const p = await propose(ai)
    await approveChange(me, p.change_id, lookup)
    const status = await checkChange(ai, p.change_id)
    expect(JSON.stringify([p, status])).not.toMatch(/confirm_key|acf_/)
    expect(status.data.status).toBe('saved')
  })
})

describe('status check (confirm_change)', () => {
  it('reports pending / saved / declined / expired and only for the same person on the same connection', async () => {
    const { ai, me } = setup()
    const a = await propose(ai, 1)
    expect((await checkChange(ai, a.change_id)).data).toMatchObject({ status: 'waiting_for_the_person_to_approve' })
    await approveChange(me, a.change_id, lookup)
    expect((await checkChange(ai, a.change_id)).data).toMatchObject({ status: 'saved', summary: 'done' })
    const b = await propose(ai, 2)
    await declineChange(me, b.change_id)
    expect((await checkChange(ai, b.change_id)).data).toMatchObject({ status: 'declined_by_the_person' })
    const c = await propose(ai, 3)
    expect((await checkChange({ ...ai, now: T0 + 601_000 }, c.change_id)).data).toMatchObject({ status: 'expired_not_saved' })
    expect(await code(checkChange({ ...ai, userId: 'u2' }, c.change_id))).toBe('not_yours')
    expect(await code(checkChange({ ...ai, grantId: 'g2' }, c.change_id))).toBe('not_yours')
    expect(await code(checkChange({ ...ai, orgId: 'org-b' }, c.change_id))).toBe('unknown')
    expect(await code(checkChange(ai, 'nonsense'))).toBe('bad_id')
  })
})

describe('the person approves (CRM session)', () => {
  it('saves exactly once; approving again returns the first result and writes nothing more; the audit names the change', async () => {
    const { db, ai, me } = setup()
    const { change_id } = await propose(ai, 7)
    const first = await approveChange(me, change_id, lookup)
    expect(first.data).toMatchObject({ status: 'saved', summary: 'done' })
    expect(applied).toEqual(['n=7'])
    const again = await approveChange(me, change_id, lookup)
    expect(again.data).toMatchObject({ status: 'saved', already_saved: true })
    expect(applied).toEqual(['n=7'])
    expect(db.tables.ai_changes[0].status).toBe('applied')
    expect((db.tables.ai_audit_log ?? []).some((r) => r.tool === 'change.test_change' && r.result === 'ok')).toBe(true)
  })
  it('the writer is told the AI app name (cleaned, no tags) and the change id', async () => {
    const { ai, me } = setup()
    const { change_id } = await propose(ai)
    await approveChange(me, change_id, lookup)
    expect(appliedWith).toEqual([`${change_id}|Claude x`])
  })
  it('two clicks racing: one wins, the writer runs once', async () => {
    const { ai, me } = setup()
    const { change_id } = await propose(ai)
    const r = await Promise.all([code(approveChange(me, change_id, lookup)), code(approveChange(me, change_id, lookup))])
    expect(applied).toHaveLength(1)
    expect(r.filter((x) => x === 'ok').length).toBeGreaterThanOrEqual(1)
  })
  it('refused when the company switch is off', async () => {
    const { ai, me } = setup()
    const { change_id } = await propose(ai)
    expect(await code(approveChange({ ...me, writesAllowed: false }, change_id, lookup))).toBe('writes_off')
    expect(applied).toEqual([])
  })
  it('expired after 10 minutes: refused, never applied', async () => {
    const { ai, me } = setup()
    const { change_id } = await propose(ai)
    expect(await code(approveChange({ ...me, now: T0 + 601_000 }, change_id, lookup))).toBe('expired')
    expect(await code(approveChange({ ...me, now: T0 + 1000 }, change_id, lookup))).toBe('status_expired')
    expect(applied).toEqual([])
  })
  it('another person, another company, garbage: the same answer, nothing applied; the owner of it can still approve', async () => {
    const { db, ai, me } = setup()
    const { change_id } = await propose(ai)
    expect(await code(approveChange({ ...me, userId: 'u2' }, change_id, lookup))).toBe('not_yours')
    expect(await code(approveChange({ ...me, orgId: 'org-b' }, change_id, lookup))).toBe('unknown')
    expect(await code(approveChange(me, 'nonsense', lookup))).toBe('bad_id')
    expect(await code(approveChange(me, '11111111-1111-1111-1111-111111111111', lookup))).toBe('unknown')
    expect(applied).toEqual([])
    expect(db.tables.ai_changes[0].status).toBe('pending')
    expect((await approveChange(me, change_id, lookup)).data).toMatchObject({ status: 'saved' })
    // refusals are audited
    expect((db.tables.ai_audit_log ?? []).some((r) => r.tool === 'change.refused')).toBe(true)
  })
  it('the AI app was disconnected (grant revoked or gone): cancelled, not saved', async () => {
    const { db, ai, me } = setup()
    const a = await propose(ai)
    db.tables.ai_oauth_grants[0].revoked_at = new Date(T0).toISOString()
    expect(await code(approveChange(me, a.change_id, lookup))).toBe('connection_ended')
    const b = await propose(ai)
    db.tables.ai_changes[1].grant_id = null
    expect(await code(approveChange(me, b.change_id, lookup))).toBe('connection_ended')
    expect(applied).toEqual([])
  })
  it('arguments changed after the preview (row tampered): refused and cancelled', async () => {
    const { db, ai, me } = setup()
    const { change_id } = await propose(ai, 1)
    db.tables.ai_changes[0].args = { n: 999 }
    expect(await code(approveChange(me, change_id, lookup))).toBe('args_changed')
    expect(applied).toEqual([])
    expect(db.tables.ai_changes[0].status).toBe('cancelled')
  })
  it('each proposal is its own: approving one does not apply another', async () => {
    const { ai, me } = setup()
    const a = await propose(ai, 1)
    const b = await propose(ai, 2)
    await approveChange(me, a.change_id, lookup)
    expect(applied).toEqual(['n=1'])
    await approveChange(me, b.change_id, lookup)
    expect(applied).toEqual(['n=1', 'n=2'])
  })
  it('the world changed since the preview: nothing saved, ask again', async () => {
    const { ai, me } = setup()
    const { change_id } = await propose(ai)
    world.value = 'two'
    expect(await code(approveChange(me, change_id, lookup))).toBe('changed_since_preview')
    expect(applied).toEqual([])
  })
  it('permission taken away between preview and approval: refused', async () => {
    const { ai, me } = setup()
    const { change_id } = await propose(ai)
    allow = false
    expect(await code(approveChange(me, change_id, lookup))).toBe('no_permission')
    expect(applied).toEqual([])
  })
  it('a writer that refuses: not saved, used up, never retried on its own', async () => {
    const { db, ai, me } = setup()
    const { change_id } = await propose(ai)
    applyFails = true
    expect(await code(approveChange(me, change_id, lookup))).toBe('bad_input')
    expect(db.tables.ai_changes[0].status).toBe('failed')
    applyFails = false
    expect(await code(approveChange(me, change_id, lookup))).toBe('status_failed')
    expect(applied).toEqual([])
  })
  it('is rate limited', async () => {
    const { ai, me } = setup()
    const { change_id } = await propose(ai)
    expect(await code(approveChange({ ...me, rate: async () => ({ ok: false, retryAfterSec: 9 }) }, change_id, lookup))).toBe('rate_limited')
    expect(applied).toEqual([])
  })
})

describe('declining + review page data', () => {
  it('decline writes nothing, is audited, and cannot be approved afterwards', async () => {
    const { db, ai, me } = setup()
    const { change_id } = await propose(ai)
    await declineChange(me, change_id)
    expect(db.tables.ai_changes[0].status).toBe('declined')
    expect(await code(approveChange(me, change_id, lookup))).toBe('status_declined')
    expect(applied).toEqual([])
    expect((db.tables.ai_audit_log ?? []).some((r) => r.tool === 'change.declined')).toBe(true)
  })
  it('only the person it was prepared for can open it', async () => {
    const { ai, me } = setup()
    const { change_id } = await propose(ai)
    expect((await loadChangeForReview(me, change_id)).row.id).toBe(change_id)
    expect(await code(loadChangeForReview({ ...me, userId: 'someone-else' }, change_id))).toBe('not_yours')
  })
})

describe('stuck saves', () => {
  it('a note-style (idempotent) save stuck in `applying` is retried ONCE after the timeout, with the same change id', async () => {
    const { db, ai, me } = setup()
    const { change_id } = await propose(ai)
    Object.assign(db.tables.ai_changes[0], { status: 'applying', confirmed_at: new Date(T0).toISOString(), attempts: 1 })
    expect(await code(approveChange({ ...me, now: T0 + 30_000 }, change_id, lookup))).toBe('in_progress')
    expect(applied).toEqual([])
    const out = await approveChange({ ...me, now: T0 + 200_000 }, change_id, lookup)
    expect(out.data).toMatchObject({ status: 'saved' })
    expect(applied).toEqual(['n=1'])
    expect(db.tables.ai_changes[0]).toMatchObject({ status: 'applied', attempts: 2 })
  })
  it('after the one retry it is not retried again, and a non-idempotent writer is never retried (owner screen flags it)', async () => {
    const { db, ai, me } = setup()
    const { change_id } = await propose(ai)
    Object.assign(db.tables.ai_changes[0], { status: 'applying', confirmed_at: new Date(T0).toISOString(), attempts: 2 })
    expect(await code(approveChange({ ...me, now: T0 + 200_000 }, change_id, lookup))).toBe('in_progress')
    const plain = { ...tool, write: { ...tool.write, idempotent: false } }
    Object.assign(db.tables.ai_changes[0], { attempts: 1 })
    expect(await code(approveChange({ ...me, now: T0 + 200_000 }, change_id, (n) => (n === 'test_change' ? (plain as never) : undefined)))).toBe('in_progress')
    expect(applied).toEqual([])
  })
})

it('the preview hash ignores nothing that the person saw', () => {
  const a: ChangePreview = { title: 't', lines: [{ label: 'a', value: '1' }], links: [], recordIds: [] }
  expect(previewHash(a)).toBe(previewHash({ ...a }))
  expect(previewHash(a)).not.toBe(previewHash({ ...a, lines: [{ label: 'a', value: '2' }] }))
  expect(previewHash(a)).not.toBe(previewHash({ ...a, warnings: ['x'] }))
})
