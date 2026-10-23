'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { leadOwnerLabel } from '@/lib/lead-owner-display'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable, type TableFilter, type TableView } from '@/components/ui/data-table'

type Lead = {
  id: string
  homeowner_name: string | null
  email: string | null
  phone: string | null
  address_text: string | null
  status: string
  source: string | null
  source_type: string | null
  channel: string | null
  campaign_id: string | null
  lead_source_id: string | null
  owner_user_id: string | null
  owner_display_name?: string | null
  created_at: string
  users: { full_name: string } | null
  campaigns: { name: string } | null
  lead_sources: { name: string } | null
  opportunity_id: string | null
}

type Campaign = {
  id: string
  name: string
}

type LeadSource = {
  id: string
  name: string
}

type User = {
  id: string
  full_name: string
}

type Pagination = {
  page: number
  limit: number
  total: number
  totalPages: number
  hasMore: boolean
}

type Props = {
  profile: {
    id: string
    org_id: string
    role: string
  }
  canViewInbound: boolean
  campaigns: Campaign[]
  leadSources: LeadSource[]
  users: User[]
}

const ITEMS_PER_PAGE = 50

/** Leads can be tens of thousands of canvass pins, so paging, search and filters run on the server (/api/leads). */
export default function LeadsClient({ profile, canViewInbound, campaigns, leadSources, users }: Props) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState<{ page: number; search: string; filters: Record<string, string> }>({ page: 1, search: '', filters: {} })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debounced, setDebounced] = useState(query)

  // Debounce typing; page / filter changes go through at once.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDebounced(query), 300)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(debounced.page), limit: String(ITEMS_PER_PAGE) })
      const f = debounced.filters
      if (f.status) params.set('status', f.status)
      if (debounced.search) params.set('search', debounced.search)
      if (f.campaign) params.set('campaign_id', f.campaign)
      if (f.source) params.set('source_id', f.source)
      if (f.owner) params.set('owner_id', f.owner)
      if (f.channel === 'inbound' || f.channel === 'outbound') params.set('channel', f.channel)
      const response = await fetch(`/api/leads?${params.toString()}`)
      if (!response.ok) {
        setLeads([])
        setTotal(0)
        return
      }
      const data = await response.json()
      let rows: Lead[] = data.leads || []
      if (!canViewInbound) rows = rows.filter((lead) => lead.channel === 'outbound' || !lead.channel || lead.owner_user_id === profile.id)
      setLeads(rows)
      setTotal(data.pagination?.total ?? rows.length)
    } catch (error) {
      console.error('Error loading leads:', error)
      setLeads([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [debounced, canViewInbound, profile.id])
  useEffect(() => { void load() }, [load])

  const columns = useMemo<ColumnDef<Lead, any>[]>(() => {
    const cols: ColumnDef<Lead, any>[] = [
      {
        id: 'lead',
        header: 'Lead',
        enableSorting: false,
        cell: (c) => {
          const l = c.row.original
          return (
            <span>
              <span className="font-semibold">{l.homeowner_name || 'N/A'}</span>
              <span className="block text-ui-sm text-ink-muted">{l.phone || l.email || 'No contact'}</span>
            </span>
          )
        },
        meta: { mobile: 'title' },
      },
      { id: 'address', header: 'Address', enableSorting: false, accessorFn: (l) => l.address_text ?? '', cell: (c) => <span className="block max-w-[14rem] truncate">{(c.getValue() as string) || 'N/A'}</span> },
      { id: 'status', header: 'Status', enableSorting: false, accessorFn: (l) => l.status, cell: (c) => <StatusPill domain="lead" value={c.getValue()} /> },
    ]
    if (canViewInbound) cols.push({ id: 'channel', header: 'Channel', enableSorting: false, accessorFn: (l) => l.channel ?? '', cell: (c) => (c.getValue() ? <span className="capitalize">{c.getValue()}</span> : '—'), meta: { mobile: 'hide' } })
    cols.push(
      {
        id: 'source',
        header: 'Source',
        enableSorting: false,
        accessorFn: (l) => l.lead_sources?.name || l.source || '',
        cell: (c) => {
          const l = c.row.original
          return (
            <span>
              {(c.getValue() as string) || '—'}
              {l.campaigns?.name ? <span className="block text-ui-sm text-ink-muted">{l.campaigns.name}</span> : null}
            </span>
          )
        },
        meta: { mobile: 'hide' },
      },
      { id: 'owner', header: 'Owner', enableSorting: false, accessorFn: (l) => leadOwnerLabel(l) },
      {
        id: 'opp',
        header: 'Opportunity',
        enableSorting: false,
        accessorFn: (l) => l.opportunity_id ?? '',
        cell: (c) => (c.getValue() ? <Link href={`/opportunities/${c.getValue()}`} className="font-semibold underline underline-offset-2">Open</Link> : '—'),
        meta: { mobile: 'hide' },
      }
    )
    return cols
  }, [canViewInbound])

  const filters = useMemo<TableFilter<Lead>[]>(() => {
    const f: TableFilter<Lead>[] = [
      { key: 'status', label: 'Status', options: ['new', 'contacted', 'appointment', 'inspection', 'estimate_sent', 'won', 'lost'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })) },
    ]
    if (canViewInbound) f.push({ key: 'channel', label: 'Channel', options: [{ value: 'inbound', label: 'Inbound' }, { value: 'outbound', label: 'Outbound' }] })
    if (canViewInbound && campaigns.length > 0) f.push({ key: 'campaign', label: 'Campaign', options: campaigns.map((c) => ({ value: c.id, label: c.name })) })
    if (canViewInbound && leadSources.length > 0) f.push({ key: 'source', label: 'Source', options: leadSources.map((s) => ({ value: s.id, label: s.name })) })
    if (users.length > 0) f.push({ key: 'owner', label: 'Owner', options: [{ value: 'unassigned', label: 'Unassigned' }, ...users.map((u) => ({ value: u.id, label: u.full_name }))] })
    return f
  }, [canViewInbound, campaigns, leadSources, users])

  const systemViews = useMemo<TableView[]>(() => {
    const views: TableView[] = [{ id: 'sys:new', name: 'New leads', state: { sorting: [], search: '', filters: { status: 'new' } } }]
    if (users.length > 0) views.push({ id: 'sys:unassigned', name: 'Unassigned', state: { sorting: [], search: '', filters: { owner: 'unassigned' } } })
    if (canViewInbound) {
      views.push({ id: 'sys:inbound', name: 'Inbound', state: { sorting: [], search: '', filters: { channel: 'inbound' } } })
      views.push({ id: 'sys:outbound', name: 'Outbound', state: { sorting: [], search: '', filters: { channel: 'outbound' } } })
    }
    return views
  }, [canViewInbound, users.length])

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <PageHeader title="Leads" subtitle={`${total.toLocaleString()} leads`} actions={<Button asChild><Link href="/leads/new">New lead</Link></Button>} />
      <DataTable
        columns={columns}
        data={leads}
        loading={loading}
        tableKey="leads"
        getRowId={(l) => l.id}
        getRowHref={(l) => `/leads/${l.id}`}
        searchPlaceholder="Search name, email, phone or address"
        filters={filters}
        systemViews={systemViews}
        server={{ total, page: query.page, pageSize: ITEMS_PER_PAGE, onQuery: (q) => setQuery({ page: q.page, search: q.search, filters: q.filters }) }}
        empty={{ title: 'No leads found', body: 'Try clearing a filter or another view.' }}
      />
    </div>
  )
}
