import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'

/**
 * Latest crews + active subs for schedule/reassign modals (job board & job detail).
 * Lets modals pick up new subs/crews without a full page reload.
 */
export async function GET() {
  try {
    const { authUser, profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const { canJobBoard } = await resolveOpsAccess(supabase, authUser.id, profile)
    if (!canJobBoard) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [crewsRes, subsRes] = await Promise.all([
      supabase
        .from('crews')
        .select('id, name, crew_type, color, daily_capacity')
        .eq('org_id', profile.org_id)
        .eq('active', true)
        .order('name'),
      supabase
        .from('sub_contractors')
        .select('id, company_name, services')
        .eq('org_id', profile.org_id)
        .eq('active', true)
        .order('company_name'),
    ])

    if (crewsRes.error) {
      console.error('[scheduling-assignees] crews:', crewsRes.error)
      return NextResponse.json({ error: 'Failed to load crews' }, { status: 500 })
    }
    if (subsRes.error) {
      console.error('[scheduling-assignees] subs:', subsRes.error)
      return NextResponse.json({ error: 'Failed to load subcontractors' }, { status: 500 })
    }

    return NextResponse.json({
      crews: crewsRes.data ?? [],
      subs: subsRes.data ?? [],
    })
  } catch (e) {
    console.error('[scheduling-assignees]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
