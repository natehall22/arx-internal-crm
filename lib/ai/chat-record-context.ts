import type { SupabaseClient } from '@supabase/supabase-js'
import { isValidAiContextId } from '@/lib/ai/chat-constants'
import {
  canAccessJobBoardFromPermissionNames,
  canAccessProjectsFromPermissionNames,
  hasPermission,
  isBarredFromProjectsUi,
  isBarredFromSalesDocAccess,
  type PermissionName,
} from '@/lib/permissions'
import type { UserRole } from '@/lib/types/database'

export type AiChatRecordAccess = {
  role: string
  fullAccess: boolean
  permissionNames: Set<string>
}

/** Mirrors UI/route guards — client-supplied context.type/id must not bypass RBAC. */
export function canAccessAiChatRecordContext(
  access: AiChatRecordAccess,
  contextType: string
): boolean {
  if (access.fullAccess) return true

  const role = access.role as UserRole
  const has = (name: PermissionName) =>
    access.permissionNames.has(name) || hasPermission(role, name)

  switch (contextType) {
    case 'lead':
      return has('leads:view')
    case 'opportunity':
      return has('opportunities:view')
    case 'project':
      if (isBarredFromProjectsUi(role)) return false
      return canAccessProjectsFromPermissionNames(access)
    case 'job':
      return canAccessJobBoardFromPermissionNames(access)
    default:
      return false
  }
}

function shouldRedactOpportunityFinancials(role: string): boolean {
  return isBarredFromSalesDocAccess({ role })
}

/**
 * CRM page context passed from the assistant (see AIAssistant `context` prop).
 */
export type AiChatClientContext =
  | {
      type?: string
      id?: string
    }
  | null
  | undefined

/**
 * Loads minimal, non-sensitive record context for the AI system prompt.
 * Intentionally excludes phone, email, and free-text notes (PII).
 */
export async function getAiChatRecordContextAppendix(
  supabase: SupabaseClient,
  orgId: string,
  context: AiChatClientContext,
  access?: AiChatRecordAccess
): Promise<string> {
  if (!context?.type || context.type === 'general') {
    return ''
  }

  if (!isValidAiContextId(context.id)) {
    return ''
  }

  if (access && !canAccessAiChatRecordContext(access, context.type)) {
    return ''
  }

  const recordId = context.id

  if (context.type === 'lead') {
    const { data: lead } = await supabase
      .from('leads')
      .select('homeowner_name, address_text, status, source')
      .eq('id', recordId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (lead) {
      return `\n\nCurrent Lead Context (no contact PII):
- Name: ${lead.homeowner_name || 'Unknown'}
- Address: ${lead.address_text || 'Not set'}
- Status: ${lead.status}
- Source: ${lead.source || 'Not set'}`
    }
    return ''
  }

  if (context.type === 'opportunity') {
    const { data: opp } = await supabase
      .from('opportunities')
      .select('address_text, status, estimated_value')
      .eq('id', recordId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (opp) {
      const valueLine = shouldRedactOpportunityFinancials(access?.role ?? '')
        ? ''
        : `\n- Estimated Value: $${opp.estimated_value ?? 'Not set'}`
      return `\n\nCurrent Opportunity Context:
- Address: ${opp.address_text || 'Not set'}
- Status: ${opp.status}${valueLine}`
    }
    return ''
  }

  if (context.type === 'project') {
    const { data: project } = await supabase
      .from('projects')
      .select('address_text, status, contract_value')
      .eq('id', recordId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (project) {
      return `\n\nCurrent Project Context:
- Address: ${project.address_text || 'Not set'}
- Status: ${project.status}
- Contract Value: $${project.contract_value ?? 'Not set'}`
    }
    return ''
  }

  if (context.type === 'job') {
    const { data: job } = await supabase
      .from('production_jobs')
      .select('job_number, address_text, status, materials_status')
      .eq('id', recordId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (job) {
      return `\n\nCurrent Ops Job Context:
- Job #: ${job.job_number ?? 'Not set'}
- Address: ${job.address_text || 'Not set'}
- Status: ${job.status}
- Materials status: ${job.materials_status || 'Not set'}
- Labor cost entry: Materials tab → Labor Cost card on this job (/ops/jobs/${recordId})
- Cost lines & photos: Photos & files tab → Job Files Workspace`
    }
    return ''
  }

  return ''
}
