import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { prompt_id } = body

    if (!prompt_id) {
      return NextResponse.json({ error: 'Missing prompt_id' }, { status: 400 })
    }

    // Mark prompt as dismissed
    const { error } = await supabase
      .from('pending_status_prompts')
      .update({ dismissed: true })
      .eq('id', prompt_id)
      .eq('closer_user_id', user.id)

    if (error) {
      console.error('Dismiss prompt error:', error)
      return NextResponse.json({ error: 'Failed to dismiss prompt' }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Dismiss prompt error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
