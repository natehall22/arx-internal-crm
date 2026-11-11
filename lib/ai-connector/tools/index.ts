import { findCustomer, findJob } from '@/lib/ai-connector/tools/search'
import { getCustomer } from '@/lib/ai-connector/tools/customer'
import { getJobSummary, listSchedule } from '@/lib/ai-connector/tools/jobs'
import { listVisits } from '@/lib/ai-connector/tools/visits'
import { listInvoices } from '@/lib/ai-connector/tools/invoices'
import { getThread } from '@/lib/ai-connector/tools/thread'
import { listReports, runReportTool } from '@/lib/ai-connector/tools/reports'
import { confirmChangeTool } from '@/lib/ai-connector/tools/confirm'
import { WRITE_TOOLS } from '@/lib/ai-connector/tools/writes'
import type { McpTool } from '@/lib/ai-connector/tools/types'

export const READ_TOOLS: readonly McpTool[] = [findCustomer, getCustomer, findJob, getJobSummary, listSchedule, listVisits, listInvoices, getThread, listReports, runReportTool]

/**
 * Read tools, then the write tools (each only PREPARES a change) and `confirm_change` (the only tool that saves). Write tools
 * are hidden from tools/list and refused unless the connection carries `crm:write` AND the company's "AI can make changes"
 * switch is on. Adding a tool here puts it in tools/list, under the same checks and audit as the rest.
 */
export const MCP_TOOLS: readonly McpTool[] = [...READ_TOOLS, ...WRITE_TOOLS, confirmChangeTool]

export function toolByName(name: string): McpTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name)
}
