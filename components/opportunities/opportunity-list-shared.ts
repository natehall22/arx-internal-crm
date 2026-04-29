import type { CSSProperties } from 'react'
import type { InspectionOutcomeConfigRow } from '@/lib/inspection-outcomes'

export type OpportunityListRow = {
  id: string
  lead_id: string | null
  customer_id: string | null
  owner_user_id: string | null
  address_text: string | null
  project_type: string
  status: string
  created_at: string
  customers: { name: string } | null
  leads: { homeowner_name: string } | null
  users: { full_name: string } | null
  inspection_outcome: string | null
  inspection_notes: string | null
  inspection_date: string | null
}

const inspectionOutcomeLabels: Record<string, { label: string; color: string }> = {
  sale: { label: 'Sale', color: 'bg-green-100 text-green-800' },
  moving_to_close: { label: 'Moving to Close', color: 'bg-emerald-100 text-emerald-800' },
  insurance_follow_up: { label: 'Insurance Follow Up', color: 'bg-cyan-100 text-cyan-800' },
  not_home: { label: 'Not Home', color: 'bg-yellow-100 text-yellow-800' },
  said_no: { label: 'Said No', color: 'bg-red-100 text-red-800' },
  needs_repair: { label: 'Needs Repair', color: 'bg-orange-100 text-orange-800' },
  rescheduled: { label: 'Rescheduled', color: 'bg-purple-100 text-purple-800' },
  no_problems_found: { label: 'No Problems Found', color: 'bg-gray-100 text-gray-800' },
  failed_credit: { label: 'Failed Credit', color: 'bg-rose-100 text-rose-800' },
}

export const opportunityStatusColors: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-purple-100 text-purple-800',
  negotiation: 'bg-orange-100 text-orange-800',
  won: 'bg-green-100 text-green-800',
  lost: 'bg-red-100 text-red-800',
}

export type OutcomeBadge = { label: string; color: string; style?: CSSProperties }

export function getInspectionOutcomeDisplay(
  outcome: string | null | undefined,
  lookup: Map<string, InspectionOutcomeConfigRow>
): OutcomeBadge | null {
  if (!outcome) return null
  const row = lookup.get(outcome) || lookup.get(outcome.toLowerCase())
  if (row) {
    if (row.color?.startsWith('#')) {
      return {
        label: row.label,
        color: '',
        style: {
          backgroundColor: `${row.color}26`,
          color: '#111827',
        },
      }
    }
    return { label: row.label, color: 'bg-gray-100 text-gray-800' }
  }
  const known = inspectionOutcomeLabels[outcome]
  if (known) return { label: known.label, color: known.color }
  const words = outcome.replace(/_/g, ' ')
  const label = words.replace(/\b\w/g, (c) => c.toUpperCase())
  return { label, color: 'bg-gray-100 text-gray-800' }
}
