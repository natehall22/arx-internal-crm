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

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth()
    const supabase = getAdminClient()
    
    const { notification_id } = await request.json()
    
    if (!notification_id) {
      return NextResponse.json({ error: 'notification_id is required' }, { status: 400 })
    }

    // Mark the notification as read
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notification_id)
      .eq('recipient_user_id', user.id)

    if (error) {
      console.error('Error acknowledging notification:', error)
      return NextResponse.json({ error: 'Failed to acknowledge' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Acknowledge result error:', error)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
