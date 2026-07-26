import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isValidAiContextId } from '@/lib/ai/chat-constants'
import {
  createRequestScopedClient,
  getRequestAccessToken,
} from '@/lib/supabase/request-client'

async function resolveAiChatClient() {
  const auth = await requireAuthApi()
  const accessToken = getRequestAccessToken()
  if (!accessToken) {
    throw new Error('Unauthorized')
  }
  return {
    profile: auth.profile,
    supabase: createRequestScopedClient(accessToken),
  }
}

async function userHasAiEnabled(
  supabase: ReturnType<typeof createRequestScopedClient>,
  userId: string
): Promise<boolean> {
  const { data: settings } = await supabase
    .from('user_settings')
    .select('ai_enabled')
    .eq('user_id', userId)
    .maybeSingle()

  return Boolean(settings?.ai_enabled)
}

const VALID_RATINGS = new Set(['up', 'down'])

export async function POST(request: NextRequest) {
  let profile: { id: string; org_id: string }
  let supabase: ReturnType<typeof createRequestScopedClient>

  try {
    const resolved = await resolveAiChatClient()
    profile = resolved.profile
    supabase = resolved.supabase
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized'
    if (message === 'Account disabled') {
      return NextResponse.json({ error: 'Account disabled' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!(await userHasAiEnabled(supabase, profile.id))) {
    return NextResponse.json(
      {
        error: 'AI assistant is not enabled. Enable it in Settings.',
        needsEnable: true,
      },
      { status: 403 }
    )
  }

  try {
    const body = await request.json()
    const { conversationId, messageIndex, rating } = body ?? {}

    if (typeof conversationId !== 'string' || !isValidAiContextId(conversationId)) {
      return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
    }

    if (
      typeof messageIndex !== 'number' ||
      !Number.isInteger(messageIndex) ||
      messageIndex < 0
    ) {
      return NextResponse.json({ error: 'Invalid message index' }, { status: 400 })
    }

    if (typeof rating !== 'string' || !VALID_RATINGS.has(rating)) {
      return NextResponse.json({ error: 'Invalid rating' }, { status: 400 })
    }

    const { data: conversation, error: conversationError } = await supabase
      .from('ai_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', profile.id)
      .maybeSingle()

    if (conversationError) {
      console.error('AI feedback conversation lookup failed:', conversationError)
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
    }

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { error: upsertError } = await supabase.from('ai_message_feedback').upsert(
      {
        org_id: profile.org_id,
        user_id: profile.id,
        conversation_id: conversationId,
        message_index: messageIndex,
        rating,
      },
      { onConflict: 'conversation_id,message_index,user_id' }
    )

    if (upsertError) {
      console.error('AI message feedback upsert failed:', upsertError)
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('AI feedback error:', error)
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
  }
}
