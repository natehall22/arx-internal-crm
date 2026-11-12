/**
 * Shared harness for the money end-to-end suite. Everything here talks to the REAL local Postgres (through PostgREST, with the app's own
 * createServiceClient()) - the only fakes are the QuickBooks company (lib/test-helpers/fake-qb.ts) and "who is signed in" for route handlers.
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createServiceClient } from '@/lib/supabase/service'
import { FakeQbCompany } from '@/lib/test-helpers/fake-qb'
import { runQuickBooksForOrg, type WorkerOrg } from '@/lib/quickbooks/worker'

export const TZ = 'America/New_York'
export const admin = (): SupabaseClient => createServiceClient()

/** Raw SQL against the throwaway database (setup, "what is really stored" checks, simulated time travel). JSON rows back. */
export function sql<T = Record<string, unknown>>(query: string): T[] {
  const out = execFileSync('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', `select coalesce(json_agg(q), '[]') from (${query}) q`], {
    env: { ...process.env, PGHOST: process.env.MONEY_PG_HOST || '/tmp/moneypg', PGPORT: process.env.MONEY_PG_PORT || '55433', PGUSER: 'postgres', PGDATABASE: 'postgres' },
    encoding: 'utf8',
  })
  return JSON.parse(out.trim() || '[]')
}
export function exec(statement: string): void {
  execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    env: { ...process.env, PGHOST: process.env.MONEY_PG_HOST || '/tmp/moneypg', PGPORT: process.env.MONEY_PG_PORT || '55433', PGUSER: 'postgres', PGDATABASE: 'postgres' },
    encoding: 'utf8',
  })
}

export const cents = (dollars: unknown): number => Math.round(Number(dollars) * 100)
export const dollars = (c: number): string => (c / 100).toFixed(2)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function must<T = any>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error || data == null) throw new Error(`${what}: ${error?.message ?? 'no data'}`)
  return data as T
}

export type Company = { id: string; name: string; ownerId: string; users: Record<string, string> }

export async function makeUser(orgId: string, role: string, first: string, extra: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID()
  exec(`insert into auth.users (id, email) values ('${id}', '${first.toLowerCase()}.${id.slice(0, 6)}@example.test')`)
  await must(admin().from('users').insert({ id, org_id: orgId, email: `${first.toLowerCase()}.${id.slice(0, 6)}@example.test`, full_name: `${first} Test`, role, active: true, ...extra }).select('id').single(), `user ${first}`)
  return id
}

export async function makeCompany(name: string, settings: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<Company> {
  const org = await must(admin().from('orgs').insert({ name, settings, timezone: TZ, ...extra }).select('id').single(), `org ${name}`)
  const id = (org as { id: string }).id
  const ownerId = await makeUser(id, 'admin', 'Owner')
  return { id, name, ownerId, users: { owner: ownerId } }
}

/** orgs.settings is only ever merged key by key in the app; tests set whole keys. */
export async function setOrgSettings(orgId: string, patch: Record<string, unknown>): Promise<void> {
  const { data } = await admin().from('orgs').select('settings').eq('id', orgId).single()
  const next = { ...((data as { settings?: Record<string, unknown> } | null)?.settings ?? {}), ...patch }
  await must(admin().from('orgs').update({ settings: next }).eq('id', orgId).select('id').single(), 'org settings')
}

/** The QuickBooks mapping a finished owner setup leaves behind (lib/quickbooks/mapping.ts). */
export function qbMapping(over: Record<string, unknown> = {}) {
  return {
    startDate: '2026-01-01',
    invoiceMode: 'per_job',
    income: { defaultItemId: 'item-1', byTrade: {} },
    tax: { mode: 'none', taxCodeId: null, rateMap: {} },
    depositToAccountId: 'acct-dep',
    receivablesAccountId: null,
    bills: { enabled: true, expenseAccountId: 'acct-exp', classId: null },
    vendors1099: [],
    confirmedAt: '2026-01-02T00:00:00Z',
    confirmedBy: null,
    ...over,
  }
}

export class QbWorld {
  readonly companies = new Map<string, FakeQbCompany>()
  clock = Date.now()
  company(orgId: string): FakeQbCompany {
    let c = this.companies.get(orgId)
    if (!c) this.companies.set(orgId, (c = new FakeQbCompany(`realm-${orgId.slice(0, 8)}`)))
    return c
  }
  /** One cron tick for one company: the REAL worker, against that company's own fake QuickBooks. */
  async run(orgId: string, o: { sweep?: boolean } = {}) {
    const { data } = await admin().from('orgs').select('id, settings, timezone').eq('id', orgId).single()
    const org = data as { id: string; settings: Record<string, unknown>; timezone: string }
    const worker: WorkerOrg = { id: org.id, settings: org.settings, timezone: org.timezone || TZ }
    return runQuickBooksForOrg(
      { admin: admin(), now: () => this.clock, sweep: o.sweep ?? true, maxRows: 200, openClient: async (id) => ({ ok: true, client: this.company(id).client() }) },
      worker,
      true
    )
  }
}
