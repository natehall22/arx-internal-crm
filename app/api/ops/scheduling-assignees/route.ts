import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'

/**
 * Latest active subs for schedule/reassign modals (job board & job detail).
 * Lets modals pick up new subs without a full page reload.
 *
 * ARX is a subcontractor-only shop (no in-house crews — see CLAUDE.md), so this no longer
 * queries or returns `crews`. The `crews` table and `assigned_crew_id` column are untouched
 * (schema changes must stay additive on a live system); this route just stops writing/serving
 * the retired crew-assignment path.
 */
export async function GET() {
  try {
    const { authUser, profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const { canJobBoard } = await resolveOpsAccess(supabase, authUser.id, profile)
    if (!canJobBoard) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const subsRes = await supabase
      .from('sub_contractors')
      .select('id, company_name, services')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .order('company_name')

    if (subsRes.error) {
      console.error('[scheduling-assignees] subs:', subsRes.error)
      return NextResponse.json({ error: 'Failed to load subcontractors' }, { status: 500 })
    }

    return NextResponse.json({
      subs: subsRes.data ?? [],
    })
  } catch (e) {
    console.error('[scheduling-assignees]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
