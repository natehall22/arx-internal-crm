import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import {
  mergeOrgInspectionOutcomesWithDefaults,
  normalizeInspectionOutcomeId,
  sortInspectionOutcomes,
} from '@/lib/inspection-outcomes'

export const dynamic = 'force-dynamic'

/**
 * GET /api/mobile/org-config
 * Admin-configured lists ARX Sales must mirror: canvass pin types (Admin → Settings →
 * Canvass dispositions) and inspection outcomes. Readable by any signed-in rep —
 * /api/admin/settings is admin-only. Inactive rows are returned (active:false) so records
 * created with a since-retired value keep their label and color; the client hides them from
 * pickers. `dispositions` is null when the org never customised them (client keeps its
 * built-in defaults). Outcomes go through the same default-merge the web uses, so a partial
 * saved list still resolves canonical ids like `sale`.
 */
export async function GET() {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orgId = authContext.profile?.org_id
    if (!orgId) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const { data: org, error } = await createServiceClient()
      .from('orgs')
      .select('settings')
      .eq('id', orgId)
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const raw = org?.settings?.canvass_dispositions
    const dispositions = !Array.isArray(raw) ? null : raw
      .filter((d: any) => d && typeof d.id === 'string' && typeof d.label === 'string')
      .map((d: any, i: number) => ({
        id: d.id,
        label: d.label,
        color: typeof d.color === 'string' ? d.color : '#9CA3AF',
        active: d.active !== false,
        sort_order: Number.isFinite(d.sort_order) ? Math.round(d.sort_order) : i,
      }))
      .sort((a, b) => a.sort_order - b.sort_order)

    const inspection_outcomes = sortInspectionOutcomes(
      mergeOrgInspectionOutcomesWithDefaults(org?.settings?.inspection_outcomes),
      { includeInactive: true }
    ).map((o) => ({
      id: normalizeInspectionOutcomeId(o.id),
      label: o.label,
      color: o.color,
      active: o.active !== false,
    }))

    return NextResponse.json({ dispositions, inspection_outcomes })
  } catch (e) {
    console.error('mobile dispositions', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
