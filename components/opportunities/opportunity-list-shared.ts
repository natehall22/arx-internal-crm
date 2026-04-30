import type { CSSProperties } from 'react'
import {
  getInspectionOutcomeConfig,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'

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

export const opportunityStatusColors: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-purple-100 text-purple-800',
  negotiation: 'bg-orange-100 text-orange-800',
  won: 'bg-green-100 text-green-800',
  lost: 'bg-red-100 text-red-800',
}

export type OutcomeBadge = { label: string; color: string; style?: CSSProperties }

/** Badge from org-loaded outcomes Map (see `/api/inspections/outcomes`) plus canonical defaults when needed. */
export function getInspectionOutcomeDisplay(
  outcome: string | null | undefined,
  lookup: Map<string, InspectionOutcomeConfigRow>
): OutcomeBadge | null {
  if (!outcome) return null
  const row =
    lookup.get(outcome) ||
    lookup.get(outcome.toLowerCase()) ||
    getInspectionOutcomeConfig(Array.from(lookup.values()), outcome)
  if (!row) {
    const words = outcome.replace(/_/g, ' ')
    const label = words.replace(/\b\w/g, (c) => c.toUpperCase())
    return { label, color: 'bg-gray-100 text-gray-800' }
  }
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
