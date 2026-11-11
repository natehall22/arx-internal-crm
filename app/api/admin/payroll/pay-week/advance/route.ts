/**
 * Advances / draws (lib/payroll-advances.ts). Owners (super admins) only, checked again inside the SQL writers.
 *   POST  { userId, amount, mode: 'full'|'fixed'|'percent', value?, note?, startWeek: 'this'|'next', payOnCheck?, belowMinimumOk? }
 *   PATCH { id, action: 'cancel' | 'allow_below_minimum' | 'block_below_minimum', reason? }
 */
import { NextRequest, NextResponse } from 'next/server'

import { cancelAdvance, recordAdvance, setBelowMinimumOk } from '@/lib/payroll-advances-db'
import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { isUuid } from '@/lib/payroll-pay-week'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'
const OWNER_ONLY = { error: 'Only an owner can record or change an advance.', code: 'owner_only' }

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  if (!isSuperAdmin(a.profile)) return NextResponse.json(OWNER_ONLY, { status: 403 })
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!b || !isUuid(b.userId)) return NextResponse.json({ error: 'Choose a person' }, { status: 400 })
  try {
    const r = await recordAdvance(a.admin, {
      orgId: a.profile.org_id,
      actorUserId: a.profile.id,
      userId: b.userId as string,
      amount: b.amount,
      mode: b.mode,
      value: b.value,
      note: b.note,
      startWeek: b.startWeek === 'next' ? 'next' : 'this',
      payOnCheck: b.payOnCheck === true,
      belowMinimumOk: b.belowMinimumOk === true,
    })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true, id: r.id, firstWeekEnding: r.firstWeekEnding })
  } catch (e) {
    console.error('POST pay-week advance', e)
    return NextResponse.json({ error: 'Could not save. Nothing changed.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  if (!isSuperAdmin(a.profile)) return NextResponse.json(OWNER_ONLY, { status: 403 })
  const b = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown; reason?: unknown } | null
  if (!b || !isUuid(b.id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  try {
    if (b.action === 'cancel') {
      const r = await cancelAdvance(a.admin, { orgId: a.profile.org_id, actorUserId: a.profile.id, advanceId: b.id as string, reason: typeof b.reason === 'string' ? b.reason.slice(0, 300) : '' })
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
      return NextResponse.json({ ok: true, writtenOff: r.writtenOff, withdrawn: r.withdrawn })
    }
    if (b.action === 'allow_below_minimum' || b.action === 'block_below_minimum') {
      const r = await setBelowMinimumOk(a.admin, { orgId: a.profile.org_id, actorUserId: a.profile.id, advanceId: b.id as string, ok: b.action === 'allow_below_minimum' })
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  } catch (e) {
    console.error('PATCH pay-week advance', e)
    return NextResponse.json({ error: 'Could not save. Nothing changed.' }, { status: 500 })
  }
}
