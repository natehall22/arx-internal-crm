import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // RLS-bound client: this route's reads/writes rely on the org policies on the
    // tables below, so it must stay the caller's client rather than a service client.
    const supabase = createClient()

    const unreadOnly = request.nextUrl.searchParams.get('unread') === 'true'
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20')

    let query = supabase
      .from('notifications')
      .select('*')
      .eq('recipient_user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (unreadOnly) {
      query = query.is('read_at', null)
    }

    const { data: notifications, error } = await query

    if (error) {
      console.error('Notifications query error:', error)
      return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
    }

    // Get unread count
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', profile.id)
      .is('read_at', null)

    return NextResponse.json({ 
      notifications: notifications || [],
      unread_count: count || 0,
    })

  } catch (error) {
    console.error('Notifications error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Mark notifications as read
export async function PATCH(request: NextRequest) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // RLS-bound client: this route's reads/writes rely on the org policies on the
    // tables below, so it must stay the caller's client rather than a service client.
    const supabase = createClient()

    const body = await request.json()
    const { notification_ids, mark_all } = body

    if (mark_all) {
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_user_id', profile.id)
        .is('read_at', null)
    } else if (notification_ids && notification_ids.length > 0) {
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_user_id', profile.id)
        .in('id', notification_ids)
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Mark read error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
