import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isAiAssistantAllowlistedAuth } from '@/lib/ai/chat-allowlist'
import {
  AI_CHAT_MAX_MESSAGE_LENGTH,
  AI_CHAT_MAX_OPENAI_MESSAGES,
  AI_CHAT_OPENAI_MAX_TOKENS,
  aiChatAggregatesEnabled,
  isValidAiContextId,
  normalizeAiChatMessages,
} from '@/lib/ai/chat-constants'
import { getAiChatAggregateAppendix } from '@/lib/ai/chat-aggregates'
import { getAiChatRecordContextAppendix } from '@/lib/ai/chat-record-context'
import { getAiChatRecordUrlAppendix } from '@/lib/ai/chat-record-url'
import { formatAiChatSseEvent } from '@/lib/ai/chat-stream'
import {
  buildAiChatSystemPrompt,
  generateContextualSuggestions,
  getNavigationFallbackResponse,
} from '@/lib/ai/crm-navigation-guide'
import {
  createRequestScopedClient,
  getRequestAccessToken,
} from '@/lib/supabase/request-client'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

async function resolveAiChatClient() {
  const auth = await requireAuthApi()
  if (!isAiAssistantAllowlistedAuth(auth)) {
    throw new Error('AI assistant not available')
  }
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

function normalizeClientContext(context: unknown) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return { type: 'general' as const, id: undefined }
  }

  const raw = context as { type?: unknown; id?: unknown }
  const type = typeof raw.type === 'string' ? raw.type : 'general'
  const id = typeof raw.id === 'string' && isValidAiContextId(raw.id) ? raw.id : undefined

  const allowedTypes = new Set(['lead', 'opportunity', 'project', 'job', 'general'])
  return {
    type: allowedTypes.has(type) ? type : 'general',
    id,
  }
}

async function persistAiConversation(
  supabase: ReturnType<typeof createRequestScopedClient>,
  params: {
    orgId: string
    userId: string
    contextType: string
    contextId?: string
    messages: Message[]
    conversationId: string | null
  }
): Promise<string | null> {
  const conversationData = {
    org_id: params.orgId,
    user_id: params.userId,
    context_type: params.contextType,
    context_id: params.contextId ?? null,
    messages: normalizeAiChatMessages(params.messages),
    updated_at: new Date().toISOString(),
  }

  let savedConversationId = params.conversationId

  if (savedConversationId) {
    const { data: updated, error: updateError } = await supabase
      .from('ai_conversations')
      .update(conversationData)
      .eq('id', savedConversationId)
      .eq('user_id', params.userId)
      .select('id')
      .maybeSingle()

    if (updateError) {
      console.error('AI conversation update failed:', updateError)
      savedConversationId = null
    } else if (!updated?.id) {
      savedConversationId = null
    }
  }

  if (!savedConversationId) {
    const { data: newConv, error: insertError } = await supabase
      .from('ai_conversations')
      .insert(conversationData)
      .select('id')
      .single()

    if (insertError || !newConv?.id) {
      console.error('AI conversation insert failed:', insertError)
      savedConversationId = null
    } else {
      savedConversationId = newConv.id
    }
  }

  return savedConversationId
}

function createOpenAiStreamingResponse(
  openaiResponse: Response,
  persist: (assistantResponse: string) => Promise<string | null>
): Response {
  const encoder = new TextEncoder()
  let assistantResponse = ''

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: string) => {
        controller.enqueue(encoder.encode(payload))
      }

      if (!openaiResponse.body) {
        send(formatAiChatSseEvent({ type: 'error', error: 'Failed to process request' }))
        controller.close()
        return
      }

      const reader = openaiResponse.body.getReader()
      const decoder = new TextDecoder()
      let openAiBuffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          openAiBuffer += decoder.decode(value, { stream: true })
          const lines = openAiBuffer.split('\n')
          openAiBuffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data: ')) continue

            const payload = trimmed.slice(6)
            if (payload === '[DONE]') continue

            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>
              }
              const token = parsed.choices?.[0]?.delta?.content
              if (typeof token === 'string' && token.length > 0) {
                assistantResponse += token
                send(formatAiChatSseEvent({ type: 'token', content: token }))
              }
            } catch {
              // Ignore malformed OpenAI chunks.
            }
          }
        }

        if (!assistantResponse) {
          assistantResponse =
            'Sorry, I could not generate a response. Please try again.'
          send(formatAiChatSseEvent({ type: 'token', content: assistantResponse }))
        }

        const savedConversationId = await persist(assistantResponse)
        send(
          formatAiChatSseEvent({
            type: 'done',
            conversationId: savedConversationId,
            response: assistantResponse,
          })
        )
      } catch (error) {
        console.error('AI chat stream error:', error)
        send(formatAiChatSseEvent({ type: 'error', error: 'Failed to process request' }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

export async function POST(request: NextRequest) {
  let profile: {
    org_id: string
    role: string
    full_name: string | null
    id: string
    custom_role_id?: string | null
  }
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
    if (message === 'AI assistant not available') {
      return NextResponse.json({ error: 'AI assistant is not available for your account yet.' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceClient()
  const effectivePermissions = await resolveEffectivePermissionNames(admin, profile.id, profile)

  try {
    const body = await request.json()
    const { message, context: rawContext, conversationId } = body ?? {}

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const trimmedMessage = message.trim()
    if (trimmedMessage.length > AI_CHAT_MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `Message too long (max ${AI_CHAT_MAX_MESSAGE_LENGTH} characters)` },
        { status: 400 }
      )
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

    const context = normalizeClientContext(rawContext)

    const salesDocAccessBarred = await resolveSalesDocAccessBarred(admin, profile.id, profile)

    const recordAccess = {
      role: profile.role,
      fullAccess: effectivePermissions.fullAccess,
      permissionNames: effectivePermissions.permissionNames,
      redactOpportunityFinancials: salesDocAccessBarred,
    }

    const recordContextAppendix =
      (await getAiChatRecordContextAppendix(
        supabase,
        profile.org_id,
        context,
        recordAccess
      )) + getAiChatRecordUrlAppendix(context, recordAccess)

    let aggregateContextAppendix = ''
    if (aiChatAggregatesEnabled()) {
      aggregateContextAppendix = await getAiChatAggregateAppendix(supabase, {
        orgId: profile.org_id,
        userId: profile.id,
        role: profile.role,
        fullAccess: effectivePermissions.fullAccess,
        permissionNames: effectivePermissions.permissionNames,
        redactFinancials: salesDocAccessBarred,
      })
    }

    const systemPrompt = buildAiChatSystemPrompt({
      fullName: profile.full_name || 'User',
      role: profile.role,
      recordContextAppendix,
      aggregateContextAppendix,
    })

    let conversation: { messages?: unknown } | null = null
    if (typeof conversationId === 'string' && isValidAiContextId(conversationId)) {
      const { data } = await supabase
        .from('ai_conversations')
        .select('messages')
        .eq('id', conversationId)
        .eq('user_id', profile.id)
        .maybeSingle()
      conversation = data
    }

    const messages: Message[] = normalizeAiChatMessages(conversation?.messages)
    messages.push({ role: 'user', content: trimmedMessage })

    const savedConversationIdSeed =
      typeof conversationId === 'string' && isValidAiContextId(conversationId)
        ? conversationId
        : null

    const openaiKey = process.env.OPENAI_API_KEY

    if (openaiKey) {
      const openaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-AI_CHAT_MAX_OPENAI_MESSAGES),
      ]

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: openaiMessages,
          max_tokens: AI_CHAT_OPENAI_MAX_TOKENS,
          temperature: 0.5,
          stream: true,
        }),
      })

      if (!response.ok) {
        throw new Error('OpenAI API error')
      }

      return createOpenAiStreamingResponse(response, async (assistantResponse) => {
        const persistedMessages: Message[] = [...messages, { role: 'assistant', content: assistantResponse }]
        return persistAiConversation(supabase, {
          orgId: profile.org_id,
          userId: profile.id,
          contextType: context.type,
          contextId: context.id,
          messages: persistedMessages,
          conversationId: savedConversationIdSeed,
        })
      })
    }

    const assistantResponse =
      getNavigationFallbackResponse(trimmedMessage, profile.role, context) ||
      generateLegacyFallbackResponse(trimmedMessage, context, profile.role)

    messages.push({ role: 'assistant', content: assistantResponse })

    const savedConversationId = await persistAiConversation(supabase, {
      orgId: profile.org_id,
      userId: profile.id,
      contextType: context.type,
      contextId: context.id,
      messages,
      conversationId: savedConversationIdSeed,
    })

    return NextResponse.json({
      response: assistantResponse,
      conversationId: savedConversationId,
    })
  } catch (error) {
    console.error('AI chat error:', error)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}

function generateLegacyFallbackResponse(
  message: string,
  context: { type: string; id?: string },
  role: string
): string {
  const navigation = getNavigationFallbackResponse(message, role, context)
  if (navigation) return navigation

  const lowerMessage = message.toLowerCase()
  const jobUrl =
    context.type === 'job' && context.id ? `/ops/jobs/${context.id}` : '/ops/jobs/[id]'

  if (lowerMessage.includes('lead') || context.type === 'lead') {
    if (lowerMessage.includes('follow up') || lowerMessage.includes('next step')) {
      return `For this lead:
1. Call during business hours if you have not reached them
2. Schedule an inspection from the lead page if they are interested
3. Log notes after each touch
4. Check lead source when tailoring your approach`
    }
    if (lowerMessage.includes('convert')) {
      return `To convert this lead to an opportunity:
1. Schedule an inspection from the lead detail page
2. The system creates an opportunity when the inspection is set
3. You can also convert manually from the lead detail page`
    }
  }

  if (lowerMessage.includes('opportunity') || context.type === 'opportunity') {
    if (lowerMessage.includes('close') || lowerMessage.includes('won')) {
      return `To close this opportunity:
1. Open the opportunity at /opportunities/[id]
2. Send or upload the signed contract
3. When won, a project and ops job are created automatically`
    }
  }

  if (context.type === 'job') {
    const lower = message.toLowerCase()
    const jobRelated =
      /\b(labor|material|cost|photo|crew|sub|status|order|permit|financial|file|tab|job|work order)\b/.test(
        lower
      ) || /\b(where|how|what|next)\b/.test(lower)

    if (jobRelated) {
      return `For this ops job (${jobUrl}):
- **Labor cost** → Materials tab → Labor Cost card
- **Materials** → Materials tab (+ Add Material Order) or ${jobUrl}/orders
- **Cost lines** (permit, dump, misc) → Photos & files tab → Job Files Workspace
- **Crew / sub** → Overview tab → Schedule now or Reassign crew or sub
- **Work orders** → Financials tab → Work Orders card`
    }
  }

  return `I can help you navigate ARX CRM. Ask things like:
- "Where do I enter labor cost?"
- "How do I schedule an inspection?"
- "Where are my commissions?"
- "How does a lead become an ops job?"

Enable AI in Settings → AI Assistant if you have not already.`
}

export async function GET(request: NextRequest) {
  let profile: { id: string; org_id: string; role: string; custom_role_id?: string | null }
  let supabase: ReturnType<typeof createRequestScopedClient>

  try {
    const resolved = await resolveAiChatClient()
    profile = resolved.profile
    supabase = resolved.supabase
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized'
    if (message === 'AI assistant not available') {
      return NextResponse.json({ error: 'AI assistant is not available for your account yet.' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!(await userHasAiEnabled(supabase, profile.id))) {
    return NextResponse.json({ suggestions: [] })
  }

  const { searchParams } = new URL(request.url)
  const contextType = searchParams.get('context_type')
  const contextId = searchParams.get('context_id')

  return NextResponse.json({
    suggestions: generateContextualSuggestions(contextType, contextId),
  })
}
