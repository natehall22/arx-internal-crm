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

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const gate = await requireManager(request)
  if ('error' in gate) return gate.error
  const { profile, admin } = gate
  const id = params.id

  const { data: existing } = await admin
    .from('canvass_territories')
    .select('id')
    .eq('id', id)
    .eq('org_id', profile.org_id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await request.json()
  const { name, color, boundary_geojson, user_ids, team_ids } = body as {
    name?: string
    color?: string
    boundary_geojson?: unknown
    user_ids?: string[]
    team_ids?: string[]
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    }
    updates.name = name.trim()
  }
  if (color !== undefined) {
    updates.color = typeof color === 'string' && color ? color : '#6366F1'
  }
  if (boundary_geojson !== undefined) {
    if (!isValidBoundaryGeoJSON(boundary_geojson)) {
      return NextResponse.json({ error: 'boundary_geojson must be a valid Polygon or MultiPolygon' }, { status: 400 })
    }
    updates.boundary_geojson = boundary_geojson
  }

  const { data: row, error: upErr } = await admin
    .from('canvass_territories')
    .update(updates)
    .eq('id', id)
    .eq('org_id', profile.org_id)
    .select('id, org_id, name, color, boundary_geojson, created_at, updated_at')
    .single()

  if (upErr) {
    console.error('canvass_territories patch', upErr)
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  if (user_ids !== undefined) {
    await admin.from('canvass_territory_users').delete().eq('territory_id', id)
    const uids = Array.isArray(user_ids) ? user_ids.filter((x): x is string => typeof x === 'string') : []
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
      const rows = uids.filter((uid) => ok.has(uid)).map((user_id) => ({
        territory_id: id,
        user_id,
      }))
      if (rows.length > 0) {
        await admin.from('canvass_territory_users').insert(rows)
      }
    }
  }

  if (team_ids !== undefined) {
    await admin.from('canvass_territory_teams').delete().eq('territory_id', id)
    const tids = Array.isArray(team_ids) ? team_ids.filter((x): x is string => typeof x === 'string') : []
    if (tids.length > 0) {
      const { data: validTeams } = await admin
        .from('teams')
        .select('id')
        .eq('org_id', profile.org_id)
        .in('id', tids)
      const okTeams = new Set((validTeams || []).map((t) => t.id))
      const trows = tids.filter((tid) => okTeams.has(tid)).map((team_id) => ({
        territory_id: id,
        team_id,
      }))
      if (trows.length > 0) {
        await admin.from('canvass_territory_teams').insert(trows)
      }
    }
  }

  const [{ data: links }, { data: teamLinks }] = await Promise.all([
    admin.from('canvass_territory_users').select('user_id').eq('territory_id', id),
    admin.from('canvass_territory_teams').select('team_id').eq('territory_id', id),
  ])

  return NextResponse.json({
    territory: {
      ...row,
      user_ids: (links || []).map((l) => l.user_id),
      team_ids: (teamLinks || []).map((l) => l.team_id),
    },
  })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const gate = await requireManager(request)
  if ('error' in gate) return gate.error
  const { profile, admin } = gate
  const id = params.id

  const { error } = await admin
    .from('canvass_territories')
    .delete()
    .eq('id', id)
    .eq('org_id', profile.org_id)

  if (error) {
    console.error('canvass_territories delete', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
