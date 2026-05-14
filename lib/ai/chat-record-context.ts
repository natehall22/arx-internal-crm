import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * CRM page context passed from the assistant (see AIAssistant `context` prop).
 * Kept loose to match the API body; behavior mirrors `app/api/ai/chat/route.ts`.
 */
export type AiChatClientContext = {
  type?: string
  id?: string
} | null
  | undefined

/**
 * Loads lead / opportunity / project for the org and returns the exact suffix to
 * append to the AI chat system prompt. Wording and fallbacks must stay in sync
 * with product expectations—change only with intention.
 */
export async function getAiChatRecordContextAppendix(
  supabase: SupabaseClient,
  orgId: string,
  context: AiChatClientContext
): Promise<string> {
  if (context?.type === 'lead') {
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', context.id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (lead) {
      return `\n\nCurrent Lead Context:
- Name: ${lead.homeowner_name || 'Unknown'}
- Phone: ${lead.phone || 'Not set'}
- Email: ${lead.email || 'Not set'}
- Address: ${lead.address_text || 'Not set'}
- Status: ${lead.status}
- Source: ${lead.source || 'Not set'}
- Notes: ${lead.notes || 'None'}`
    }
    return ''
  }

  if (context?.type === 'opportunity') {
    const { data: opp } = await supabase
      .from('opportunities')
      .select('*')
      .eq('id', context.id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (opp) {
      return `\n\nCurrent Opportunity Context:
- Address: ${opp.address_text}
- Status: ${opp.status}
- Estimated Value: $${opp.estimated_value || 'Not set'}
- Notes: ${opp.notes || 'None'}`
    }
    return ''
  }

  if (context?.type === 'project') {
    const { data: project } = await supabase
      .from('projects')
      .select('*')
      .eq('id', context.id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (project) {
      return `\n\nCurrent Project Context:
- Address: ${project.address_text}
- Status: ${project.status}
- Contract Value: $${project.contract_value || 'Not set'}`
    }
    return ''
  }

  return ''
}
