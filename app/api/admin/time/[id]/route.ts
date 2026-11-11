import { NextResponse } from 'next/server'

import { isUuidLike, parseEntryEdit } from '@/lib/time-tracking'
import { requireTimeOfficeApi } from '@/lib/time-tracking-access'
import { editTimeEntry, loadEntryHistory, removeTimeEntry } from '@/lib/time-tracking-db'

export const dynamic = 'force-dynamic'

/** GET — who changed this entry, when, why. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const a = await requireTimeOfficeApi()
  if (a.error) return a.error
  if (!isUuidLike(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ history: await loadEntryHistory(a.admin, a.profile.org_id, params.id) })
}

/** PATCH { startedAt?, endedAt?, kind?, jobId?, workOrderId?, needsReview?, reason } — fix an entry (reason required). */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const a = await requireTimeOfficeApi()
  if (a.error) return a.error
  if (!isUuidLike(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = parseEntryEdit(await request.json().catch(() => null), { adding: false })
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const res = await editTimeEntry(a.admin, a.profile.org_id, a.profile.id, params.id, parsed.edit, parsed.reason)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}

/** DELETE { reason } — take an entry out (kept as removed, with the reason). */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const a = await requireTimeOfficeApi()
  if (a.error) return a.error
  if (!isUuidLike(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 3 || reason.length > 500) return NextResponse.json({ error: 'Say why (a few words)' }, { status: 400 })
  const res = await removeTimeEntry(a.admin, a.profile.org_id, a.profile.id, params.id, reason)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}
