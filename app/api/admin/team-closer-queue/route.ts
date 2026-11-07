import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isTeamAdminRoleSlug } from '@/lib/org-role-constants'

export const dynamic = 'force-dynamic'

/**
 * Same gate as the teams page's data (`/api/admin/data`): only team admins, and only rows of their own org
 * (security audit C4, 2026-11-07 — PUT/DELETE used to accept any signed-in user and any queue id).
 */
async function teamAdmin(): Promise<{ profile: { org_id: string; role: string } } | NextResponse> {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!profile.org_id || !isTeamAdminRoleSlug(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { profile: { org_id: profile.org_id, role: profile.role } }
}

async function teamInOrg(adminClient: ReturnType<typeof createServiceClient>, teamId: string, orgId: string) {
  const { data } = await adminClient.from('teams').select('id').eq('id', teamId).eq('org_id', orgId).maybeSingle()
  return !!data
}

// Get queue for a team
export async function GET(request: NextRequest) {
  try {
    const auth = await teamAdmin()
    if (auth instanceof NextResponse) return auth
    const { profile } = auth
    const adminClient = createServiceClient()

    const { searchParams } = new URL(request.url)
    const teamId = searchParams.get('team_id')

    if (!teamId) {
      return NextResponse.json({ error: 'team_id is required' }, { status: 400 })
    }

    const { data: queueData, error } = await adminClient
      .from('team_closer_queue')
      .select('*, users(*)')
      .eq('team_id', teamId)
      .eq('org_id', profile.org_id)
      .order('priority')

    if (error) {
      console.error('Failed to fetch queue:', error)
      return NextResponse.json({ error: 'Failed to fetch queue' }, { status: 500 })
    }

    return NextResponse.json({
      queue: queueData || [],
      canEditBuffers: profile.role === 'admin',
    })
  } catch (error) {
    console.error('Team closer queue GET error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// Add closer to queue
export async function POST(request: NextRequest) {
  try {
    const auth = await teamAdmin()
    if (auth instanceof NextResponse) return auth
    const { profile } = auth
    const adminClient = createServiceClient()

    const body = await request.json()
    const isAdmin = profile.role === 'admin'
    const {
      team_id,
      user_id,
      buffer_minutes = 30,
      buffer_before = 0,
      buffer_after = 15,
    } = body

    if (!team_id || !user_id) {
      return NextResponse.json({ error: 'team_id and user_id are required' }, { status: 400 })
    }

    const { data: closer } = await adminClient
      .from('users')
      .select('id')
      .eq('id', user_id)
      .eq('org_id', profile.org_id)
      .maybeSingle()
    if (!closer || !(await teamInOrg(adminClient, team_id, profile.org_id))) {
      return NextResponse.json({ error: 'Team or user not found' }, { status: 404 })
    }

    // Get current max priority
    const { data: existingQueue } = await adminClient
      .from('team_closer_queue')
      .select('priority')
      .eq('team_id', team_id)
      .eq('org_id', profile.org_id)
      .order('priority', { ascending: false })
      .limit(1)

    const nextPriority = existingQueue && existingQueue.length > 0
      ? (existingQueue[0].priority || 0) + 1
      : 0

    const { data, error } = await adminClient
      .from('team_closer_queue')
      .insert({
        org_id: profile.org_id,
        team_id,
        user_id,
        priority: nextPriority,
        // Only admins can set custom buffer values on creation.
        buffer_minutes: isAdmin ? buffer_minutes : 30,
        buffer_before: isAdmin ? buffer_before : 0,
        buffer_after: isAdmin ? buffer_after : 15,
        active: true,
      })
      .select()
      .single()

    if (error) {
      console.error('Failed to add closer to queue:', error)
      return NextResponse.json({ error: 'Failed to add closer' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Team closer queue POST error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// Remove closer from queue
export async function DELETE(request: NextRequest) {
  try {
    const auth = await teamAdmin()
    if (auth instanceof NextResponse) return auth
    const { profile } = auth
    const adminClient = createServiceClient()

    const { searchParams } = new URL(request.url)
    const queueId = searchParams.get('id')

    if (!queueId) {
      return NextResponse.json({ error: 'Queue entry id is required' }, { status: 400 })
    }

    const { error } = await adminClient
      .from('team_closer_queue')
      .delete()
      .eq('id', queueId)
      .eq('org_id', profile.org_id)

    if (error) {
      console.error('Failed to remove closer from queue:', error)
      return NextResponse.json({ error: 'Failed to remove closer' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Team closer queue DELETE error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// Update closer in queue (active status, buffer, priority)
export async function PUT(request: NextRequest) {
  try {
    const auth = await teamAdmin()
    if (auth instanceof NextResponse) return auth
    const { profile } = auth
    const adminClient = createServiceClient()

    const body = await request.json()
    const { id, active, buffer_minutes, buffer_before, buffer_after, priority } = body

    if (!id) {
      return NextResponse.json({ error: 'Queue entry id is required' }, { status: 400 })
    }

    const isTryingToEditBuffers =
      buffer_minutes !== undefined || buffer_before !== undefined || buffer_after !== undefined
    if (isTryingToEditBuffers && profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can edit buffer settings' }, { status: 403 })
    }

    const updateData: Record<string, unknown> = {}
    if (active !== undefined) updateData.active = active
    if (buffer_minutes !== undefined) updateData.buffer_minutes = buffer_minutes
    if (buffer_before !== undefined) updateData.buffer_before = buffer_before
    if (buffer_after !== undefined) updateData.buffer_after = buffer_after
    if (priority !== undefined) updateData.priority = priority

    const { error } = await adminClient
      .from('team_closer_queue')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', profile.org_id)

    if (error) {
      console.error('Failed to update closer in queue:', error)
      return NextResponse.json({ error: 'Failed to update closer' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Team closer queue PUT error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
