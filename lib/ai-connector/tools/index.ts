import { findCustomer, findJob } from '@/lib/ai-connector/tools/search'
import { getCustomer } from '@/lib/ai-connector/tools/customer'
import { getJobSummary, listSchedule } from '@/lib/ai-connector/tools/jobs'
import { listVisits } from '@/lib/ai-connector/tools/visits'
import { listInvoices } from '@/lib/ai-connector/tools/invoices'
import { getThread } from '@/lib/ai-connector/tools/thread'
import { listReports, runReportTool } from '@/lib/ai-connector/tools/reports'
import type { McpTool } from '@/lib/ai-connector/tools/types'

/** Phase 1: read-only. Adding a tool here puts it in tools/list, under the same checks and audit as the rest. */
export const MCP_TOOLS: readonly McpTool[] = [findCustomer, getCustomer, findJob, getJobSummary, listSchedule, listVisits, listInvoices, getThread, listReports, runReportTool]

export function toolByName(name: string): McpTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name)
}
