import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import {
  AI_CHAT_MAX_MESSAGE_LENGTH,
  AI_CHAT_MAX_OPENAI_MESSAGES,
  AI_CHAT_OPENAI_MAX_TOKENS,
  isValidAiContextId,
  normalizeAiChatMessages,
} from '@/lib/ai/chat-constants'
import { getAiChatRecordContextAppendix } from '@/lib/ai/chat-record-context'
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

    const recordContextAppendix = await getAiChatRecordContextAppendix(
      supabase,
      profile.org_id,
      context,
      {
        role: profile.role,
        fullAccess: effectivePermissions.fullAccess,
        permissionNames: effectivePermissions.permissionNames,
        redactOpportunityFinancials: salesDocAccessBarred,
      }
    )

    const systemPrompt = buildAiChatSystemPrompt({
      fullName: profile.full_name || 'User',
      role: profile.role,
      recordContextAppendix,
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

    const openaiKey = process.env.OPENAI_API_KEY
    let assistantResponse: string

    if (openaiKey) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.slice(-AI_CHAT_MAX_OPENAI_MESSAGES),
          ],
          max_tokens: AI_CHAT_OPENAI_MAX_TOKENS,
          temperature: 0.5,
        }),
      })

      if (!response.ok) {
        throw new Error('OpenAI API error')
      }

      const data = await response.json()
      assistantResponse =
        typeof data?.choices?.[0]?.message?.content === 'string'
          ? data.choices[0].message.content
          : 'Sorry, I could not generate a response. Please try again.'
    } else {
      assistantResponse =
        getNavigationFallbackResponse(trimmedMessage, profile.role) ||
        generateLegacyFallbackResponse(trimmedMessage, context, profile.role)
    }

    messages.push({ role: 'assistant', content: assistantResponse })

    const conversationData = {
      org_id: profile.org_id,
      user_id: profile.id,
      context_type: context.type,
      context_id: context.id ?? null,
      messages: normalizeAiChatMessages(messages),
      updated_at: new Date().toISOString(),
    }

    let savedConversationId: string | null =
      typeof conversationId === 'string' && isValidAiContextId(conversationId)
        ? conversationId
        : null

    if (savedConversationId) {
      const { error: updateError } = await supabase
        .from('ai_conversations')
        .update(conversationData)
        .eq('id', savedConversationId)
        .eq('user_id', profile.id)

      if (updateError) {
        console.error('AI conversation update failed:', updateError)
        savedConversationId = null
      }
    } else {
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
  const navigation = getNavigationFallbackResponse(message, role)
  if (navigation) return navigation

  const lowerMessage = message.toLowerCase()

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
      return `For this ops job:
- **Labor cost** → Materials tab → Labor Cost card
- **Materials** → Materials tab (+ Add Material Order) or /ops/jobs/[id]/orders
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
  } catch {
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
