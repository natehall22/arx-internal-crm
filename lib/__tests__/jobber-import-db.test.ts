/**
 * Move from Jobber end to end on the in-memory database (lib/test-helpers/fake-db.ts): upload → check → import, a second
 * import of the same files, then "Undo" of the SECOND import — the first import's rows must all still be there (an
 * unchanged row is not the second run's to delete). The SQL functions are stood in for here; their real rules run in
 * supabase/tests/jobber_import.test.sql.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { addFile, checkRun, importBatch, loadRun, openRun, startImport, startUndo, undoBatch } from '@/lib/jobber-import/db'

type Row = Record<string, unknown>
const ORG = '00000000-0000-0000-0000-0000000000a1'
const USER = '00000000-0000-0000-0000-0000000000u1'

const PRODUCTS = 'Name,Description,Unit Price,Unit cost,Taxable,Category,Active\nWeekly mowing,Mow,45,18,false,Service,true\n'
const INVOICES =
  'Invoice #,Client name,Client email,Subject,Issued date,Due date,Status,Line items,Total ($),Balance ($),Tax amount ($)\n' +
  '1042,Jane Smith,jane@example.com,Mowing,11/01/2025,11/15/2025,Awaiting Payment,"Weekly mowing (4, $180.00)",$180.00,$80.00,$0.00\n'

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || (typeof a !== 'object' && Number(a) === Number(b) && a !== '' && b !== '')

function world(seed: Record<string, Row[]> = {}) {
  return createFakeDb(
    {
      orgs: [{ id: ORG, timezone: 'America/New_York', settings: {} }],
      users: [{ id: USER, org_id: ORG, role: 'admin', is_super_admin: true, active: true }],
      pricebooks: [{ id: 'pb-1', org_id: ORG, name: 'Price book', is_default: true }],
      customers: [],
      job_invoices: [],
      job_invoice_items: [],
      pricebook_items: [],
      import_runs: [],
      import_run_files: [],
      import_run_items: [],
      ...seed,
    },
    {
      rpc: {
        property_address_keys: (a) => (a.p as string[]).map((x) => x.toLowerCase()),
        import_run_claim: (a, t) => {
          const mine = t.import_run_items.filter((i) => i.org_id === a.p_org && i.run_id === a.p_run)
          const pending = mine.filter((i) => i.status === 'pending')
          if (!pending.length) return []
          const rank = Math.min(...pending.map((i) => Number(i.rank)))
          if (mine.some((i) => i.status === 'working' && Number(i.rank) < rank)) return []
          const take = pending.filter((i) => i.rank === rank).sort((x, y) => Number(x.seq) - Number(y.seq)).slice(0, Number(a.p_limit))
          for (const i of take) Object.assign(i, { status: 'working', claimed_at: new Date().toISOString() })
          return take.map((i) => ({ ...i }))
        },
        import_undo_row: (a, t) => {
          const rows = t[a.p_table as string] ?? []
          const row = rows.find((r) => r.id === a.p_id && r.org_id === a.p_org)
          if (!row) return 'gone'
          for (const [k, v] of Object.entries((a.p_applied as Row) ?? {})) if (!same(row[k], v)) return 'changed'
          const refs: Record<string, Array<[string, string]>> = { customers: [['job_invoices', 'customer_id'], ['properties', 'customer_id']], job_invoices: [['invoice_payments', 'invoice_id']] }
          for (const [tb, col] of refs[a.p_table as string] ?? []) if ((t[tb] ?? []).some((r) => r[col] === a.p_id)) return 'in_use'
          t[a.p_table as string] = rows.filter((r) => r !== row)
          if (a.p_table === 'job_invoices') t.job_invoice_items = t.job_invoice_items.filter((r) => r.invoice_id !== a.p_id)
          return 'deleted'
        },
        import_revert_row: (a, t) => {
          const row = (t[a.p_table as string] ?? []).find((r) => r.id === a.p_id && r.org_id === a.p_org)
          if (!row) return 'gone'
          for (const [k, v] of Object.entries((a.p_applied as Row) ?? {})) if (!same(row[k], v)) return 'changed'
          for (const [k, v] of Object.entries((a.p_before as Row) ?? {})) if (k !== 'id' && k !== 'org_id' && k in (a.p_applied as Row)) row[k] = v
          return 'reverted'
        },
      },
    }
  )
}

async function runImport(db: ReturnType<typeof world>) {
  const admin = db.client as never
  const opened = await openRun(admin, ORG, USER)
  if (!opened.ok) throw new Error(opened.error)
  let run = opened.run
  for (const [name, text] of [['products.csv', PRODUCTS], ['invoices.csv', INVOICES]]) {
    const r = await addFile(admin, ORG, run, name, text)
    if (!r.ok) throw new Error(r.error)
  }
  for (let i = 0; i < 20; i++) {
    run = (await loadRun(admin, ORG, run.id))!
    const c = await checkRun(admin, ORG, run)
    if (!c.ok) throw new Error(c.error)
    if (c.done) break
  }
  run = (await loadRun(admin, ORG, run.id))!
  const s = await startImport(admin, ORG, run)
  if (!s.ok) throw new Error(s.error)
  for (let i = 0; i < 20; i++) {
    run = (await loadRun(admin, ORG, run.id))!
    const b = await importBatch(admin, ORG, USER, run)
    if (!b.ok) throw new Error(b.error)
    if (b.finished) break
  }
  return (await loadRun(admin, ORG, run.id))!
}

describe('Move from Jobber — import, re-run, undo', () => {
  it('first import makes the rows; paid in Jobber is paid_outside, never a payment', async () => {
    const db = world()
    const run = await runImport(db)
    expect(run.status).toBe('done')
    expect(db.tables.customers).toHaveLength(1)
    expect(db.tables.pricebook_items).toHaveLength(1)
    expect(db.tables.job_invoices).toHaveLength(1)
    expect(db.tables.job_invoices[0]).toMatchObject({ invoice_number: '1042', status: 'partially_paid', total_cents: 18000, paid_outside_cents: 10000, import_source_id: 'invoice:1042' })
    expect(db.tables.job_payments ?? []).toHaveLength(0)
  })

  it('a second import of the same files changes nothing and its undo leaves the first import intact', async () => {
    const db = world()
    await runImport(db)
    const before = JSON.stringify({ c: db.tables.customers, p: db.tables.pricebook_items, i: db.tables.job_invoices, items: db.tables.job_invoice_items })
    const second = await runImport(db)
    expect(db.tables.customers).toHaveLength(1)
    expect(db.tables.job_invoices).toHaveLength(1)
    const admin = db.client as never
    const u = await startUndo(admin, ORG, second)
    expect(u.ok).toBe(true)
    let r = (await loadRun(admin, ORG, second.id))!
    for (let i = 0; i < 10; i++) {
      const b = await undoBatch(admin, ORG, r)
      if (!b.ok) throw new Error(b.error)
      if (b.finished) break
      r = (await loadRun(admin, ORG, second.id))!
    }
    expect(JSON.stringify({ c: db.tables.customers, p: db.tables.pricebook_items, i: db.tables.job_invoices, items: db.tables.job_invoice_items })).toBe(before)
  })

  it('an invoice renamed J-<n> (your number was taken) stays J-<n> on a re-run', async () => {
    const db = world({ job_invoices: [{ id: 'mine', org_id: ORG, invoice_number: '1042', status: 'sent', total_cents: 5 }] })
    await runImport(db)
    const imported = () => db.tables.job_invoices.find((i) => i.import_source_id === 'invoice:1042')!
    expect(imported().invoice_number).toBe('J-1042')
    await runImport(db)
    expect(imported().invoice_number).toBe('J-1042')
    expect(db.tables.job_invoices.filter((i) => i.import_source_id === 'invoice:1042')).toHaveLength(1)
  })

  it('undo of the only import removes what it made', async () => {
    const db = world()
    const run = await runImport(db)
    const admin = db.client as never
    await startUndo(admin, ORG, run)
    let r = (await loadRun(admin, ORG, run.id))!
    for (let i = 0; i < 10; i++) {
      const b = await undoBatch(admin, ORG, r)
      if (!b.ok) throw new Error(b.error)
      if (b.finished) break
      r = (await loadRun(admin, ORG, run.id))!
    }
    expect(db.tables.customers).toHaveLength(0)
    expect(db.tables.job_invoices).toHaveLength(0)
    expect(db.tables.pricebook_items).toHaveLength(0)
  })
})
