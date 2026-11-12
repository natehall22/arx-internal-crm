import { NextResponse } from 'next/server'

import { loadOrgFeatures } from '@/lib/org-features'
import { requireOnlinePaymentsCaller } from '@/lib/online-payments/access'
import { loadConnection } from '@/lib/quickbooks/connection'
import { readQbSettings, saveQuickBooksSettings } from '@/lib/quickbooks/mapping'
import { backfillDone, checkAgainstLists, loadMappingScreen, loadOrgForMapping } from '@/lib/quickbooks/mapping-screen'
import { createQbLinks } from '@/lib/quickbooks/links'
import { dayIn } from '@/lib/quickbooks/worker'
import { openQbClient } from '@/lib/quickbooks/session'
import { orgDb } from '@/lib/supabase/org-db'
import { readSalesTaxSettings } from '@/lib/sales-tax'
import { mappingProblems } from '@/lib/quickbooks/mapping'
import { loadQbLists } from '@/lib/quickbooks/lists'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET — the mapping screen: what is saved, the company's own QuickBooks lists, the obvious picks, what is still missing. Owners only. */
export async function GET() {
  const a = await requireOnlinePaymentsCaller('owner')
  if (a.error) return a.error
  const orgId = a.profile.org_id
  const features = await loadOrgFeatures(a.admin, orgId)
  if (!features.quickbooks) return NextResponse.json({ error: 'Turn on QuickBooks in the feature switches first' }, { status: 409 })
  const opened = await openQbClient(a.admin, orgId)
  if (!opened.ok) return NextResponse.json({ error: opened.reason === 'needs_reconnect' ? 'Reconnect QuickBooks first.' : opened.reason === 'not_connected' ? 'Connect QuickBooks first.' : 'QuickBooks is not answering right now. Try again in a minute.', reason: opened.reason }, { status: 409 })
  const screen = await loadMappingScreen(a.admin, orgId, opened.client)
  if (!screen) return NextResponse.json({ error: 'Company not found' }, { status: 404 })
  return NextResponse.json(screen)
}

/**
 * PUT — save the owner's choices (`confirm: true` = "Start sending"). Every id must be one of QuickBooks' own; changing the invoice
 * mode after invoices were sent needs a new start date (today or later) so nothing is sent twice in two shapes. Owners only.
 */
export async function PUT(request: Request) {
  const a = await requireOnlinePaymentsCaller('owner', request)
  if (a.error) return a.error
  const orgId = a.profile.org_id
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
  const features = await loadOrgFeatures(a.admin, orgId)
  if (!features.quickbooks) return NextResponse.json({ error: 'Turn on QuickBooks in the feature switches first' }, { status: 409 })
  const conn = await loadConnection(a.admin, orgId)
  if (!conn || conn.status !== 'connected') return NextResponse.json({ error: 'Connect QuickBooks first.' }, { status: 409 })
  const org = await loadOrgForMapping(a.admin, orgId)
  if (!org) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const next = readQbSettings({ quickbooks: body })
  const saved = readQbSettings(org.settings)
  const today = dayIn(org.timezone, Date.now())

  if (next.invoiceMode !== saved.invoiceMode) {
    const { count } = await orgDb(a.admin, orgId).from('qb_links').select('id', { count: 'exact', head: true }).eq('qb_type', 'Invoice')
    if ((count ?? 0) > 0 && (!next.startDate || next.startDate < today || next.startDate === saved.startDate)) {
      return NextResponse.json({ error: 'Invoices have already been sent in the other style. To change it, pick a new start date of today or later, so nothing is sent twice.' }, { status: 409 })
    }
  }
  if (body.confirm === true) {
    const salesTax = readSalesTaxSettings(org.settings)
    const problems = mappingProblems(next, salesTax?.enabled ? salesTax : null)
    if (problems.length) return NextResponse.json({ error: problems[0].message, problems }, { status: 400 })
  }
  const opened = await openQbClient(a.admin, orgId)
  if (!opened.ok) return NextResponse.json({ error: 'QuickBooks is not answering, so your choices could not be checked. Try again in a minute.' }, { status: 409 })
  const lists = await loadQbLists(opened.client)
  if (lists.unreadable.some((l) => l !== 'classes' && l !== 'preferences' && l !== 'company')) return NextResponse.json({ error: 'Could not read your QuickBooks lists to check your choices. Try again in a minute.' }, { status: 409 })
  if (lists.country && lists.country !== 'US') return NextResponse.json({ error: 'The CRM sends to US QuickBooks companies only so far.' }, { status: 409 })
  const wrong = checkAgainstLists(next, lists)
  if (wrong) return NextResponse.json({ error: wrong }, { status: 400 })
  // Link-first: a QuickBooks company that already has customers must be matched before the first "Start sending", or the worker could create duplicates.
  if (body.confirm === true && !saved.confirmedAt && !backfillDone(org.settings)) {
    const existing = await opened.client.query('Customer', null, { max: 1 })
    if (!existing.ok) return NextResponse.json({ error: 'QuickBooks is not answering, so it could not be checked for existing customers. Try again in a minute.' }, { status: 409 })
    if (existing.value.length > 0) return NextResponse.json({ error: 'Your QuickBooks already has customers. Match them first (“Match what is already in QuickBooks”), then start sending.', needsBackfill: true }, { status: 409 })
  }

  const result = await saveQuickBooksSettings(a.admin, orgId, body, a.profile.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  const salesTax = readSalesTaxSettings(org.settings)
  return NextResponse.json({ settings: result.settings, problems: mappingProblems(result.settings, salesTax?.enabled ? salesTax : null) })
}
