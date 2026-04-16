import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isValidBoundaryGeoJSON } from '@/lib/canvass-territory-geometry'
import { isCanvassTerritoryAssigneeEligible } from '@/lib/canvass-territory-assignee-filter'
import { CANVASS_TERRITORY_MANAGER_ROLES } from '@/lib/canvass-territory-manager-roles'

export const dynamic = 'force-dynamic'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`

  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      return JSON.parse(decodeURIComponent(singleCookie.value))
    } catch {
      return null
    }
  }

  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i++
  }

  if (chunks.length > 0) {
    try {
      return JSON.parse(decodeURIComponent(chunks.join('')))
    } catch {
      return null
    }
  }

  return null
}

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sessionData = getSessionFromRequest(req)

  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: sessionData?.access_token
        ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
        : undefined,
    }),
    accessToken: sessionData?.access_token,
  }
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireManager(req: NextRequest) {
  const { client: authClient, accessToken } = getAuthClient(req)
  if (!accessToken) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const { data: { user } } = await authClient.auth.getUser(accessToken)
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()
  if (!profile || !CANVASS_TERRITORY_MANAGER_ROLES.includes(profile.role as (typeof CANVASS_TERRITORY_MANAGER_ROLES)[number])) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { user, profile, admin }
}

export async function GET(request: NextRequest) {
  const gate = await requireManager(request)
  if ('error' in gate) return gate.error
  const { profile, admin } = gate

  const { data: territories, error } = await admin
    .from('canvass_territories')
    .select('id, org_id, name, color, boundary_geojson, created_at, updated_at')
    .eq('org_id', profile.org_id)
    .order('name')

  if (error) {
    console.error('canvass_territories list', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const ids = (territories || []).map((t) => t.id)
  let assignments: { territory_id: string; user_id: string }[] = []
  let teamAssignments: { territory_id: string; team_id: string }[] = []
  if (ids.length > 0) {
    const [{ data: links }, { data: teamLinks }] = await Promise.all([
      admin.from('canvass_territory_users').select('territory_id, user_id').in('territory_id', ids),
      admin.from('canvass_territory_teams').select('territory_id, team_id').in('territory_id', ids),
    ])
    assignments = links || []
    teamAssignments = teamLinks || []
  }

  const withUsers = (territories || []).map((t) => ({
    ...t,
    user_ids: assignments.filter((a) => a.territory_id === t.id).map((a) => a.user_id),
    team_ids: teamAssignments.filter((a) => a.territory_id === t.id).map((a) => a.team_id),
  }))

  return NextResponse.json({ territories: withUsers })
}

export async function POST(request: NextRequest) {
  const gate = await requireManager(request)
  if ('error' in gate) return gate.error
  const { profile, admin } = gate

  const body = await request.json()
  const { name, color, boundary_geojson, user_ids, team_ids } = body as {
    name?: string
    color?: string
    boundary_geojson?: unknown
    user_ids?: string[]
    team_ids?: string[]
  }

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!isValidBoundaryGeoJSON(boundary_geojson)) {
    return NextResponse.json({ error: 'boundary_geojson must be a valid Polygon or MultiPolygon' }, { status: 400 })
  }

  const { data: row, error: insertErr } = await admin
    .from('canvass_territories')
    .insert({
      org_id: profile.org_id,
      name: name.trim(),
      color: typeof color === 'string' && color ? color : '#6366F1',
      boundary_geojson,
    })
    .select('id, org_id, name, color, boundary_geojson, created_at, updated_at')
    .single()

  if (insertErr || !row) {
    console.error('canvass_territories insert', insertErr)
    return NextResponse.json({ error: insertErr?.message || 'Insert failed' }, { status: 500 })
  }

  const uids = Array.isArray(user_ids) ? user_ids.filter((x): x is string => typeof x === 'string') : []
  let savedUserIds: string[] = []
  if (uids.length > 0) {
    const { data: validUsers } = await admin
      .from('users')
      .select('id, dashboard_view, role')
      .eq('org_id', profile.org_id)
      .in('id', uids)
    const ok = new Set(
      (validUsers || [])
        .filter((u) => isCanvassTerritoryAssigneeEligible(u))
        .map((u) => u.id)
    )
    const rows = uids.filter((id) => ok.has(id)).map((user_id) => ({
      territory_id: row.id,
      user_id,
    }))
    savedUserIds = rows.map((r) => r.user_id)
    if (rows.length > 0) {
      await admin.from('canvass_territory_users').insert(rows)
    }
  }

  const tids = Array.isArray(team_ids) ? team_ids.filter((x): x is string => typeof x === 'string') : []
  let savedTeamIds: string[] = []
  if (tids.length > 0) {
    const { data: validTeams } = await admin
      .from('teams')
      .select('id')
      .eq('org_id', profile.org_id)
      .in('id', tids)
    const okTeams = new Set((validTeams || []).map((t) => t.id))
    savedTeamIds = tids.filter((id) => okTeams.has(id))
    const trows = savedTeamIds.map((team_id) => ({ territory_id: row.id, team_id }))
    if (trows.length > 0) {
      await admin.from('canvass_territory_teams').insert(trows)
    }
  }

  return NextResponse.json({ territory: { ...row, user_ids: savedUserIds, team_ids: savedTeamIds } })
}
