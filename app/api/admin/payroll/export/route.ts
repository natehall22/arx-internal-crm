import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { computePayrollExportRowsForDateRange } from '@/lib/payroll-period-export-engine'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    let profile
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isPayrollAdminRole(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (!from || !to || from.length < 8 || to.length < 8) {
      return NextResponse.json(
        { error: 'Query params "from" and "to" are required (YYYY-MM-DD).' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const orgId = profile.org_id

    let rows
    try {
      rows = await computePayrollExportRowsForDateRange(supabase, orgId, from, to)
    } catch (e) {
      console.error('payroll export compute', e)
      return NextResponse.json({ error: 'Failed to compute payroll export' }, { status: 500 })
    }

    const format = searchParams.get('format')
    if (format === 'csv') {
      const header = [
        'job_number',
        'customer_name',
        'sale_date',
        'address',
        'sale_amount',
        'commission_comp_base',
        'pool_cap',
        'user_id',
        'user_name',
        'participant_role',
        'comp_plan_name',
        'plan_type',
        'base_rate_pct',
        'period_volume',
        'volume_bonus_rate_pct',
        'volume_bonus_flat',
        'effective_rate_pct',
        'raw_commission',
        'scaled_commission',
        'pool_cap_enforced',
        'unsupported_plan',
        'note',
      ]
      const lines = [
        header.join(','),
        ...rows.map((r) =>
          [
            r.job_number,
            `"${(r.customer_name || '').replace(/"/g, '""')}"`,
            r.sale_date ?? '',
            `"${(r.address_text || '').replace(/"/g, '""')}"`,
            r.sale_amount ?? '',
            r.commission_comp_base ?? '',
            r.pool_cap ?? '',
            r.user_id,
            `"${(r.user_name || '').replace(/"/g, '""')}"`,
            r.participant_role,
            `"${(r.comp_plan_name || '').replace(/"/g, '""')}"`,
            r.plan_type ?? '',
            r.base_rate_pct ?? '',
            r.period_volume,
            r.volume_bonus_rate_pct,
            r.volume_bonus_flat,
            r.effective_rate_pct ?? '',
            r.raw_commission,
            r.scaled_commission,
            r.pool_cap_enforced,
            r.unsupported_plan,
            `"${(r.note || '').replace(/"/g, '""')}"`,
          ].join(',')
        ),
      ]
      return new NextResponse(lines.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="payroll-export-${from}-to-${to}.csv"`,
        },
      })
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      orgId,
      from,
      to,
      rowCount: rows.length,
      rows,
    })
  } catch (e) {
    console.error('GET /api/admin/payroll/export', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
