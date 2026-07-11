import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuthApi } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * GET /api/mobile/territories
 * Read-only org territories for ARX Sales (bearer auth).
 */
export async function GET() {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const profile = authContext.profile
    const userId = authContext.authUser.id

    const { data: me } = await admin
      .from('users')
      .select('team_id')
      .eq('id', userId)
      .maybeSingle()

    const { data: territories, error } = await admin
      .from('canvass_territories')
      .select('id, org_id, name, color, boundary_geojson, created_at, updated_at')
      .eq('org_id', profile.org_id)
      .order('name')

    if (error) {
      console.error('mobile territories list', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const ids = (territories || []).map((t) => t.id)
    let assignments: { territory_id: string; user_id: string }[] = []
    let teamAssignments: { territory_id: string; team_id: string }[] = []
    if (ids.length > 0) {
      const [{ data: links }, { data: teamLinks }] = await Promise.all([
        admin
          .from('canvass_territory_users')
          .select('territory_id, user_id')
          .in('territory_id', ids),
        admin
          .from('canvass_territory_teams')
          .select('territory_id, team_id')
          .in('territory_id', ids),
      ])
      assignments = links || []
      teamAssignments = teamLinks || []
    }

    const userTeamId = me?.team_id ?? null

    const payload = (territories || []).map((t) => {
      const assignedUserIds = assignments
        .filter((a) => a.territory_id === t.id)
        .map((a) => a.user_id)
      const assignedTeamIds = teamAssignments
        .filter((a) => a.territory_id === t.id)
        .map((a) => a.team_id)
      const assignedToMe =
        assignedUserIds.includes(userId) ||
        (userTeamId != null && assignedTeamIds.includes(userTeamId))
      return {
        id: t.id,
        name: t.name,
        color: t.color,
        boundary_geojson: t.boundary_geojson,
        assigned_user_ids: assignedUserIds,
        assigned_to_me: assignedToMe,
      }
    })

    return NextResponse.json({ territories: payload })
  } catch (error) {
    console.error('Mobile territories error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load territories' },
      { status: 500 }
    )
  }
}
