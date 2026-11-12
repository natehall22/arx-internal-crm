/** Server side of the QuickBooks mapping screen: gather what the screen shows, and check what it sends back. */
import type { SupabaseClient } from '@supabase/supabase-js'

import { readSalesTaxSettings } from '@/lib/sales-tax'
import { orgDb } from '@/lib/supabase/org-db'
import { orgTimeZone } from '@/lib/timezone'

import type { QbClient } from './client'
import { loadQbLists, suggestSettings, type QbLists } from './lists'
import { mappingProblems, QUICKBOOKS_SETTINGS_KEY, readQbSettings, type QbSettings } from './mapping'
import { sweepUnheard } from './sweep'
import { dayIn } from './worker'

export type MappingScreen = {
  settings: QbSettings
  suggested: Partial<QbSettings>
  lists: QbLists
  problems: Array<{ field: string; message: string }>
  crmRates: Array<{ id: string; name: string; percent: number; active: boolean }>
  vendors: Array<{ id: string; name: string }>
  tradeSlugs: Array<{ slug: string; label: string }>
  /** What "Start sending" would send from the start date (counts only). */
  preview: { invoices: number; payments: number; bills: number } | null
  today: string
  /** Step 3 is done (matched, or skipped after a warning). */
  backfillDone: boolean
  connected: boolean
}

export async function loadOrgForMapping(admin: SupabaseClient, orgId: string): Promise<{ settings: Record<string, unknown>; timezone: string } | null> {
  const { data } = await admin.from('orgs').select('settings, timezone').eq('id', orgId).maybeSingle()
  if (!data) return null
  const r = data as { settings: Record<string, unknown> | null; timezone: unknown }
  return { settings: r.settings ?? {}, timezone: orgTimeZone(r.timezone) }
}

export async function loadMappingScreen(admin: SupabaseClient, orgId: string, client: QbClient): Promise<MappingScreen | null> {
  const org = await loadOrgForMapping(admin, orgId)
  if (!org) return null
  const settings = readQbSettings(org.settings)
  const salesTax = readSalesTaxSettings(org.settings)
  const crmRates = (salesTax?.enabled ? salesTax.rates : []).map((r) => ({ id: r.id, name: r.name, percent: r.percent, active: r.active }))
  const today = dayIn(org.timezone, Date.now())
  const lists = await loadQbLists(client)
  const { data: vendors } = await orgDb(admin, orgId).from('vendors').select('id, name').eq('active', true).is('deleted_at', null).order('name', { ascending: true }).limit(500)
  const { data: trades } = await orgDb(admin, orgId).from('org_trades').select('slug, label').eq('active', true).order('label', { ascending: true }).limit(50)
  return {
    settings,
    suggested: suggestSettings(lists, settings, crmRates, today),
    lists,
    problems: mappingProblems(settings, salesTax?.enabled ? salesTax : null),
    crmRates,
    vendors: ((vendors ?? []) as Array<{ id: string; name: string }>).map((v) => ({ id: v.id, name: v.name })),
    tradeSlugs: ((trades ?? []) as Array<{ slug: string; label: string }>).map((t) => ({ slug: t.slug, label: t.label })),
    preview: settings.startDate ? await sweepUnheard(admin, orgId, settings, { dryRun: true }).catch(() => null) : null,
    today,
    backfillDone: backfillDone(org.settings),
    connected: true,
  }
}

/** Every id the owner sends back must be one of QuickBooks' own: nothing arbitrary is ever stored (and later sent). */
export function checkAgainstLists(s: QbSettings, lists: QbLists): string | null {
  const has = (xs: Array<{ id: string }>, id: string | null) => !id || xs.some((x) => x.id === id)
  if (!has(lists.items, s.income.defaultItemId)) return 'That sales item is not in your QuickBooks.'
  for (const id of Object.values(s.income.byTrade)) if (!has(lists.items, id)) return 'A trade’s sales item is not in your QuickBooks.'
  if (!has(lists.depositAccounts, s.depositToAccountId)) return 'That deposit account is not in your QuickBooks.'
  if (!has(lists.receivableAccounts, s.receivablesAccountId)) return 'That receivables account is not in your QuickBooks.'
  if (!has(lists.expenseAccounts, s.bills.expenseAccountId)) return 'That expense account is not in your QuickBooks.'
  if (!has(lists.classes, s.bills.classId)) return 'That class is not in your QuickBooks.'
  if (s.tax.mode === 'code') {
    const code = lists.taxCodes.find((c) => c.id === s.tax.taxCodeId)
    if (s.tax.taxCodeId && !code) return 'That sales tax code is not in your QuickBooks.'
    for (const rate of Object.values(s.tax.rateMap)) if (code && !code.rates.some((r) => r.id === rate)) return 'A sales tax rate is not part of the tax code you picked.'
  }
  return null
}

export { QUICKBOOKS_SETTINGS_KEY }

/** Has the owner matched what is already in QuickBooks (or applied with nothing to match)? Stored by `applyBackfill`. */
export function backfillDone(orgSettings: Record<string, unknown>): boolean {
  const qb = orgSettings[QUICKBOOKS_SETTINGS_KEY] as { backfill?: { doneAt?: unknown } } | undefined
  return typeof qb?.backfill?.doneAt === 'string' && qb.backfill.doneAt.length > 0
}
