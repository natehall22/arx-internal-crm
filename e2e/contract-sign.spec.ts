import fs from 'fs'
import path from 'path'

import { expect, test } from '@playwright/test'

import { createFakeDb } from '../lib/test-helpers/fake-db'

/**
 * Signing a gutters-only cash contract must create a production job with job_type 'gutters'.
 * (2026-10: 26-10-21 Carann Brown's signing created a project and NO job — the insert wrote 'gutters', the database CHECK only
 * allowed roofing | siding | windows | mixed, and the error was only logged.)
 *
 * This runs the REAL app/api/contracts/sign route in the Node test process (the phone suite's dev server has no database). Only the
 * database client is swapped for the in-memory fake, which also ENFORCES the production_jobs.job_type CHECK read from the latest
 * migration — so a value the database would reject fails here too.
 */

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migrations', '202610290130_job_type_allows_gutters.sql')
const allowedJobTypes = (): string[] => {
  const sql = fs.readFileSync(MIGRATION, 'utf8')
  const list = sql.match(/CHECK \(job_type = ANY \(ARRAY\[([^\]]+)\]/)?.[1] ?? ''
  return Array.from(list.matchAll(/'([a-z]+)'/g)).map((m) => m[1])
}

const ORG = 'org-1'
const TOKEN = 'tok-gutters'

function seed() {
  return {
    order_form_contracts: [{
      id: 'c-1', org_id: ORG, opportunity_id: 'opp-1', proposal_id: null, signing_token: TOKEN, token_expires_at: '2099-01-01T00:00:00Z', status: 'pending',
      agreement_type: 'installation', customer_name: 'Carann Brown', customer_email: 'carannb@gmail.com', customer_phone: '7045550142',
      project_address: '172 S Smallwood Pl, Charlotte, NC 28208, USA', project_cost: 2035.2, total_squares: null, deposit_amount: 0, payment_method: 'cash',
      scope_roof_replacement: false, scope_roof_repair: false, scope_gutters: true, scope_siding: false, scope_other: null,
      notes: 'Gutters only', exclusions: null, created_by: 'u-1',
    }],
    opportunities: [{ id: 'opp-1', org_id: ORG, customer_id: 'cust-1', lead_id: 'lead-1', owner_user_id: 'u-1', inspection_outcome: null, job_source: null, insurance_stage: null, status: 'open' }],
    leads: [{ id: 'lead-1', org_id: ORG, homeowner_name: 'Carann Brown', phone: '7045550142', email: 'carannb@gmail.com', address_text: '172 S Smallwood Pl, Charlotte, NC 28208, USA' }],
    customers: [{ id: 'cust-1', org_id: ORG, name: 'Carann Brown', phone: '7045550142', email: 'carannb@gmail.com', address_text: '172 S Smallwood Pl, Charlotte, NC 28208, USA' }],
    users: [{ id: 'u-1', org_id: ORG, full_name: 'Nathan Hall', email: 'nathan@example.test', role: 'admin' }],
    projects: [],
    production_jobs: [],
  }
}

test('signing a gutters-only contract creates a job with job_type gutters', async ({}, info) => {
  if (info.project.name !== 'iphone-se') test.skip() // server-side check: once is enough

  const db = createFakeDb(seed())
  // The database CHECK, enforced on every production_jobs insert (a rejected insert returns the same 23514 Postgres would).
  const allowed = allowedJobTypes()
  expect(allowed, 'the migration must allow gutters').toContain('gutters')
  const client = db.client as { from: (t: string) => Record<string, unknown> }
  const realFrom = client.from.bind(client)
  client.from = (table: string) => {
    const b = realFrom(table) as { insert: (rows: unknown) => unknown }
    if (table !== 'production_jobs') return b
    const realInsert = b.insert.bind(b)
    b.insert = (rows: unknown) => {
      const bad = ([] as Array<{ job_type?: string }>).concat(rows as never).find((r) => !allowed.includes(String(r.job_type)))
      if (bad) {
        const rejected = { select: () => rejected, single: async () => ({ data: null, error: { code: '23514', message: `new row violates check constraint "production_jobs_job_type_check" (${bad.job_type})` } }), then: undefined }
        return rejected
      }
      return realInsert(rows)
    }
    return b
  }

  // Swap only the database client the route builds; everything else is the real route.
  const servicePath = require.resolve('../lib/supabase/service')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(servicePath)
  require.cache[servicePath]!.exports = { createServiceClient: () => client }
  // No real mail: the route emails the customer and the admins.
  const sent: string[] = []
  const mailPath = require.resolve('nodemailer')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(mailPath)
  require.cache[mailPath]!.exports = { createTransport: () => ({ sendMail: async (m: { to: string }) => { sent.push(m.to); return {} } }) }

  // require (not import()): Playwright's TypeScript hook handles require, and the route's `@/` imports resolve through it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { POST } = require('../app/api/contracts/sign/route') as typeof import('../app/api/contracts/sign/route')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NextRequest } = require('next/server') as typeof import('next/server')
  const res = await POST(new NextRequest('http://localhost/api/contracts/sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, printName: 'Carann Brown', signature: 'data:image/png;base64,iVBORw0KGgo=', preferredContact: 'phone' }),
  }))
  expect(res.status, await res.clone().text()).toBe(200)

  const projects = db.tables.projects
  const jobs = db.tables.production_jobs
  expect(projects, 'a project was created').toHaveLength(1)
  expect(jobs, 'a production job was created for the gutters-only contract').toHaveLength(1)
  expect(jobs[0].job_type).toBe('gutters')
  expect(jobs[0].project_id).toBe(projects[0].id)
})
