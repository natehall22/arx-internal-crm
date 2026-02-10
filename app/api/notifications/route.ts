import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const unreadOnly = request.nextUrl.searchParams.get('unread') === 'true'
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20')

    let query = supabase
      .from('notifications')
      .select('*')
      .eq('recipient_user_id', user.id)
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
      .eq('recipient_user_id', user.id)
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
    const supabase = createServerClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { notification_ids, mark_all } = body

    if (mark_all) {
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_user_id', user.id)
        .is('read_at', null)
    } else if (notification_ids && notification_ids.length > 0) {
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_user_id', user.id)
        .in('id', notification_ids)
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Mark read error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
