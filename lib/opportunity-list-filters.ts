export type OpportunityListFilters = {
  q: string
  status: string
  inspection_outcome: string
  project_type: string
}

export const EMPTY_OPPORTUNITY_LIST_FILTERS: OpportunityListFilters = {
  q: '',
  status: '',
  inspection_outcome: '',
  project_type: '',
}

type SearchParamSource =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>

function hasGetter(source: SearchParamSource): source is { get(name: string): string | null } {
  return typeof (source as { get?: unknown }).get === 'function'
}

export function filtersFromSearchParams(
  source: SearchParamSource
): OpportunityListFilters {
  const read = (key: keyof OpportunityListFilters) => {
    if (hasGetter(source)) {
      return source.get(key) || ''
    }
    const raw = source[key]
    return Array.isArray(raw) ? raw[0] || '' : raw || ''
  }

  return {
    q: read('q'),
    status: read('status'),
    inspection_outcome: read('inspection_outcome'),
    project_type: read('project_type'),
  }
}

export function applyOpportunityListFilters<T extends {
  status?: string | null
  project_type?: string | null
  inspection_outcome?: string | null
  leads?: { homeowner_name?: string | null } | null
  customers?: { name?: string | null } | null
  address_text?: string | null
}>(opportunities: T[], filters: OpportunityListFilters) {
  return opportunities.filter((opp) => {
    if (filters.status && String(opp.status || '').toLowerCase() !== filters.status.toLowerCase()) {
      return false
    }

    if (
      filters.project_type &&
      String(opp.project_type || '').toLowerCase() !== filters.project_type.toLowerCase()
    ) {
      return false
    }

    if (filters.inspection_outcome) {
      const outcome = String(opp.inspection_outcome || '').toLowerCase()
      const wanted = filters.inspection_outcome.toLowerCase()
      if (wanted === 'none') {
        if (outcome) return false
      } else if (outcome !== wanted) {
        return false
      }
    }

    if (filters.q) {
      const q = filters.q.toLowerCase()
      const name = opp.leads?.homeowner_name || opp.customers?.name || ''
      const address = opp.address_text || ''
      if (!name.toLowerCase().includes(q) && !address.toLowerCase().includes(q)) {
        return false
      }
    }

    return true
  })
}

export function buildOpportunityListQuery(filters: OpportunityListFilters, extras?: Record<string, string>) {
  const params = new URLSearchParams()

  if (filters.q) params.set('q', filters.q)
  if (filters.status) params.set('status', filters.status)
  if (filters.inspection_outcome) params.set('inspection_outcome', filters.inspection_outcome)
  if (filters.project_type) params.set('project_type', filters.project_type)

  for (const [key, value] of Object.entries(extras || {})) {
    if (value) params.set(key, value)
  }

  return params.toString()
}
