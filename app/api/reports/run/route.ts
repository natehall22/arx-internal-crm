/**
 * POST { template?: string, spec?: ReportSpec-ish, format?: 'json' | 'csv' }
 * Runs a report through lib/reporting/run.ts (org fence + role scope + finance-only fields).
 * CSV needs the reports:export permission.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { canAccessReportsFromPermissionNames } from '@/lib/permissions'
import { DATASETS } from '@/lib/reporting/catalog'
import { ReportAccessError, buildReportContext, resultToCsv, runReport, visibleColumns } from '@/lib/reporting/run'
import { parseSpec } from '@/lib/reporting/report-spec'
import { REPORT_TEMPLATES, templateByKey } from '@/lib/reporting/templates'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  const perms = await resolveEffectivePermissionNames(admin, profile.id, profile)
  if (!canAccessReportsFromPermissionNames(perms)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const tpl = typeof body?.template === 'string' ? templateByKey(body.template) : undefined
  const parsed = parseSpec(body?.spec ?? tpl?.spec)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const ctx = await buildReportContext(admin, profile)
  if (body?.format === 'csv' && !ctx.canExport) return NextResponse.json({ error: 'Not authorized to export reports' }, { status: 403 })

  try {
    const result = await runReport(admin, ctx, parsed.spec)
    if (body?.format === 'csv') {
      return new NextResponse(resultToCsv(result), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${(tpl?.key ?? parsed.spec.dataset).replace(/[^a-z0-9_-]/gi, '')}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    return NextResponse.json({ spec: parsed.spec, result, canExport: ctx.canExport, finance: ctx.finance })
  } catch (error) {
    if (error instanceof ReportAccessError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[reports/run] failed', error)
    return NextResponse.json({ error: 'Could not run the report' }, { status: 500 })
  }
}

/** GET — what this viewer can pick from: templates, datasets (finance-only columns removed), export right. */
export async function GET() {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  const perms = await resolveEffectivePermissionNames(admin, profile.id, profile)
  if (!canAccessReportsFromPermissionNames(perms)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ctx = await buildReportContext(admin, profile)
  const datasets = Object.values(DATASETS)
    .filter((d) => ctx.finance || (!d.financeOnly && (d.ownerColumn || ctx.scope === 'all')))
    .map((d) => ({ key: d.key, label: d.label, description: d.description, columns: visibleColumns(ctx, d) }))
  const allowed = new Set(datasets.map((d) => d.key))
  const templates = REPORT_TEMPLATES.filter((t) => (ctx.finance || !t.finance) && allowed.has(t.spec.dataset))
  return NextResponse.json({ templates, datasets, canExport: ctx.canExport, finance: ctx.finance, scope: ctx.scope })
}
