import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAiChatRecordContextAppendix } from '@/lib/ai/chat-record-context'

// AI Assistant API - integrates with OpenAI or similar
// This provides contextual help throughout the CRM

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { message, context, conversationId } = await request.json()

    // Get user profile and settings
    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role, full_name')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Check if AI is enabled for this user
    const { data: settings } = await supabase
      .from('user_settings')
      .select('ai_enabled')
      .eq('user_id', user.id)
      .single()

    if (!settings?.ai_enabled) {
      return NextResponse.json({ 
        error: 'AI assistant is not enabled. Enable it in Settings.',
        needsEnable: true 
      }, { status: 403 })
    }

    // Build context for the AI
    const recordContextAppendix = await getAiChatRecordContextAppendix(
      supabase,
      profile.org_id,
      context
    )

    let systemPrompt = `You are an AI assistant for ARX CRM, a customer relationship management system for roofing/home improvement sales companies.

You help users with:
- Understanding their leads, opportunities, and projects
- Suggesting next steps for sales processes
- Providing insights on their performance metrics
- Helping with scheduling and follow-ups
- Answering questions about the CRM features

User: ${profile.full_name}
Role: ${profile.role}

Be concise, helpful, and professional. If you don't know something specific about their data, suggest they check the relevant section of the CRM.${recordContextAppendix}`

    // Get or create conversation
    let conversation: any = null
    if (conversationId) {
      const { data } = await supabase
        .from('ai_conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .single()
      conversation = data
    }

    const messages: Message[] = conversation?.messages || []
    messages.push({ role: 'user', content: message })

    // Check for OpenAI API key
    const openaiKey = process.env.OPENAI_API_KEY
    
    let assistantResponse: string

    if (openaiKey) {
      // Use OpenAI API
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.slice(-10), // Last 10 messages for context
          ],
          max_tokens: 500,
          temperature: 0.7,
        }),
      })

      if (!response.ok) {
        throw new Error('OpenAI API error')
      }

      const data = await response.json()
      assistantResponse = data.choices[0].message.content
    } else {
      // Fallback: Rule-based responses when no API key
      assistantResponse = generateFallbackResponse(message, context, profile)
    }

    // Add assistant response to messages
    messages.push({ role: 'assistant', content: assistantResponse })

    // Save conversation
    const conversationData = {
      org_id: profile.org_id,
      user_id: user.id,
      context_type: context?.type || 'general',
      context_id: context?.id || null,
      messages: messages,
      updated_at: new Date().toISOString(),
    }

    let savedConversationId = conversationId
    if (conversationId) {
      await supabase
        .from('ai_conversations')
        .update(conversationData)
        .eq('id', conversationId)
    } else {
      const { data: newConv } = await supabase
        .from('ai_conversations')
        .insert(conversationData)
        .select('id')
        .single()
      savedConversationId = newConv?.id
    }

    return NextResponse.json({
      response: assistantResponse,
      conversationId: savedConversationId,
    })
  } catch (error) {
    console.error('AI chat error:', error)
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    )
  }
}

// Fallback responses when no OpenAI API key is configured
function generateFallbackResponse(message: string, context: any, profile: any): string {
  const lowerMessage = message.toLowerCase()

  // Lead-related queries
  if (lowerMessage.includes('lead') || context?.type === 'lead') {
    if (lowerMessage.includes('follow up') || lowerMessage.includes('next step')) {
      return `For this lead, I'd suggest:
1. If no contact has been made, try calling during business hours
2. If they showed interest, schedule an inspection appointment
3. Make sure to add notes after each interaction
4. Consider the lead's source when tailoring your approach`
    }
    if (lowerMessage.includes('convert')) {
      return `To convert this lead to an opportunity:
1. Schedule an inspection appointment
2. Once scheduled, the system will automatically create an opportunity
3. You can also manually convert from the lead detail page`
    }
  }

  // Opportunity-related queries
  if (lowerMessage.includes('opportunity') || context?.type === 'opportunity') {
    if (lowerMessage.includes('close') || lowerMessage.includes('won')) {
      return `To close this opportunity:
1. Upload the signed contract using the "Send Contract" button
2. Once uploaded, the opportunity will be marked as won
3. A new project will be created automatically`
    }
  }

  // Schedule-related queries
  if (lowerMessage.includes('schedule') || lowerMessage.includes('appointment')) {
    return `For scheduling:
1. Use the Calendar tab to view all appointments
2. When creating a lead, you can schedule an inspection directly
3. The system uses round-robin to assign closers automatically
4. Check your Google Calendar integration in Settings`
  }

  // Commission-related queries
  if (lowerMessage.includes('commission') || lowerMessage.includes('pay')) {
    return `For commission information:
1. View your commissions on the Dashboard
2. Commissions are calculated based on your assigned comp plan
3. Contact your admin if you have questions about your comp plan`
  }

  // Report-related queries
  if (lowerMessage.includes('report')) {
    return `For reports:
1. Go to the Reports tab for standard metrics
2. You can create custom reports with the Report Builder
3. Reports can be exported to Excel/CSV
4. Dashboard widgets can be created from custom reports`
  }

  // Default helpful response
  return `I can help you with:
- **Leads**: Follow-up suggestions, conversion tips
- **Opportunities**: Closing deals, status updates
- **Scheduling**: Appointments, calendar integration
- **Reports**: Creating custom reports, viewing metrics
- **Commissions**: Understanding your comp plan

What would you like to know more about?`
}

// GET endpoint to retrieve suggestions
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const contextType = searchParams.get('context_type')
  const contextId = searchParams.get('context_id')

  // Generate contextual suggestions
  const suggestions = generateSuggestions(contextType, contextId)

  return NextResponse.json({ suggestions })
}

function generateSuggestions(contextType: string | null, contextId: string | null): string[] {
  switch (contextType) {
    case 'lead':
      return [
        'What should I do next with this lead?',
        'How do I schedule an inspection?',
        'What are the best follow-up practices?',
      ]
    case 'opportunity':
      return [
        'How do I close this opportunity?',
        'What documents do I need?',
        'How do I update the estimated value?',
      ]
    case 'project':
      return [
        'What are the next steps for this project?',
        'How do I update the project status?',
        'How do I add files to this project?',
      ]
    default:
      return [
        'How do I add a new lead?',
        'Show me my performance this week',
        'How do commissions work?',
        'Help me understand the sales process',
      ]
  }
}
