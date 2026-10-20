'use client'

import Link from 'next/link'
import { useState } from 'react'

import { usePartnerSearch } from '@/components/referral-partners/usePartnerSearch'
import { assignedToLabel, partnerTypeLabel } from '@/lib/referral-partners'

type Current = { id: string; name: string; assigned_to: string } | null

/** "Referred By" on an opportunity: search a partner, pick it, done. */
export default function ReferredByPicker({
  opportunityId,
  current,
  canEdit,
}: {
  opportunityId: string
  current: Current
  canEdit: boolean
}) {
  const [selected, setSelected] = useState<Current>(current)
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { partners, loading } = usePartnerSearch(query, 'all', editing)

  async function save(partnerId: string | null, next: Current) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referral_partner_id: partnerId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not save')
      setSelected(next)
      setEditing(false)
      setQuery('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Referred By</p>
      {!editing ? (
        <div className="mt-0.5 text-sm text-[#2c2c2a]">
          {selected ? (
            <>
              <Link href={`/referral-partners/${selected.id}`} className="font-medium text-indigo-700 hover:underline">
                {selected.name}
              </Link>
              <span className="text-gray-700"> · {selected.assigned_to}</span>{' '}
            </>
          ) : (
            <span className="text-gray-600">None </span>
          )}
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)} className="font-semibold text-indigo-700 hover:underline">
              {selected ? 'Change' : '+ Add'}
            </button>
          )}
        </div>
      ) : (
        <div className="relative mt-1">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search partner name, company or phone"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-[#2c2c2a]"
          />
          <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
            {loading && <li className="px-3 py-2 text-sm text-gray-700">Searching…</li>}
            {!loading && partners.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-700">
                No match.{' '}
                <Link href="/referral-partners?add=1" className="font-semibold text-indigo-700">
                  Add a partner
                </Link>
              </li>
            )}
            {partners.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => save(p.id, { id: p.id, name: p.name, assigned_to: assignedToLabel(p) })}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                >
                  <span className="font-medium text-[#2c2c2a]">{p.name}</span>
                  <span className="text-gray-700">
                    {p.company ? ` · ${p.company}` : ''} · {partnerTypeLabel(p)} · {assignedToLabel(p)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex gap-3 text-xs font-semibold">
            <button type="button" onClick={() => setEditing(false)} className="text-gray-700 hover:underline">
              Cancel
            </button>
            {selected && (
              <button type="button" disabled={saving} onClick={() => save(null, null)} className="text-red-800 hover:underline">
                Clear
              </button>
            )}
          </div>
          {error && <p className="mt-1 text-xs font-medium text-red-800">{error}</p>}
        </div>
      )}
      {!editing && error && <p className="mt-1 text-xs font-medium text-red-800">{error}</p>}
    </div>
  )
}
