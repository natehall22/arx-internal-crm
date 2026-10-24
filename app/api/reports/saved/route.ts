/**
 * Saved reports. GET lists the ones the viewer made or that are shared with their role.
 * POST { name, spec, shared_roles?, schedule?, schedule_recipients? } saves one. DELETE ?id= removes your own.
 * Scheduled reports are emailed by the 7am cron (lib/reporting/scheduled.ts) as their creator.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { canAccessReportsFromPermissionNames, canExportReportsFromPermissionNames } from '@/lib/permissions'
import { parseSpec } from '@/lib/reporting/report-spec'
import { createServiceClient } from '@/lib/supabase/service'
import { hasFinancials } from '@/lib/financials-access'
import { specTouchesFinancials } from '@/lib/reporting/templates'

export const dynamic = 'force-dynamic'
const SCHEDULES = ['daily', 'weekly_mon', 'monthly_1']
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

async function authorize() {
  try {
    const { profile } = await requireAuthApi()
    const admin = createServiceClient()
    const perms = await resolveEffectivePermissionNames(admin, profile.id, profile)
    if (!canAccessReportsFromPermissionNames(perms)) return null
    return { profile, admin, canExport: canExportReportsFromPermissionNames(perms) }
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const a = await authorize()
  if (!a) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const dashboardOnly = request.nextUrl.searchParams.get('dashboard') === 'true'
  let query = a.admin
    .from('saved_reports')
    .select('id, name, spec, shared_roles, schedule, dashboard_widget, created_by, created_at')
    .eq('org_id', a.profile.org_id)
  // Pinning is personal: a tile on MY dashboard is one I made, never one shared to my role.
  if (dashboardOnly) query = query.eq('dashboard_widget', true).eq('created_by', a.profile.id)
  const { data, error } = await query
    .or(`created_by.eq.${a.profile.id},shared_roles.cs.{${String(a.profile.role).replace(/[^a-z_]/gi, '')}}`)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'Could not load saved reports' }, { status: 500 })
  return NextResponse.json({ reports: data ?? [], me: a.profile.id })
}

export async function POST(request: NextRequest) {
  const a = await authorize()
  if (!a) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = (await request.json().catch(() => null)) as Record<string, any> | null
  const name = typeof b?.name === 'string' ? b.name.trim().slice(0, 120) : ''
  if (!name) return NextResponse.json({ error: 'Give the report a name' }, { status: 400 })
  const parsed = parseSpec(b?.spec)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  // You cannot save (or schedule) a report you could not run yourself.
  if (specTouchesFinancials(parsed.spec) && !hasFinancials(await resolveEffectivePermissionNames(a.admin, a.profile.id, a.profile))) {
    return NextResponse.json({ error: 'That report uses financial figures, which your role cannot see.' }, { status: 400 })
  }
  const schedule = SCHEDULES.includes(b?.schedule) ? b!.schedule : null
  const recipients: string[] = Array.isArray(b?.schedule_recipients)
    ? b!.schedule_recipients.map((e: unknown) => String(e).trim().toLowerCase()).filter(Boolean)
    : []
  if (!recipients.every((e) => EMAIL.test(e))) return NextResponse.json({ error: 'A recipient email is not valid' }, { status: 400 })
  if (schedule && !a.canExport) return NextResponse.json({ error: 'Emailing a report needs the export permission' }, { status: 403 })
  if (recipients.length > 0) {
    // Scheduled reports only go to people in the company.
    const { data: staff } = await a.admin.from('users').select('email').eq('org_id', a.profile.org_id).eq('active', true).in('email', recipients)
    const known = new Set((staff ?? []).map((u: { email: string | null }) => String(u.email).toLowerCase()))
    if (!recipients.every((e) => known.has(e))) return NextResponse.json({ error: 'Reports can only be emailed to active team members' }, { status: 400 })
  }
  if (schedule && recipients.length === 0) return NextResponse.json({ error: 'Add at least one email to send it to' }, { status: 400 })
  const roles: string[] = Array.isArray(b?.shared_roles) ? b!.shared_roles.map((r: unknown) => String(r).toLowerCase().replace(/[^a-z_]/g, '')).filter(Boolean) : []
  const { data, error } = await a.admin
    .from('saved_reports')
    .insert({ org_id: a.profile.org_id, name, spec: parsed.spec, shared_roles: roles, schedule, schedule_recipients: recipients.slice(0, 10), dashboard_widget: b?.dashboard_widget === true, created_by: a.profile.id })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: 'Could not save the report' }, { status: 500 })
  return NextResponse.json({ id: data.id })
}

export async function DELETE(request: NextRequest) {
  const a = await authorize()
  if (!a) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { error } = await a.admin.from('saved_reports').delete().eq('id', id).eq('org_id', a.profile.org_id).eq('created_by', a.profile.id)
  if (error) return NextResponse.json({ error: 'Could not delete' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
