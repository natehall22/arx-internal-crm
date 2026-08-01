import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuthApi } from '@/lib/auth'
import {
  fetchOrgAppointmentTypesFromTable,
  getInspectionDurationFromTable,
} from '@/lib/org-appointment-types'

export const dynamic = 'force-dynamic'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

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
    const adminClient = getAdminClient()

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
