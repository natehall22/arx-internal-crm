import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'
import { isPromptDue } from '@/lib/inspection-feedback-prompt'

export async function POST(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()

    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { prompt_id } = await request.json()

    if (!prompt_id) {
      return NextResponse.json({ error: 'prompt_id is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Get the prompt details
    const { data: prompt, error: promptError } = await supabase
      .from('pending_status_prompts')
      .select(`
        *,
        closer:users!pending_status_prompts_closer_user_id_fkey(full_name, email),
        appointment:scheduled_appointments(
          scheduled_for,
          lead:leads(homeowner_name, address_text)
        )
      `)
      .eq('id', prompt_id)
      .eq('org_id', profile.org_id)
      .single()

    if (promptError || !prompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 })
    }

    if (!isPromptDue(prompt, Date.now())) {
      return NextResponse.json({ error: 'Cannot resend feedback request for future appointments' }, { status: 400 })
    }

    // Reset the prompt_at to now so it shows up again
    const { error: updateError } = await supabase
      .from('pending_status_prompts')
      .update({ 
        prompt_at: new Date().toISOString(),
        dismissed: false,
      })
      .eq('id', prompt_id)

    if (updateError) {
      console.error('Error updating prompt:', updateError)
      return NextResponse.json({ error: 'Failed to resend' }, { status: 500 })
    }

    // Create a notification for the closer
    const leadName = prompt.appointment?.lead?.homeowner_name || 'Unknown'
    const address = prompt.appointment?.lead?.address_text || ''

    await supabase
      .from('notifications')
      .insert({
        org_id: profile.org_id,
        recipient_user_id: prompt.closer_user_id,
        type: 'status_prompt',
        title: 'Inspection Feedback Reminder',
        body: `Please submit feedback for ${leadName}${address ? ` at ${address}` : ''}`,
        data: {
          appointment_id: prompt.appointment_id,
          lead_id: prompt.lead_id,
          resent_by: profile.full_name,
        },
      })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Resend error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to resend' }, { status: 500 })
  }
}
