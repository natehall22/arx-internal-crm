import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'

function isPromptDue(prompt: any, nowMs: number) {
  const scheduledFor = prompt?.appointment?.scheduled_for ? Date.parse(prompt.appointment.scheduled_for) : NaN
  const promptAt = prompt?.prompt_at ? Date.parse(prompt.prompt_at) : NaN

  const appointmentIsDue = Number.isNaN(scheduledFor) || scheduledFor <= nowMs
  const promptIsDue = Number.isNaN(promptAt) || promptAt <= nowMs

  return appointmentIsDue && promptIsDue
}

export async function POST() {
  try {
    const { profile } = await requireAuthApi()

    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const supabase = createServiceClient()

    // Get all unresolved prompts (including dismissed/snoozed)
    const { data: prompts, error: promptsError } = await supabase
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

    if (promptsError) {
      console.error('Error fetching prompts:', promptsError)
      return NextResponse.json({ error: 'Failed to fetch prompts' }, { status: 500 })
    }

    if (!prompts || prompts.length === 0) {
      return NextResponse.json({ count: 0 })
    }

    const nowMs = Date.now()
    const duePrompts = prompts.filter((prompt) => isPromptDue(prompt, nowMs))

    if (duePrompts.length === 0) {
      return NextResponse.json({ success: true, count: 0 })
    }

    // Reset all prompt_at times to now
    const promptIds = duePrompts.map((p) => p.id)
    const { error: updateError } = await supabase
      .from('pending_status_prompts')
      .update({ 
        prompt_at: new Date().toISOString(),
        dismissed: false,
      })
      .in('id', promptIds)

    if (updateError) {
      console.error('Error updating prompts:', updateError)
      return NextResponse.json({ error: 'Failed to update prompts' }, { status: 500 })
    }

    // Create notifications for each closer
    const notifications = duePrompts.map((prompt) => {
      const leadName = prompt.appointment?.lead?.homeowner_name || 'Unknown'
      const address = prompt.appointment?.lead?.address_text || ''

      return {
        org_id: profile.org_id,
        recipient_user_id: prompt.closer_user_id,
        type: 'status_prompt',
        title: 'Inspection Feedback Reminder',
        body: `Please submit feedback for ${leadName}${address ? ` at ${address}` : ''}`,
        data: {
          appointment_id: prompt.appointment_id,
          lead_id: prompt.lead_id,
          resent_by: profile.full_name,
          bulk_resend: true,
        },
      }
    })

    const { error: notifError } = await supabase
      .from('notifications')
      .insert(notifications)

    if (notifError) {
      console.error('Error creating notifications:', notifError)
    }

    return NextResponse.json({ 
      success: true, 
      count: duePrompts.length,
    })
  } catch (error: any) {
    console.error('Resend all error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to resend' }, { status: 500 })
  }
}
