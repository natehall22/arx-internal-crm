import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import {
  fetchOrgAppointmentTypesFromTable,
  getInspectionDurationFromTable,
} from '@/lib/org-appointment-types'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/canvass/scheduling-meta
 * Lightweight teams + inspection duration for mobile canvass scheduling (round-robin slots).
 */
export async function GET() {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { profile } = authContext
    const adminClient = createServiceClient()

    const { data: teams, error: teamsError } = await adminClient
      .from('teams')
      .select('id, name')
      .eq('org_id', profile.org_id)
      .order('name', { ascending: true })

    if (teamsError) {
      console.error('Canvass scheduling-meta teams error:', teamsError)
      return NextResponse.json({ error: 'Failed to load teams' }, { status: 500 })
    }

    const appointmentTypeRows = await fetchOrgAppointmentTypesFromTable(adminClient, profile.org_id)
    const inspectionDuration = getInspectionDurationFromTable(appointmentTypeRows, 60)

    return NextResponse.json({
      teams: teams || [],
      inspection_duration: inspectionDuration,
      user_team_id: profile.team_id ?? null,
    })
  } catch (error) {
    console.error('Canvass scheduling-meta error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load scheduling meta' },
      { status: 500 }
    )
  }
}
