/** @jest-environment node */
import { readFileSync } from 'fs'
import { join } from 'path'

import { parseCsv } from '@/lib/csv'
import { detectFileKind } from '@/lib/jobber-import/columns'
import { addressesOf, buildPlan, invoiceStatus, readJobberFiles, type ExistingSnapshot, type ImportOptions, type RunFile } from '@/lib/jobber-import/plan'
import { seasonsFromVisits, inferSchedule } from '@/lib/jobber-import/schedule'

function file(name: string): RunFile {
  const rows = parseCsv(readFileSync(join(__dirname, 'fixtures/jobber', name), 'utf8'))
  return { id: name, name, kind: detectFileKind(rows[0])!, headers: rows[0], rows: rows.slice(1) }
}
const ALL = ['clients-1.csv', 'invoices.csv', 'recurring.csv', 'visits.csv', 'quotes.csv', 'products.csv'].map(file)
// Test stand-in for SQL property_address_key: lower + letters/digits (the real rule runs in SQL at Check).
const keys = (addrs: string[]) => new Map(addrs.map((a) => [a, a.toLowerCase().replace(/,?\s*(fl|florida)\s+\d{5}.*$/, '').replace(/[^a-z0-9]+/g, ' ').trim()]))
const EMPTY: ExistingSnapshot = { customers: [], properties: [], fieldDefs: [], priceItems: [], plans: [], invoices: [], trades: [{ slug: 'lawn', label: 'Lawn care' }] }
const OPTS: ImportOptions = { dateOrder: null, trade: 'lawn', skipArchived: false, today: '2026-11-11' }

function plan(existing = EMPTY, opts = OPTS, files = ALL) {
  const read = readJobberFiles(files, {}, opts)
  return buildPlan(read, existing, keys(addressesOf(read)), opts)
}

describe('Jobber plan — a fresh company', () => {
  const { items, summary } = plan()
  const of = (kind: string) => items.filter((i) => i.kind === kind)

  it('reads day/month from the files (a day over 12 proves it)', () => {
    expect(summary.dateOrder).toMatchObject({ order: 'dmy', ambiguous: false })
  })
  it('one customer per Jobber client (rows with the same client id are properties); report-only clients become customers', () => {
    const names = of('customer').map((i) => i.label).sort()
    expect(names).toEqual(['Jane Smith', 'Old Archived', 'Someone New', 'Wakulla HOA'])
    expect(of('customer').every((i) => i.action === 'create')).toBe(true)
    const jane = of('customer').find((i) => i.label === 'Jane Smith')!
    expect(jane.payload).toMatchObject({ email: 'jane@example.com', phone: '+18505550101', address_text: '12 Oak St, Crawfordville, FL 32327' })
    const stub = of('customer').find((i) => i.label === 'Someone New')!
    expect(stub.problems[0].message).toMatch(/isn’t in the clients file/)
  })
  it('properties: two for Jane, billing used when there is no service address, no duplicate from the invoice', () => {
    const props = of('property').map((i) => i.label)
    expect(props).toEqual(expect.arrayContaining(['12 Oak St, Crawfordville, FL 32327', 'Rental · 40 Pine Rd, Medart, FL 32327', 'Clubhouse · 1 Club Dr, Crawfordville, FL 32327']))
    // Jane's invoice and plan at 12 Oak St reuse her property; "Someone New" gets one from the invoice.
    expect(of('property').filter((i) => i.label.startsWith('12 Oak St'))).toHaveLength(1)
    expect(of('property').some((i) => i.label.startsWith('5 Bay Ln'))).toBe(true)
  })
  it('custom fields: Jobber CF columns, tags, lead source, other phones/emails, an unknown column', () => {
    expect(summary.newFields.map((f) => f.label)).toEqual(expect.arrayContaining(['Gate code', 'Referred By', 'Tags', 'Lead source', 'Other phones', 'Other emails', 'Mowing height', 'Archived in Jobber']))
    const jane = of('customer').find((i) => i.label === 'Jane Smith')!
    expect((jane.payload.custom_fields as Record<string, unknown>)['customer:gate code']).toBe('4421')
    expect((jane.payload.custom_fields as Record<string, unknown>)['customer:other phones']).toBe('8505550199')
  })
  it('invoices: status and balance as given; paid-before-import never becomes a payment', () => {
    const inv = (n: string) => of('invoice').find((i) => i.source_id === `invoice:${n}`)!.payload as Record<string, any>
    expect(inv('1042')).toMatchObject({ status: 'partially_paid', total_cents: 19500, paid_outside_cents: 10000, issued_at: '2025-11-01', due_at: '2025-11-15' })
    expect(inv('1042').lines.map((l: any) => l.line_total_cents)).toEqual([18000, 1500])
    expect(inv('1043')).toMatchObject({ status: 'paid', total_cents: 42800, tax_cents: 2800, subtotal_cents: 40000, paid_outside_cents: 42800 })
    expect(inv('1044')).toMatchObject({ status: 'draft', total_cents: 25000, paid_outside_cents: null })
    expect(summary.invoices).toMatchObject({ open: 1, openBalanceCents: 9500, paid: 1, draft: 1 })
  })
  it('plans: from recurring jobs, schedule from visits, price from line items, every one needs review', () => {
    const p7 = of('plan').find((i) => i.source_id === 'job:7')!
    expect(p7.action).toBe('create')
    expect(p7.payload).toMatchObject({ price: 45, billing_basis: 'per_visit', start_date: '2025-04-01', end_date: '2026-10-31', ended: true, trade: 'lawn', preferred_weekday: 2 })
    expect(p7.payload.seasons).toEqual([
      { from: '04-01', to: '04-30', frequency: 'weekly' },
      { from: '10-01', to: '11-30', frequency: 'every_2_weeks' },
    ])
    const p8 = of('plan').find((i) => i.source_id === 'job:8')!
    expect(p8.payload.price).toBeNull()
    expect(p8.problems.map((x) => x.message).join(' ')).toMatch(/Fixed price/)
    expect(summary.plans).toMatchObject({ total: 2, fromVisits: 1 })
  })
  it('quotes become history on the customer; open ones flagged', () => {
    const q = of('history').find((i) => i.source_id === 'quote:55')!
    expect(q.payload).toMatchObject({ type: 'quote', open: true, total_cents: 63000 })
  })
  it('price book: inactive kept inactive', () => {
    expect(of('price_item').map((i) => [i.label, i.payload.active, i.payload.unit_price_cents])).toEqual([
      ['Weekly mowing', true, 4500],
      ['Mulch (yard)', true, 4500],
      ['Old service', false, 1000],
    ])
  })
})

describe('Jobber plan — running again and matching what is already here', () => {
  it('a second run updates what the first made (never duplicates)', () => {
    const first = plan()
    const existing: ExistingSnapshot = {
      ...EMPTY,
      customers: first.items.filter((i) => i.kind === 'customer').map((i, n) => ({ id: `c${n}`, name: i.label, email_lower: (i.payload.email as string) ?? null, phone_normalized: null, address_text: null, created_at: '2026-01-01', import_source_id: i.source_id })),
      invoices: [{ id: 'i1', invoice_number: '1042', import_source_id: 'invoice:1042' }],
      plans: [{ id: 'p1', import_source_id: 'job:7' }],
      priceItems: [{ id: 'pb1', name: 'Weekly mowing', import_source_id: 'product:weeklymowing' }],
    }
    const again = plan(existing)
    const act = (src: string) => again.items.find((i) => i.source_id === src)!
    expect(act('101')).toMatchObject({ action: 'update', target_id: 'c0' })
    expect(act('invoice:1042')).toMatchObject({ action: 'update', target_id: 'i1' })
    expect(act('job:7')).toMatchObject({ action: 'update', target_id: 'p1' })
    expect(act('product:weeklymowing')).toMatchObject({ action: 'update', target_id: 'pb1' })
  })
  it('an existing customer with the same phone is linked and listed as a duplicate', () => {
    const existing: ExistingSnapshot = { ...EMPTY, customers: [{ id: 'old', name: 'J. Smith', email_lower: null, phone_normalized: '8505550101', address_text: null, created_at: '2025-01-01', import_source_id: null }] }
    const r = plan(existing)
    expect(r.items.find((i) => i.source_id === '101')).toMatchObject({ action: 'link', target_id: 'old' })
    expect(r.summary.duplicates.some((d) => d.names.includes('J. Smith'))).toBe(true)
  })
  it('an invoice number already used here comes in as J-<n>', () => {
    const r = plan({ ...EMPTY, invoices: [{ id: 'x', invoice_number: '1043', import_source_id: null }] })
    expect(r.items.find((i) => i.source_id === 'invoice:1043')!.payload.invoice_number).toBe('J-1043')
  })
  it('no service type picked: plans are left out with a clear error', () => {
    const r = plan(EMPTY, { ...OPTS, trade: null })
    expect(r.items.filter((i) => i.kind === 'plan').every((i) => i.action === 'skip')).toBe(true)
    expect(r.summary.problemCount.errors).toBeGreaterThan(0)
  })
  it('skip archived leaves out archived clients nothing else needs', () => {
    const r = plan(EMPTY, { ...OPTS, skipArchived: true })
    expect(r.items.find((i) => i.label === 'Old Archived')!.action).toBe('skip')
  })
})

describe('Jobber status, schedule', () => {
  it('invoice status', () => {
    expect(invoiceStatus('Bad Debt', 100, 100)).toEqual({ status: 'void', voidReason: 'Bad debt in Jobber' })
    expect(invoiceStatus('Past Due', 100, 100).status).toBe('sent')
    expect(invoiceStatus('Past Due', 100, 40).status).toBe('partially_paid')
    expect(invoiceStatus('Paid', 100, 0).status).toBe('paid')
  })
  it('weekly all year from visits', () => {
    const dates = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2025, 0, 6 + i * 7)).toISOString().slice(0, 10))
    expect(seasonsFromVisits(dates)).toEqual({ seasons: [{ from: '01-01', to: '12-31', frequency: 'weekly' }], weekday: 1 })
  })
  it('no visits, no words → weekly all year with a note', () => {
    const s = inferSchedule({ visitDates: [], words: 'Lawn', startDate: '2025-04-03' })
    expect(s).toMatchObject({ source: 'default', weekday: 4 })
    expect(inferSchedule({ visitDates: [], words: 'Bi-weekly mowing', startDate: null }).seasons[0].frequency).toBe('every_2_weeks')
  })
})

describe('Jobber review fixes — overlapping exports, odd J-IDs, Excel, encoding', () => {
  const csv = (id: string, name: string, text: string): RunFile => {
    const rows = parseCsv(text)
    return { id, name, kind: detectFileKind(rows[0])!, headers: rows[0], rows: rows.slice(1) }
  }
  it('the same recurring job, quote and invoice in two exports is kept once (and listed)', () => {
    const files = [file('clients-1.csv'), file('recurring.csv'), { ...file('recurring.csv'), id: 'again', name: 'recurring (1).csv' }, file('invoices.csv'), { ...file('invoices.csv'), id: 'inv2', name: 'invoices-old.csv' }, file('quotes.csv'), { ...file('quotes.csv'), id: 'q2', name: 'quotes2.csv' }]
    const r = plan(EMPTY, OPTS, files)
    expect(r.items.filter((i) => i.source_id === 'job:7')).toHaveLength(1)
    expect(r.items.filter((i) => i.source_id === 'invoice:1042')).toHaveLength(1)
    expect(r.items.filter((i) => i.source_id === 'quote:55')).toHaveLength(1)
    expect(r.summary.problems.some((p) => /also in recurring.csv/.test(p.message))).toBe(true)
  })
  it('a client split across two client files is one customer with both properties', () => {
    const head = 'J-ID,Display Name,E-mails,Service Street 1,Service City,Service State,Service Zip code\n'
    const a = csv('a', 'clients-1.csv', head + '9_1,Pat Lee,pat@x.com,1 Elm St,Panacea,FL,32346\n')
    const b = csv('b', 'clients-2.csv', head + '9_2,Pat Lee,pat@x.com,2 Oak St,Panacea,FL,32346\n')
    const r = plan(EMPTY, OPTS, [a, b])
    expect(r.items.filter((i) => i.kind === 'customer')).toHaveLength(1)
    expect(r.items.filter((i) => i.kind === 'property').map((i) => i.source_id).sort()).toEqual(['9_1', '9_2'])
  })
  it('a J-ID with no property part ("12_") gets numbered properties, never a clash', () => {
    const head = 'J-ID,Display Name,Service Street 1,Service City\n'
    const r = plan(EMPTY, OPTS, [csv('c', 'clients.csv', head + '12_,Sam,1 A St,Medart\n12_,Sam,2 B St,Medart\n')])
    expect(r.items.filter((i) => i.kind === 'property').map((i) => i.source_id)).toEqual(['12:1', '12:2'])
  })
  it('Excel damage: scientific-notation phones are dropped and listed; a 4-digit ZIP is flagged', () => {
    const head = 'J-ID,Display Name,Main Phone #s,Service Street 1,Service Zip code\n'
    const r = plan(EMPTY, OPTS, [csv('d', 'clients.csv', head + '5_1,Ann,8.50555E+09,1 A St,2108\n')])
    expect(r.items.find((i) => i.kind === 'customer')!.payload.phone).toBeNull()
    const msgs = r.summary.problems.map((p) => p.message).join(' | ')
    expect(msgs).toMatch(/looks changed by Excel/)
    expect(msgs).toMatch(/lost its leading zero/)
  })
})

describe('CSV bytes', () => {
  it('UTF-8 (with BOM) and Windows-1252 (Excel) both decode', () => {
    const { decodeCsvBytes } = jest.requireActual('@/lib/csv') as typeof import('@/lib/csv')
    const utf8 = new TextEncoder().encode('﻿Name\nJosé\n')
    expect(decodeCsvBytes(utf8)).toEqual({ text: 'Name\nJosé\n', encoding: 'utf-8' })
    const cp1252 = new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x4a, 0x6f, 0x73, 0xe9, 0x20, 0x96, 0x20, 0x92, 0x0a])
    expect(decodeCsvBytes(cp1252)).toEqual({ text: 'Name\nJosé – ’\n', encoding: 'windows-1252' })
  })
})
