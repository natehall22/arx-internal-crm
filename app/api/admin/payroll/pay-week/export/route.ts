/**
 * GET  ?period=id&format=gusto|adp — the approved week for the payroll provider (CSV). Pay sheets are pay-week/pay-sheet.
 *      Approved weeks only: the file is built from the stored lines. Returns 409 with `missing` (people without an ADP file number…)
 *      as JSON when `check=1`, so the screen can ask for them before downloading.
 * POST { coCode, codes, advance } — the ADP company code, earning codes and how advance repayments are mapped (owners; settings.payrollExport).
 */
import { NextRequest, NextResponse } from 'next/server'

import { mergeOrgSettings } from '@/lib/org-settings'
import { loadOffCheckRepaid } from '@/lib/payroll-advances-db'
import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { isUuid, loadPayWeek } from '@/lib/payroll-pay-week'
import { buildProviderExport, PAYROLL_EXPORT_SETTINGS_KEY, readAdpSettings, type ExportPerson } from '@/lib/payroll-provider-export'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const sp = request.nextUrl.searchParams
  const periodId = sp.get('period')
  const format = sp.get('format')
  if (!isUuid(periodId) || (format !== 'gusto' && format !== 'adp')) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const orgId = a.profile.org_id
  try {
    const week = await loadPayWeek(a.admin, orgId, new Date(), periodId)
    if (week.state !== 'approved') return NextResponse.json({ error: 'Approve the week first. The file is built from the approved numbers.', code: 'not_approved' }, { status: 409 })
    const ids = week.people.map((p) => p.userId)
    const { data: users } = ids.length ? await a.admin.from('users').select('id, full_name, email, payroll_employee_id').eq('org_id', orgId).in('id', ids) : { data: [] }
    const people = new Map<string, ExportPerson>()
    for (const u of users ?? []) {
      const full = String(u.full_name ?? '').trim()
      const cut = full.lastIndexOf(' ')
      people.set(u.id as string, { userId: u.id as string, firstName: cut > 0 ? full.slice(0, cut) : full, lastName: cut > 0 ? full.slice(cut + 1) : '', email: (u.email as string | null) ?? null, employeeId: (u.payroll_employee_id as string | null) ?? null })
    }
    const { data: org } = await a.admin.from('orgs').select('settings').eq('id', orgId).maybeSingle()
    let out
    try {
      out = buildProviderExport({ provider: format, week, people, adp: readAdpSettings(org?.settings), offCheckRepaid: await loadOffCheckRepaid(a.admin, orgId, periodId) })
    } catch (e) {
      // The file would not equal the approved pay: refuse rather than hand the provider a different number.
      return NextResponse.json({ error: (e as Error).message, code: 'does_not_tie' }, { status: 409 })
    }
    if (sp.get('check') === '1') return NextResponse.json({ people: out.people, total: out.total, missing: out.missing, adp: readAdpSettings(org?.settings) })
    return new NextResponse(out.csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('GET pay-week export', e)
    return NextResponse.json({ error: 'Could not build the file' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  if (!isSuperAdmin(a.profile)) return NextResponse.json({ error: 'Only an owner can change the export codes.', code: 'owner_only' }, { status: 403 })
  const b = (await request.json().catch(() => null)) as { coCode?: unknown; codes?: Record<string, unknown>; advance?: Record<string, unknown> } | null
  const clean = readAdpSettings({ [PAYROLL_EXPORT_SETTINGS_KEY]: { coCode: b?.coCode, codes: b?.codes, advance: b?.advance } })
  const { error } = await mergeOrgSettings(a.admin, a.profile.org_id, { coCode: clean.coCode, codes: clean.codes, advance: clean.advance }, { path: [PAYROLL_EXPORT_SETTINGS_KEY] })
  if (error) {
    console.error('pay-week export settings', error)
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, adp: clean })
}
