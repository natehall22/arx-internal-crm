'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type ProjectSource = {
  id: string
  source_type: 'project'
  display_name: string
  address_text: string | null
  status?: string
  created_at?: string
  customer_id: string | null
  customer_name?: string | null
  customer_address?: string | null
  linked_customer_name?: string | null
}

interface Props {
  customerId: string
  customerName?: string | null
}

export default function LinkProjectToCustomerButton({ customerId, customerName }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [rows, setRows] = useState<ProjectSource[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/customers/sources?type=project&show_all=${showAll ? 'true' : 'false'}`
      )
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load projects')
      }
      const list = (data.projects || []) as ProjectSource[]
      setRows(
        list.filter(
          (p) => p.customer_id !== customerId
        )
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [showAll, customerId])

  useEffect(() => {
    if (open) {
      setSelectedId(null)
      void load()
    }
  }, [open, load])

  const selected = rows.find((r) => r.id === selectedId) || null

  const doLink = async () => {
    if (!selected) return
    if (selected.customer_id) {
      const other =
        selected.linked_customer_name || 'another account'
      const ok = confirm(
        `This project is currently linked to ${other}. Link it to ${customerName || 'this customer'} instead?`
      )
      if (!ok) return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/customers/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'link',
          customer_id: customerId,
          source_type: 'project',
          source_id: selected.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to link project')
      }
      setOpen(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to link')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 border border-indigo-600 text-indigo-700 bg-white rounded-lg hover:bg-indigo-50 text-sm font-medium"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
          />
        </svg>
        Link existing project
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => !submitting && setOpen(false)} />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Link a project to this customer</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Choose a project that should appear on this account. Unlinked projects are listed
                  by default; turn on the option below if the job is linked to the wrong account.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-3 border-b border-gray-100">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                  disabled={loading || submitting}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Include projects already linked to another customer
              </label>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-3 min-h-[12rem]">
              {loading && (
                <p className="text-sm text-gray-500">Loading projects…</p>
              )}
              {!loading && error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
              {!loading && !error && rows.length === 0 && (
                <p className="text-sm text-gray-500">
                  No projects to link from this list. Unlinked projects appear here first. If the job is
                  under another customer, turn on the option above. You can also confirm the project exists
                  from the main Projects page.
                </p>
              )}
              {!loading && !error && rows.length > 0 && (
                <ul className="space-y-2" role="list">
                  {rows.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className={`w-full text-left p-3 rounded-lg border text-sm transition-colors ${
                          selectedId === p.id
                            ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="font-medium text-gray-900">{p.display_name}</div>
                        <div className="text-gray-600 mt-0.5">{p.address_text || p.customer_address || '—'}</div>
                        {p.customer_id && (
                          <div className="text-amber-700 text-xs mt-1">
                            Currently: {p.linked_customer_name || 'other customer'}
                          </div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void doLink()}
                disabled={!selected || submitting}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Linking…' : 'Link project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
