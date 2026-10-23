'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable, type TableFilter, type TableView } from '@/components/ui/data-table'
import LinkCreateCustomerModal from './LinkCreateCustomerModal'
import { confirmDialog } from '@/components/ui/confirm-dialog'

interface Customer {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  address_text: string | null
  /** Has a project or a won deal. Everyone else is a prospect (a deal exists, nothing sold yet). */
  bought?: boolean
}

const kindOf = (c: Customer) => (c.bought ? 'customer' : 'prospect')
const COLUMNS: ColumnDef<Customer, any>[] = [
  { accessorKey: 'name', header: 'Name', cell: (c) => c.getValue() || 'N/A', meta: { mobile: 'title' } },
  { accessorKey: 'phone', header: 'Phone', cell: (c) => c.getValue() || '—' },
  { accessorKey: 'email', header: 'Email', cell: (c) => c.getValue() || '—', meta: { mobile: 'hide' } },
  { accessorKey: 'address_text', header: 'Address', cell: (c) => c.getValue() || '—' },
  { id: 'kind', header: 'Type', accessorFn: kindOf, cell: (c) => (c.getValue() === 'customer' ? 'Customer' : 'Prospect') },
]
const FILTERS: TableFilter<Customer>[] = [
  { key: 'kind', label: 'Type', options: [{ value: 'customer', label: 'Customers' }, { value: 'prospect', label: 'Prospects' }], accessor: kindOf },
]
const SYSTEM_VIEWS: TableView[] = [
  { id: 'sys:customers', name: 'Customers (bought)', state: { sorting: [{ id: 'name', desc: false }], search: '', filters: { kind: 'customer' } } },
  { id: 'sys:prospects', name: 'Prospects (not sold yet)', state: { sorting: [{ id: 'name', desc: false }], search: '', filters: { kind: 'prospect' } } },
  { id: 'sys:everyone', name: 'Everyone', state: { sorting: [{ id: 'name', desc: false }], search: '', filters: {} } },
]

interface Props {
  customers: Customer[]
  query: string
  isAdmin?: boolean
}

export default function CustomersPageClient({ customers, query, isAdmin = false }: Props) {
  const router = useRouter()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isBackfilling, setIsBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState<string | null>(null)

  const handleBackfill = async () => {
    if (!(await confirmDialog({ title: 'This will scan all projects and jobs without a linked customer and attempt to link them. Continue?' }))) {
      return
    }
    
    setIsBackfilling(true)
    setBackfillResult(null)
    
    try {
      const res = await fetch('/api/admin/backfill-customers', { method: 'POST' })
      const data = await res.json()
      
      if (res.ok) {
        setBackfillResult(data.message)
        router.refresh()
      } else {
        setBackfillResult(`Error: ${data.error}`)
      }
    } catch (err) {
      setBackfillResult('Failed to run backfill')
    } finally {
      setIsBackfilling(false)
    }
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <button
              onClick={handleBackfill}
              disabled={isBackfilling}
              className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50 text-sm"
            >
              {isBackfilling ? 'Running...' : 'Backfill Missing Links'}
            </button>
          )}
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
          >
            Link / Create Customer
          </button>
        </div>
      </div>
      
      {backfillResult && (
        <div className={`mb-4 p-3 rounded-md text-sm ${backfillResult.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {backfillResult}
        </div>
      )}

      <DataTable
        columns={COLUMNS}
        data={customers}
        tableKey="customers"
        getRowId={(c) => c.id}
        getRowHref={(c) => `/customers/${c.id}`}
        searchPlaceholder="Search name, phone, email or address"
        filters={FILTERS}
        systemViews={SYSTEM_VIEWS}
        defaultViewId={query ? 'sys:everyone' : 'sys:customers'}
        initialSearch={query}
        initialSorting={[{ id: 'name', desc: false }]}
        empty={{ title: 'No customers match', body: 'Customers appear when an inspection is booked; the Customers view shows people who have bought.' }}
      />

      <LinkCreateCustomerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  )
}
