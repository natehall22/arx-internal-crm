/** @jest-environment node */
/**
 * Multi-company invoices (migration 202611100040):
 *  - an invoice id resolves only inside the caller's org, through the parent job (findOrgInvoice);
 *  - a payment from another job (another company's included) can't be applied to an invoice;
 *  - every invoice API route + the print page scope through the org before touching an invoice;
 *  - the migration keeps uniqueness on at every step and the storage sweep never touches other buckets.
 */
import fs from 'fs'
import path from 'path'

import { FAKE_PAYMENT_RPC } from '@/lib/test-helpers/fake-payment-rpc'
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { applyPaymentToInvoice, findOrgInvoice } from '@/lib/invoices'

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000000'
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000000'
const ROOT = path.join(__dirname, '..', '..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const relations = { job_invoices: { production_jobs: { table: 'production_jobs', fk: 'job_id' } } }

function seed() {
  return createFakeDb(
    {
      production_jobs: [
        { id: 'job-a', org_id: ORG_A, job_number: '26-0001' },
        { id: 'job-b', org_id: ORG_B, job_number: '26-0001' },
      ],
      job_invoices: [
        { id: 'inv-a', job_id: 'job-a', status: 'sent', total_cents: 10000, invoice_number: 'INV-26-26-0001-001' },
        { id: 'inv-b', job_id: 'job-b', status: 'sent', total_cents: 10000, invoice_number: 'INV-26-26-0001-001' },
      ],
      job_payments: [
        { id: 'pay-a', job_id: 'job-a', amount_cents: 5000 },
        { id: 'pay-b', job_id: 'job-b', amount_cents: 5000 },
      ],
      invoice_payments: [],
    },
    { relations, rpc: FAKE_PAYMENT_RPC }
  )
}

describe('findOrgInvoice', () => {
  it('returns the invoice only to its own org', async () => {
    const db = seed()
    await expect(findOrgInvoice(db.client, 'inv-a', ORG_A)).resolves.toEqual({ id: 'inv-a', job_id: 'job-a', status: 'sent' })
    await expect(findOrgInvoice(db.client, 'inv-a', ORG_B)).resolves.toBeNull()
    await expect(findOrgInvoice(db.client, 'inv-b', ORG_B)).resolves.toEqual({ id: 'inv-b', job_id: 'job-b', status: 'sent' })
    await expect(findOrgInvoice(db.client, 'missing', ORG_A)).resolves.toBeNull()
    await expect(findOrgInvoice(db.client, 'inv-a', '')).resolves.toBeNull()
  })

  it('does not trust a response whose embedded org disagrees', async () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      maybeSingle: async () => ({ data: { id: 'inv-a', job_id: 'job-a', status: 'sent', production_jobs: { org_id: ORG_A } } }),
    }
    await expect(findOrgInvoice({ from: () => chain } as any, 'inv-a', ORG_B)).resolves.toBeNull()
  })
})

describe('applyPaymentToInvoice', () => {
  it("refuses a payment from another job (another company's)", async () => {
    const db = seed()
    await expect(applyPaymentToInvoice(db.client, ORG_A, 'inv-a', 'pay-b', 1000, 'u1')).rejects.toThrow('Payment not found')
    expect(db.tables.invoice_payments).toHaveLength(0)
  })

  it('applies a payment from the same job', async () => {
    const db = seed()
    await applyPaymentToInvoice(db.client, ORG_A, 'inv-a', 'pay-a', 1000, 'u1')
    expect(db.tables.invoice_payments).toEqual([expect.objectContaining({ invoice_id: 'inv-a', job_payment_id: 'pay-a', applied_cents: 1000 })])
  })

  it("another company can't apply to this company's invoice, even with this invoice's own payment", async () => {
    const db = seed()
    await expect(applyPaymentToInvoice(db.client, ORG_B, 'inv-a', 'pay-a', 1000, 'u1')).rejects.toThrow('Invoice not found')
  })

  it('never over-applies: not more than the payment has left, nor the invoice balance (one locked SQL step)', async () => {
    const db = seed()
    db.tables.job_payments.push({ id: 'pay-a2', job_id: 'job-a', amount_cents: 8000 })
    await applyPaymentToInvoice(db.client, ORG_A, 'inv-a', 'pay-a', 5000, 'u1')
    await expect(applyPaymentToInvoice(db.client, ORG_A, 'inv-a', 'pay-a2', 6000, 'u1')).rejects.toThrow('more than the invoice balance')
    await applyPaymentToInvoice(db.client, ORG_A, 'inv-a', 'pay-a2', 5000, 'u1')
    expect(db.tables.job_invoices.find((i) => i.id === 'inv-a')?.status).toBe('paid')
    // the same payment again is a no-op, not a second application
    await applyPaymentToInvoice(db.client, ORG_A, 'inv-a', 'pay-a2', 5000, 'u1')
    expect(db.tables.invoice_payments).toHaveLength(2)
  })
})

describe('invoice routes scope through the org', () => {
  const routes = [
    'app/api/invoices/[invoiceId]/route.ts',
    'app/api/invoices/[invoiceId]/payments/route.ts',
    'app/api/invoices/[invoiceId]/pdf/route.ts',
  ]

  it.each(routes)('%s checks every handler with findOrgInvoice', (r) => {
    const src = read(r)
    const handlers = src.match(/export async function (GET|POST|PATCH|DELETE|PUT)\b/g) ?? []
    const checks = src.match(/findOrgInvoice\(adminClient, params\.invoiceId, profile\.org_id\)/g) ?? []
    expect(handlers.length).toBeGreaterThan(0)
    expect(checks.length).toBe(handlers.length)
    expect(src).not.toMatch(/production_jobs!inner\(org_id\)/)
  })

  it('the print page scopes both lookups (id and invoice_number) to the org and uses requireAuth', () => {
    const src = read('app/invoices/[invoiceId]/print/page.tsx')
    expect(src).toMatch(/findPrintableInvoice\(adminClient, profile\.org_id, params\.invoiceId\)/)
    expect(src).not.toMatch(/from\('job_invoices'\)/)
    expect(src).toMatch(/requireAuth\(\)/)
    expect(src).not.toMatch(/auth\.getUser\(/)
    // The lookups themselves (lib/invoice-document.ts): job invoices through the job, invoices without a job through org_id.
    const lib = read('lib/invoice-document.ts').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(lib.match(/\.eq\('production_jobs\.org_id', orgId\)/g)).toHaveLength(2)
    expect(lib.match(/\.eq\('org_id', orgId\)\.is\('job_id', null\)/g)).toHaveLength(2)
  })

  it('no app code looks an invoice up by invoice_number without an org filter', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(rel); continue }
        if (!/\.(ts|tsx)$/.test(e.name)) continue
        const src = read(rel)
        for (const m of Array.from(src.matchAll(/\.eq\('invoice_number',[^)]*\)([\s\S]{0,200})/g))) {
          if (!/org_id/.test(m[1])) offenders.push(rel)
        }
      }
    }
    for (const d of ['app', 'lib', 'components']) walk(d)
    expect(offenders).toEqual([])
  })
})

describe('migrations', () => {
  const inv = read('supabase/migrations/202611100040_job_invoices_org_scope.sql')
  const files = read('supabase/migrations/202611100050_files_bucket_drop_all_storage_policies.sql')

  it('adds the per-org unique before dropping the global one, and keeps org_id nullable', () => {
    const addUnique = inv.indexOf('create unique index if not exists job_invoices_org_invoice_number_key')
    const dropGlobal = inv.indexOf("execute format('alter table public.job_invoices drop constraint %I'")
    const backfill = inv.indexOf('update public.job_invoices ji')
    expect(backfill).toBeGreaterThan(0)
    expect(addUnique).toBeGreaterThan(backfill)
    expect(dropGlobal).toBeGreaterThan(addUnique)
    expect(inv).toMatch(/add column if not exists org_id uuid references public\.orgs\(id\)/)
    expect(inv).not.toMatch(/set not null/i)
  })

  it("only sweeps policies on the 'files' bucket (Postgres regex mirrors this one)", () => {
    const m = files.match(/qual, ''\) ~ '([^']*(?:''[^']*)*)'/)
    expect(m).not.toBeNull()
    const re = new RegExp(m![1].replace(/''/g, "'"))
    expect(re.test("((bucket_id = 'files'::text) AND (x))")).toBe(true)
    expect(re.test("(bucket_id = 'project-files'::text)")).toBe(false)
    expect(re.test("(bucket_id = 'files-archive'::text)")).toBe(false)
  })
})
