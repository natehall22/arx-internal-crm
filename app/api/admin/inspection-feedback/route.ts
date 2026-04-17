import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'
import { isPromptDue } from '@/lib/inspection-feedback-prompt'

export async function GET() {
  try {
    const { profile } = await requireAuthApi()

    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const supabase = createServiceClient()

    // Get all unresolved feedback prompts.
    // Include dismissed/snoozed prompts so "Later" still appears as not completed in admin.
    const { data: pending, error: pendingError } = await supabase
      .from('pending_status_prompts')
      .select(`
        *,
        closer:users!pending_status_prompts_closer_user_id_fkey(full_name),
        appointment:scheduled_appointments(
          scheduled_for,
          lead:leads(homeowner_name, address_text)
        )
      `)
      .eq('org_id', profile.org_id)
      .eq('completed', false)
      .order('prompt_at', { ascending: true })

    if (pendingError) {
      console.error('Error fetching pending:', pendingError)
    }

    // Get completed feedback from last 7 days
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data: completed, error: completedError } = await supabase
      .from('inspection_status_updates')
      .select(`
        *,
        closer:users!inspection_status_updates_closer_user_id_fkey(full_name),
        setter:users!inspection_status_updates_setter_user_id_fkey(full_name),
        lead:leads(homeowner_name, address_text)
      `)
      .eq('org_id', profile.org_id)
      .gte('completed_at', sevenDaysAgo.toISOString())
      .order('completed_at', { ascending: false })
      .limit(50)

    if (completedError) {
      console.error('Error fetching completed:', completedError)
    }

    const nowMs = Date.now()
    const duePending = (pending || []).filter((prompt) => isPromptDue(prompt, nowMs))

    return NextResponse.json({
      pending: duePending,
      completed: completed || [],
    })
  } catch (error: any) {
    console.error('Inspection feedback error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to fetch feedback' }, { status: 500 })
  }
}
