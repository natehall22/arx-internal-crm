import { NextResponse } from 'next/server'

import { requireOnlinePaymentsCaller } from '@/lib/online-payments/access'
import { loadActivity, type ActivityState } from '@/lib/quickbooks/activity'
import { loadConnection } from '@/lib/quickbooks/connection'
import { retryRow, skipRow } from '@/lib/quickbooks/outbox'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const FILTERS = ['all', 'sent', 'waiting', 'needs_you', 'skipped', 'working'] as const

/** GET — what was sent to QuickBooks and what is waiting or stuck, with a link to each QuickBooks record. Owners only. */
export async function GET(request: Request) {
  const a = await requireOnlinePaymentsCaller('owner')
  if (a.error) return a.error
  const filter = new URL(request.url).searchParams.get('filter') ?? 'all'
  if (!(FILTERS as readonly string[]).includes(filter)) return NextResponse.json({ error: 'Unknown filter' }, { status: 400 })
  const conn = await loadConnection(a.admin, a.profile.org_id)
  const data = await loadActivity(a.admin, a.profile.org_id, { environment: conn?.environment ?? null, filter: filter as ActivityState | 'all' })
  return NextResponse.json(data)
}

/** POST { action: 'retry' | 'skip', id } — only a line that needs a person. Retry sends it again; Skip closes it (it is never sent). Owners only. */
export async function POST(request: Request) {
  const a = await requireOnlinePaymentsCaller('owner', request)
  if (a.error) return a.error
  const body = (await request.json().catch(() => ({}))) as { action?: string; id?: unknown }
  if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return NextResponse.json({ error: 'Unknown line' }, { status: 400 })
  if (body.action !== 'retry' && body.action !== 'skip') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const ok = body.action === 'retry' ? await retryRow(a.admin, a.profile.org_id, body.id) : await skipRow(a.admin, a.profile.org_id, body.id)
  if (!ok) return NextResponse.json({ error: 'That line is not waiting for you any more.' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
