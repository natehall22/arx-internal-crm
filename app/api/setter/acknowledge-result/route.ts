import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { authUser } = await requireAuthApi()
    const supabase = createServiceClient()
    
    const { notification_id } = await request.json()
    
    if (!notification_id) {
      return NextResponse.json({ error: 'notification_id is required' }, { status: 400 })
    }

    // Mark the notification as read
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notification_id)
      .eq('recipient_user_id', authUser.id)

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
