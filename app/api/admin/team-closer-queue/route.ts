import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Add closer to queue
export async function POST(request: NextRequest) {
  try {
    const { profile } = await requireAuth()
    const adminClient = getAdminClient()
    
    const body = await request.json()
    const { team_id, user_id, buffer_minutes = 60 } = body
    
    if (!team_id || !user_id) {
      return NextResponse.json({ error: 'team_id and user_id are required' }, { status: 400 })
    }
    
    // Get current max priority
    const { data: existingQueue } = await adminClient
      .from('team_closer_queue')
      .select('priority')
      .eq('team_id', team_id)
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
        buffer_minutes,
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
    await requireAuth()
    const adminClient = getAdminClient()
    
    const { searchParams } = new URL(request.url)
    const queueId = searchParams.get('id')
    
    if (!queueId) {
      return NextResponse.json({ error: 'Queue entry id is required' }, { status: 400 })
    }
    
    const { error } = await adminClient
      .from('team_closer_queue')
      .delete()
      .eq('id', queueId)
    
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
    await requireAuth()
    const adminClient = getAdminClient()
    
    const body = await request.json()
    const { id, active, buffer_minutes, priority } = body
    
    if (!id) {
      return NextResponse.json({ error: 'Queue entry id is required' }, { status: 400 })
    }
    
    const updateData: any = {}
    if (active !== undefined) updateData.active = active
    if (buffer_minutes !== undefined) updateData.buffer_minutes = buffer_minutes
    if (priority !== undefined) updateData.priority = priority
    
    const { error } = await adminClient
      .from('team_closer_queue')
      .update(updateData)
      .eq('id', id)
    
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
