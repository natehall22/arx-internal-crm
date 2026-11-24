import { NextResponse } from 'next/server'

import { isYmd } from '@/lib/service-plans'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { orgDb } from '@/lib/supabase/org-db'
import { loadCrewDayNote, saveCrewDayNote } from '@/lib/truck-sheet-db'

export const dynamic = 'force-dynamic'

/** GET ?crew=<subId>&day=YYYY-MM-DD — the office's note for that crew and day (`{ note: string | null }`). Job-board people. */
export async function GET(request: Request) {
  const ctx = await servicePlanRouteAuth('view')
  if (ctx instanceof Response) return ctx
  const url = new URL(request.url)
  const crew = url.searchParams.get('crew') ?? ''
  const day = url.searchParams.get('day')
  if (!crew || !isYmd(day)) return NextResponse.json({ error: 'Pick a crew and a day' }, { status: 400 })
  const { data: sub } = await orgDb(ctx.admin, ctx.orgId).from('sub_contractors').select('id').eq('id', crew).maybeSingle()
  if (!sub) return NextResponse.json({ error: 'Crew not found' }, { status: 404 })
  const found = await loadCrewDayNote(ctx.admin, ctx.orgId, crew, day)
  return NextResponse.json({ note: found?.note ?? null })
}

/** POST `{ crew, day, note }` — write the note for that crew and day (blank clears it). The crew sees it on its phone page and the sheet. jobs:edit. */
export async function POST(request: Request) {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  const body = (await request.json().catch(() => null)) as { crew?: unknown; day?: unknown; note?: unknown } | null
  if (!body || typeof body.crew !== 'string' || !body.crew || !isYmd(body.day)) return NextResponse.json({ error: 'Pick a crew and a day' }, { status: 400 })
  const res = await saveCrewDayNote(ctx.admin, ctx.orgId, ctx.userId, body.crew, body.day, body.note)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true, note: res.note })
}
