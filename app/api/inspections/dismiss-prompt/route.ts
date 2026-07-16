import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import {
  FEEDBACK_PROMPT_SNOOZE_DURATION_MS,
  isPromptEscalated,
} from '@/lib/inspection-feedback-prompt'

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }

    const body = await request.json()
    const { prompt_id } = body

    if (!prompt_id) {
      return NextResponse.json({ error: 'Missing prompt_id' }, { status: 400 })
    }

    const { data: existing, error: fetchError } = await supabase
      .from('pending_status_prompts')
      .select('snooze_count')
      .eq('id', prompt_id)
      .eq('org_id', profile.org_id)
      .eq('closer_user_id', user.id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 })
    }

    if (isPromptEscalated(existing.snooze_count)) {
      // Already escalated — "Later" no longer applies, this has to be filled out.
      return NextResponse.json({ error: 'This feedback can no longer be snoozed' }, { status: 409 })
    }

    // Mark dismissed and count the snooze toward escalation. "Later" is a timed snooze, not a
    // permanent hide — bump prompt_at forward so it resurfaces on its own (same prompt_at-driven
    // visibility admin resend already uses) instead of requiring an admin to bring it back.
    // Exception: if this snooze is the one that crosses the escalation threshold, don't push
    // prompt_at out — it needs to show up as a blocking prompt on the very next poll, not in 4h.
    const newSnoozeCount = existing.snooze_count + 1
    const justEscalated = isPromptEscalated(newSnoozeCount)
    const update: Record<string, unknown> = { dismissed: true, snooze_count: newSnoozeCount }
    if (!justEscalated) {
      update.prompt_at = new Date(Date.now() + FEEDBACK_PROMPT_SNOOZE_DURATION_MS).toISOString()
    }
    // Guard on the snooze_count we read (optimistic concurrency) so two concurrent snoozes
    // (double-tap, two tabs) can't both apply against the same base count and drop an increment.
    const { data: updatedRows, error } = await supabase
      .from('pending_status_prompts')
      .update(update)
      .eq('id', prompt_id)
      .eq('org_id', profile.org_id)
      .eq('closer_user_id', user.id)
      .eq('snooze_count', existing.snooze_count)
      .select('snooze_count')

    if (error) {
      console.error('Dismiss prompt error:', error)
      return NextResponse.json({ error: 'Failed to dismiss prompt' }, { status: 500 })
    }

    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json(
        { error: 'This feedback was just updated elsewhere — refresh and try again' },
        { status: 409 }
      )
    }

    return NextResponse.json({ success: true, snooze_count: newSnoozeCount })

  } catch (error) {
    console.error('Dismiss prompt error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
