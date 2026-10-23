import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { FILE_TABS } from '@/lib/customer-file/access'
import { createServiceClient } from '@/lib/supabase/service'

/** Remember the last Customer File tab per person (users.ui_prefs.fileTab). */
export async function POST(request: Request) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const tab = String(body?.fileTab ?? '')
  if (!(FILE_TABS as readonly string[]).includes(tab) || tab === 'notes') return NextResponse.json({ error: 'Bad tab' }, { status: 400 })
  const admin = createServiceClient()
  const prefs = { ...((profile as { ui_prefs?: Record<string, unknown> | null }).ui_prefs ?? {}), fileTab: tab }
  const { error } = await admin.from('users').update({ ui_prefs: prefs }).eq('id', profile.id)
  return error ? NextResponse.json({ ok: false }) : NextResponse.json({ ok: true })
}
