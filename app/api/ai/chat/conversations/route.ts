import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isValidAiContextId, normalizeAiChatMessages } from '@/lib/ai/chat-constants'
import { getConversationPreview } from '@/lib/ai/chat-conversation-preview'
import {
  createRequestScopedClient,
  getRequestAccessToken,
} from '@/lib/supabase/request-client'

const RECENT_CONVERSATIONS_LIMIT = 20

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

async function requireEnabledAiChatClient() {
  try {
    const resolved = await resolveAiChatClient()
    if (!(await userHasAiEnabled(resolved.supabase, resolved.profile.id))) {
      return {
        error: NextResponse.json(
          {
            error: 'AI assistant is not enabled. Enable it in Settings.',
            needsEnable: true,
          },
          { status: 403 }
        ),
      }
    }
    return { ...resolved, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized'
    if (message === 'Account disabled') {
      return { error: NextResponse.json({ error: 'Account disabled' }, { status: 403 }) }
    }
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireEnabledAiChatClient()
  if (authResult.error) return authResult.error

  const { profile, supabase } = authResult
  const { searchParams } = new URL(request.url)
  const conversationId = searchParams.get('id')

  try {
    if (conversationId) {
      if (!isValidAiContextId(conversationId)) {
        return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
      }

      const { data, error } = await supabase
        .from('ai_conversations')
        .select('id, context_type, context_id, messages')
        .eq('id', conversationId)
        .eq('user_id', profile.id)
        .maybeSingle()

      if (error) {
        console.error('AI conversation load failed:', error)
        return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
      }

      if (!data) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
      }

      return NextResponse.json({
        conversationId: data.id,
        contextType: data.context_type,
        contextId: data.context_id,
        messages: normalizeAiChatMessages(data.messages),
      })
    }

    const { data, error } = await supabase
      .from('ai_conversations')
      .select('id, context_type, context_id, updated_at, messages')
      .eq('user_id', profile.id)
      .order('updated_at', { ascending: false })
      .limit(RECENT_CONVERSATIONS_LIMIT)

    if (error) {
      console.error('AI conversations list failed:', error)
      return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 })
    }

    return NextResponse.json({
      conversations: (data ?? []).map((row) => ({
        id: row.id,
        contextType: row.context_type,
        contextId: row.context_id,
        updatedAt: row.updated_at,
        preview: getConversationPreview(row.messages),
      })),
    })
  } catch (error) {
    console.error('AI conversations GET error:', error)
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireEnabledAiChatClient()
  if (authResult.error) return authResult.error

  const { profile, supabase } = authResult

  try {
    const body = await request.json()
    const conversationId = body?.conversationId

    if (typeof conversationId !== 'string' || !isValidAiContextId(conversationId)) {
      return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('ai_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', profile.id)
      .select('id')

    if (error) {
      console.error('AI conversation delete failed:', error)
      return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 })
    }

    if (!data?.length) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('AI conversations DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 })
  }
}
