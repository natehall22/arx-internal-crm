/**
 * THE QuickBooks worker: drains `integration_outbox` for ONE company per call (the cron loops companies, lib/cron-orgs.ts).
 * It posts nothing unless ALL of these are true, in this order: the company's switch is on; the owner finished the mapping and
 * pressed "Start sending"; the company is connected; QuickBooks is answering. Rows of a company that is not ready stay untouched
 * in the queue (they are not lost, and anything dated before the start date is skipped when the time comes).
 *
 * One company's calls are strictly sequential (QuickBooks allows ~10 a second, ~500 a minute per company), rows are taken one at
 * a time (so a throttle or a lost login never strands a claimed batch) and the run stops at its time budget.
 * The client is always opened for the company being processed, so company A's rows can only ever reach company A's QuickBooks.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { runHandler, type Outcome } from './handlers'
import { createQbLinks } from './links'
import { flagQuickBooksNeedsReconnect } from './connection'
import { mappingReady, readQbSettings, salesTaxFrom } from './mapping'
import { claimDue, markDone, markNeedsYou, markRetry, markSkipped, release } from './outbox'
import { openQbClient, type OpenClient } from './session'
import { sweepUnheard } from './sweep'

export type WorkerOrg = { id: string; settings: Record<string, unknown> | null; timezone: string }

export type WorkerDeps = {
  admin: SupabaseClient
  /** Test seam: the real one opens this company's own login. */
  openClient?: (orgId: string) => Promise<OpenClient>
  now?: () => number
  /** Stop starting new rows after this long (the cron has a hard limit). */
  budgetMs?: number
  maxRows?: number
}

export type WorkerReport = {
  orgId: string
  state: 'switch_off' | 'not_ready' | 'not_connected' | 'needs_reconnect' | 'unavailable' | 'ran'
  claimed: number
  done: number
  skipped: number
  retried: number
  needsYou: number
  superseded: number
  stopped: 'throttled' | 'auth' | 'company_stopped' | 'time' | null
  swept: number
}

const blank = (orgId: string, state: WorkerReport['state']): WorkerReport => ({ orgId, state, claimed: 0, done: 0, skipped: 0, retried: 0, needsYou: 0, superseded: 0, stopped: null, swept: 0 })

/** The company's own calendar day (YYYY-MM-DD) for an instant. */
export function dayIn(timeZone: string, ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}

export async function runQuickBooksForOrg(deps: WorkerDeps, org: WorkerOrg, featureOn: boolean): Promise<WorkerReport> {
  const { admin } = deps
  const now = deps.now ?? Date.now
  const report = blank(org.id, 'ran')
  if (!featureOn) return { ...report, state: 'switch_off' }
  const settings = readQbSettings(org.settings)
  if (!mappingReady(settings, salesTaxFrom(org.settings))) return { ...report, state: 'not_ready' }

  const opened = await (deps.openClient ?? ((id: string) => openQbClient(admin, id)))(org.id)
  if (!opened.ok) return { ...report, state: opened.reason }
  const links = createQbLinks(admin, org.id)

  try {
    const swept = await sweepUnheard(admin, org.id, settings)
    report.swept = swept.invoices + swept.payments + swept.bills
  } catch (e) {
    console.error('quickbooks sweep failed', org.id, e instanceof Error ? e.message : e)
  }

  const startedAt = now()
  const budget = deps.budgetMs ?? 40_000
  const maxRows = deps.maxRows ?? 40
  for (let i = 0; i < maxRows; i++) {
    if (now() - startedAt > budget) {
      report.stopped = 'time'
      break
    }
    const [row] = await claimDue(admin, org.id, now(), 1)
    if (!row) break
    report.claimed++
    const ctx = { admin, orgId: org.id, client: opened.client, settings, links, eventDay: dayIn(org.timezone, Date.parse(row.created_at) || now()) }
    const outcome = await runHandler(ctx, row)
    const fin = { row, now: now() }
    const applied = await apply(admin, org.id, fin, row, outcome, report)
    if (!applied) report.superseded++
    if (outcome.kind === 'stop') {
      report.stopped = outcome.reason
      if (outcome.reason === 'company_stopped') await flagQuickBooksNeedsReconnect(admin, org.id, 'QuickBooks stopped accepting this connection. Please reconnect.')
      break
    }
    if (outcome.kind === 'retry' && outcome.stop === 'throttled') {
      report.stopped = 'throttled'
      break
    }
  }
  return report
}

async function apply(admin: SupabaseClient, orgId: string, fin: { row: { id: string; lease: string }; now: number }, row: { attempt_count: number }, o: Outcome, report: WorkerReport): Promise<boolean> {
  switch (o.kind) {
    case 'done':
      report.done++
      return markDone(admin, orgId, fin, { qbType: o.qbType, qbId: o.qbId, warning: o.warning ?? null })
    case 'skipped':
      report.skipped++
      return markSkipped(admin, orgId, fin, { code: o.code, message: o.message })
    case 'needs_you':
      report.needsYou++
      return markNeedsYou(admin, orgId, fin, { code: o.code, message: o.message })
    case 'retry':
      report.retried++
      return markRetry(admin, orgId, fin, row, { code: o.code, message: o.message, delayMs: o.delayMs })
    case 'stop':
      // The login needs a person; the event itself is fine. Give it back untouched and try again after reconnecting.
      await release(admin, orgId, fin, 15 * 60_000)
      return true
  }
}
