'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'

import Nav from '@/components/Nav'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable, type TableFilter, type TableView } from '@/components/ui/data-table'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { confirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/components/ui/toast'
import { StatusPill } from '@/components/ui/badge'
import { formatDate, formatMoney } from '@/lib/format'
import { userCanDeleteProposal } from '@/lib/proposal-delete-access'

interface Proposal {
  id: string
  proposal_number: string
  customer_name: string
  customer_address: string
  title: string
  status: string
  total: number
  created_at: string
  sent_at: string | null
  created_by?: string | null
  users?: { full_name: string }
}

const OPEN = new Set(['draft', 'sent', 'viewed'])
const groupOf = (p: Proposal) => (p.status === 'accepted' ? 'accepted' : OPEN.has(p.status) ? 'open' : 'closed')
const NEWEST = [{ id: 'created', desc: true }]

const FILTERS: TableFilter<Proposal>[] = [
  { key: 'group', label: 'Stage', options: [{ value: 'open', label: 'Open' }, { value: 'accepted', label: 'Accepted' }, { value: 'closed', label: 'Declined / expired' }], accessor: groupOf },
  { key: 'status', label: 'Status', options: ['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })), accessor: (p) => p.status },
]
const SYSTEM_VIEWS: TableView[] = [
  { id: 'sys:open', name: 'Open (draft, sent, viewed)', state: { sorting: NEWEST, search: '', filters: { group: 'open' } } },
  { id: 'sys:sent', name: 'Sent, waiting on the customer', state: { sorting: NEWEST, search: '', filters: { status: 'sent' } } },
  { id: 'sys:accepted', name: 'Accepted', state: { sorting: NEWEST, search: '', filters: { group: 'accepted' } } },
  { id: 'sys:closed', name: 'Declined / expired', state: { sorting: NEWEST, search: '', filters: { group: 'closed' } } },
]

export default function ProposalsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [userRole, setUserRole] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/proposals')
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login')
          return
        }
        const data = await response.json().catch(() => ({}))
        setError(data.error || 'Failed to load proposals')
        setProposals([])
        return
      }
      const { proposals: rows, role, current_user_id: uid } = await response.json()
      setProposals(rows || [])
      setUserRole(role || '')
      setCurrentUserId(typeof uid === 'string' ? uid : '')
    } catch (err) {
      console.error('Error loading proposals:', err)
      setError('Failed to load proposals')
      setProposals([])
    } finally {
      setLoading(false)
    }
  }, [router])
  useEffect(() => { void load() }, [load])

  const handleDelete = useCallback(async (p: Proposal) => {
    if (!(await confirmDialog({ title: `Delete proposal ${p.proposal_number}? This cannot be undone.`, destructive: true }))) return
    setDeletingId(p.id)
    try {
      const response = await fetch(`/api/proposals/${p.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast.error(data.error || 'Failed to delete proposal')
        return
      }
      setProposals((prev) => prev.filter((x) => x.id !== p.id))
    } catch (err) {
      console.error('Error deleting proposal:', err)
      toast.error('Failed to delete proposal')
    } finally {
      setDeletingId(null)
    }
  }, [])

  const columns = useMemo<ColumnDef<Proposal, any>[]>(
    () => [
      {
        id: 'number',
        header: 'Proposal',
        accessorFn: (p) => `${p.proposal_number} ${p.customer_name} ${p.customer_address}`,
        cell: (c) => {
          const p = c.row.original
          return (
            <span>
              <span className="font-semibold">{p.proposal_number}</span> · {p.customer_name}
              <span className="block text-ui-sm text-ink-muted">{p.customer_address}</span>
            </span>
          )
        },
        meta: { mobile: 'title' },
      },
      { accessorKey: 'title', header: 'Title', meta: { mobile: 'hide' } },
      { accessorKey: 'status', header: 'Status', cell: (c) => <StatusPill domain="proposal" value={c.getValue()} /> },
      { accessorKey: 'total', header: 'Total', cell: (c) => formatMoney(Number(c.getValue()) || 0), meta: { align: 'right' } },
      { id: 'created', header: 'Created', accessorFn: (p) => p.created_at, cell: (c) => formatDate(c.getValue()) },
      { id: 'by', header: 'By', accessorFn: (p) => p.users?.full_name ?? '', meta: { mobile: 'hide' } },
    ],
    []
  )

  const accepted = proposals.filter((p) => p.status === 'accepted')
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6">
        <PageHeader title="Proposals" subtitle="Create and manage customer proposals" actions={<Button asChild><Link href="/proposals/builder">New proposal</Link></Button>} />
        {error ? <p role="alert" className="text-ui-base text-danger">{error}</p> : null}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['All proposals', String(proposals.length)],
            ['Drafts', String(proposals.filter((p) => p.status === 'draft').length)],
            ['Sent', String(proposals.filter((p) => p.status === 'sent').length)],
            ['Accepted value', formatMoney(accepted.reduce((s, p) => s + (p.total || 0), 0))],
          ].map(([label, value]) => (
            <Card key={label}><CardContent><p className="text-ui-sm text-ink-muted">{label}</p><p className="text-ui-lg font-bold text-ink">{value}</p></CardContent></Card>
          ))}
        </div>
        <DataTable
          columns={columns}
          data={proposals}
          loading={loading}
          tableKey="proposals"
          getRowId={(p) => p.id}
          getRowHref={(p) => `/proposals/${p.id}`}
          searchPlaceholder="Search customer, address or number"
          filters={FILTERS}
          systemViews={SYSTEM_VIEWS}
          defaultViewId="sys:open"
          initialSorting={NEWEST}
          rowActions={(p) =>
            currentUserId && userCanDeleteProposal({ status: p.status, createdBy: p.created_by, currentUserId, role: userRole }) ? (
              <Button variant="ghost" size="sm" onClick={() => handleDelete(p)} disabled={deletingId === p.id} aria-label={`Delete proposal ${p.proposal_number}`}>
                {deletingId === p.id ? 'Deleting…' : 'Delete'}
              </Button>
            ) : null
          }
          empty={{ title: 'No proposals match', body: 'Try another view, or build one.', action: <Button asChild><Link href="/proposals/builder">New proposal</Link></Button> }}
        />
      </main>
    </div>
  )
}
