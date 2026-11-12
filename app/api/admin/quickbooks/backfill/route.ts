import { NextResponse } from 'next/server'

import { loadOrgFeatures } from '@/lib/org-features'
import { requireOnlinePaymentsCaller } from '@/lib/online-payments/access'
import { applyBackfill, planBackfill, type Decisions } from '@/lib/quickbooks/backfill'
import { readQbSettings } from '@/lib/quickbooks/mapping'
import { loadOrgForMapping } from '@/lib/quickbooks/mapping-screen'
import { openQbClient } from '@/lib/quickbooks/session'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

async function context(request?: Request) {
  const a = await requireOnlinePaymentsCaller('owner', request)
  if (a.error) return { error: a.error } as const
  const orgId = a.profile.org_id
  const features = await loadOrgFeatures(a.admin, orgId)
  if (!features.quickbooks) return { error: NextResponse.json({ error: 'Turn on QuickBooks in the feature switches first' }, { status: 409 }) } as const
  const org = await loadOrgForMapping(a.admin, orgId)
  if (!org) return { error: NextResponse.json({ error: 'Company not found' }, { status: 404 }) } as const
  const opened = await openQbClient(a.admin, orgId)
  if (!opened.ok) return { error: NextResponse.json({ error: 'Connect or reconnect QuickBooks first.', reason: opened.reason }, { status: 409 }) } as const
  return { a, orgId, org, client: opened.client } as const
}

/** POST { decisions? } with action preview (default): what is already in QuickBooks and how it matches. Read-only. Owners only. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { action?: string; decisions?: Record<string, unknown> }
  const c = await context(request)
  if ('error' in c) return c.error
  const settings = readQbSettings(c.org.settings)
  const decisions: Decisions = {}
  for (const [k, v] of Object.entries(body.decisions ?? {})) if (typeof v === 'string' && v.length <= 64 && k.length <= 120) decisions[k] = v
  try {
    if (body.action === 'apply') {
      const r = await applyBackfill(c.a.admin, c.orgId, c.client, settings, decisions, c.a.profile.id)
      return NextResponse.json(r)
    }
    return NextResponse.json(await planBackfill(c.a.admin, c.orgId, c.client, settings, decisions))
  } catch (e) {
    console.error('quickbooks backfill failed', e)
    return NextResponse.json({ error: 'Could not read QuickBooks right now. Try again in a minute.' }, { status: 502 })
  }
}
