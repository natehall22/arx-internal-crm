'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

interface FinancingProgram {
  id: string
  lender_name: string
  financing_rate: number
  term_months: number
  dealer_fee_percent: number
  sort_order: number
  active: boolean
}

export default function AdminFinancingProgramsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [programs, setPrograms] = useState<FinancingProgram[]>([])
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<FinancingProgram | null>(null)
  const [form, setForm] = useState({
    lender_name: '',
    financing_rate: '9.99',
    term_months: '60',
    dealer_fee_percent: '0',
    sort_order: '0',
  })

  useEffect(() => {
    loadPrograms()
  }, [])

  const loadPrograms = async () => {
    try {
      const res = await fetch('/api/admin/financing-programs')
      if (res.status === 401) {
        router.push('/login')
        return
      }
      if (res.status === 403) {
        router.push('/dashboard')
        return
      }
      if (!res.ok) return
      const data = await res.json()
      setPrograms(data.programs || [])
    } finally {
      setLoading(false)
    }
  }

  const openNew = () => {
    setEditing(null)
    setForm({
      lender_name: '',
      financing_rate: '9.99',
      term_months: '60',
      dealer_fee_percent: '0',
      sort_order: '0',
    })
    setShowModal(true)
  }

  const openEdit = (p: FinancingProgram) => {
    setEditing(p)
    setForm({
      lender_name: p.lender_name,
      financing_rate: String(p.financing_rate),
      term_months: String(p.term_months),
      dealer_fee_percent: String(p.dealer_fee_percent),
      sort_order: String(p.sort_order),
    })
    setShowModal(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const body = editing
        ? {
            id: editing.id,
            lender_name: form.lender_name.trim(),
            financing_rate: parseFloat(form.financing_rate) || 0,
            term_months: parseInt(form.term_months, 10) || 60,
            dealer_fee_percent: parseFloat(form.dealer_fee_percent) || 0,
            sort_order: parseInt(form.sort_order, 10) || 0,
          }
        : {
            lender_name: form.lender_name.trim(),
            financing_rate: parseFloat(form.financing_rate) || 0,
            term_months: parseInt(form.term_months, 10) || 60,
            dealer_fee_percent: parseFloat(form.dealer_fee_percent) || 0,
            sort_order: parseInt(form.sort_order, 10) || 0,
          }

      const res = await fetch('/api/admin/financing-programs', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Save failed')
        return
      }
      setShowModal(false)
      await loadPrograms()
    } finally {
      setSaving(false)
    }
  }

  const deactivate = async (id: string) => {
    if (!confirm('Deactivate this program?')) return
    const res = await fetch(`/api/admin/financing-programs?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (res.ok) await loadPrograms()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="flex justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/admin" className="text-sm text-indigo-600 hover:text-indigo-800 mb-2 inline-block">
              ← Admin
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Financing programs</h1>
            <p className="text-gray-600 mt-1">
              Lender name, APR, term, and dealer fee (% of financed contract total). Dealer fee is internal — not shown to
              customers or reps in proposal UIs.
            </p>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
          >
            Add program
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lender</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">APR %</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Term (mo)</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dealer fee %</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {programs.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{p.lender_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{p.financing_rate}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{p.term_months}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{p.dealer_fee_percent}</td>
                  <td className="px-4 py-3 text-sm">{p.active ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button type="button" onClick={() => openEdit(p)} className="text-indigo-600 text-sm font-medium">
                      Edit
                    </button>
                    {p.active && (
                      <button type="button" onClick={() => deactivate(p.id)} className="text-red-600 text-sm font-medium">
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {programs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    No programs yet. Add one to appear in the proposal builder.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">{editing ? 'Edit program' : 'New program'}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lender name</label>
                <input
                  value={form.lender_name}
                  onChange={(e) => setForm((f) => ({ ...f, lender_name: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="e.g. Service Finance"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">APR (%)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={form.financing_rate}
                    onChange={(e) => setForm((f) => ({ ...f, financing_rate: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Term (months)</label>
                  <input
                    type="number"
                    value={form.term_months}
                    onChange={(e) => setForm((f) => ({ ...f, term_months: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dealer fee (% of financed total)</label>
                <input
                  type="number"
                  step="0.001"
                  value={form.dealer_fee_percent}
                  onChange={(e) => setForm((f) => ({ ...f, dealer_fee_percent: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2"
                />
                <p className="text-xs text-gray-500 mt-1">Internal only — not shown on customer or rep proposal views.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sort order</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !form.lender_name.trim()}
                onClick={save}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
