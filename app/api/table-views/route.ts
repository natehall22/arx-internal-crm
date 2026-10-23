/**
 * Saved views for the shared DataTable (components/ui/data-table.tsx). Private to the signed-in user.
 *   GET ?table=key · POST { table, name, state } (same name replaces) · DELETE ?id=
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const KEY = /^[a-z0-9_-]{1,40}$/

async function who() {
  try {
    const { profile } = await requireAuthApi()
    return { profile, admin: createServiceClient() }
  } catch {
    return null
  }
}

function cleanState(raw: unknown) {
  const s = (raw ?? {}) as { sorting?: unknown; search?: unknown }
  const sorting = Array.isArray(s.sorting)
    ? s.sorting.slice(0, 5).filter((x): x is { id: string; desc: boolean } => !!x && typeof (x as any).id === 'string' && (x as any).id.length <= 60).map((x) => ({ id: x.id, desc: !!x.desc }))
    : []
  const search = typeof s.search === 'string' ? s.search.slice(0, 200) : ''
  return { sorting, search }
}

export async function GET(request: NextRequest) {
  const a = await who()
  if (!a) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const table = request.nextUrl.searchParams.get('table') ?? ''
  if (!KEY.test(table)) return NextResponse.json({ error: 'Bad table' }, { status: 400 })
  const { data, error } = await a.admin.from('table_views').select('id, name, state').eq('user_id', a.profile.id).eq('table_key', table).order('name')
  if (error) return NextResponse.json({ error: 'Could not load views' }, { status: 500 })
  return NextResponse.json({ views: data ?? [] })
}

export async function POST(request: NextRequest) {
  const a = await who()
  if (!a) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { table?: unknown; name?: unknown; state?: unknown } | null
  const table = typeof body?.table === 'string' ? body.table : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!KEY.test(table) || name.length < 1 || name.length > 60) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const { data, error } = await a.admin
    .from('table_views')
    .upsert({ org_id: a.profile.org_id, user_id: a.profile.id, table_key: table, name, state: cleanState(body?.state) }, { onConflict: 'user_id,table_key,name' })
    .select('id, name, state')
    .single()
  if (error || !data) return NextResponse.json({ error: 'Could not save the view' }, { status: 500 })
  return NextResponse.json({ view: data })
}

export async function DELETE(request: NextRequest) {
  const a = await who()
  if (!a) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })
  const { error } = await a.admin.from('table_views').delete().eq('id', id).eq('user_id', a.profile.id)
  if (error) return NextResponse.json({ error: 'Could not delete the view' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
