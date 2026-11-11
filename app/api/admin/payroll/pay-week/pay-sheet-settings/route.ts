/**
 * GET / POST — the pay sheet's look and words (settings.paySheet): colors, "show how each line was worked out", and plain-word pay-type
 * labels (e.g. { "sales_rep": "Sales Commission", "setter_manager_override": "Ownership Draw" }). Owners save; payroll admins read.
 */
import { NextRequest, NextResponse } from 'next/server'

import { mergeOrgSettings } from '@/lib/org-settings'
import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { PAY_SHEET_SETTINGS_KEY, readPaySheetSettings } from '@/lib/payroll-pay-sheet'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const { data } = await a.admin.from('orgs').select('settings').eq('id', a.profile.org_id).maybeSingle()
  return NextResponse.json({ ...readPaySheetSettings(data?.settings), canEdit: isSuperAdmin(a.profile) })
}

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  if (!isSuperAdmin(a.profile)) return NextResponse.json({ error: 'Only an owner can change the pay sheet.', code: 'owner_only' }, { status: 403 })
  const b = await request.json().catch(() => null)
  const clean = readPaySheetSettings({ [PAY_SHEET_SETTINGS_KEY]: b })
  const { error } = await mergeOrgSettings(a.admin, a.profile.org_id, { colors: clean.colors, showMath: clean.showMath, labels: clean.labels }, { path: [PAY_SHEET_SETTINGS_KEY] })
  if (error) {
    console.error('pay-sheet settings', error)
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, ...clean })
}
