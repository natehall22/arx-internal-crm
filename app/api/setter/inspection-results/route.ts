import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET() {
  try {
    const { authUser } = await requireAuthApi()
    const supabase = getAdminClient()

    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_user_id', authUser.id)
      .eq('type', 'inspection_outcome')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      console.error('Error fetching setter notifications:', error)
      return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 })
    }

    return NextResponse.json({ results: notifications || [] })
  } catch (error) {
    console.error('Setter inspection results error:', error)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
