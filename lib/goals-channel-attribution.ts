import { isCanvassDoorLead } from '@/lib/sales-metrics'

export type GoalChannel = 'canvass' | 'inside_sales' | 'other'

const INSIDE_SALES_SOURCES = new Set([
  'web',
  'call_in',
  'ad_campaign',
  'facebook-ad',
  'Website Contact Form',
  'inbound',
  'call_center',
])

export type LeadChannelInput = {
  source?: string | null
  channel?: string | null
  canvass_disposition?: string | null
}

/**
 * Bucket a lead for Goals scorecard channel splits (sets / sales / revenue).
 * scheduled_appointments has no creator column — attribution is lead-based only.
 */
export function resolveLeadChannel(lead: LeadChannelInput): GoalChannel {
  if (isCanvassDoorLead(lead)) return 'canvass'

  const channel = String(lead.channel || '').trim().toLowerCase()
  if (channel === 'inbound') return 'inside_sales'

  const source = String(lead.source || '').trim()
  const sourceLower = source.toLowerCase()
  if (INSIDE_SALES_SOURCES.has(source) || INSIDE_SALES_SOURCES.has(sourceLower)) {
    return 'inside_sales'
  }

  return 'other'
}

export const GOAL_CHANNEL_LABELS: Record<GoalChannel, string> = {
  canvass: 'Canvass',
  inside_sales: 'Inside sales',
  other: 'Other',
}

export const GOAL_CHANNEL_ATTRIBUTION_FOOTNOTE =
  'Channel splits follow each lead’s source/channel (canvass door knock, inbound/web/call-in, or other). Appointments have no separate booker field — lead attribution only.'
