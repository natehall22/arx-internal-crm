'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { usePartnerSearch } from '@/components/referral-partners/usePartnerSearch'
import {
  assignedToLabel,
  formatOpensIn,
  partnerTypeLabel,
  type PartnerListItem,
  type ReferralPartnerStatus,
} from '@/lib/referral-partners'

type Scope = 'all' | 'mine' | 'open'

const SCOPES: Array<{ id: Scope; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Assigned To me' },
  { id: 'open', label: 'Open' },
]

export function OwnerBadge({ partner }: { partner: Pick<PartnerListItem, 'status' | 'assignee' | 'is_mine'> }) {
  const tone: Record<ReferralPartnerStatus, string> = {
    assigned: partner.is_mine ? 'bg-green-100 text-green-900' : 'bg-gray-100 text-[#2c2c2a]',
    open: 'bg-amber-100 text-amber-900',
    company_relationship: 'bg-blue-100 text-blue-900',
  }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${tone[partner.status]}`}>
      {partner.is_mine ? 'Assigned To you' : `Assigned To: ${assignedToLabel(partner)}`.replace('Assigned To: Open', 'Open')}
    </span>
  )
}

export default function ReferralPartnersClient({
  types,
  canManage,
}: {
  types: Array<{ id: string; name: string }>
  canManage: boolean
}) {
  const params = useSearchParams()
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [adding, setAdding] = useState(params.get('add') === '1')
  const addParam = params.get('add')
  useEffect(() => {
    if (addParam === '1') setAdding(true)
  }, [addParam])
  const { partners, loading, error } = usePartnerSearch(query, scope)

  return (
    <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-[#2c2c2a]">Referral Partners</h1>
        <div className="flex items-center gap-3">
          {canManage && (
            <Link href="/referral-partners/manage" className="text-sm font-semibold text-indigo-700 hover:underline">
              Manage
            </Link>
          )}
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-700"
          >
            {adding ? 'Close' : '+ Add Partner'}
          </button>
        </div>
      </div>

      <input
        type="search"
        autoFocus={!adding}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, company or phone"
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-base text-[#2c2c2a]"
      />

      {adding && (
        <AddPartnerForm
          types={types}
          initialName={query.match(/\d/) ? '' : query}
          initialPhone={query.match(/^[\d\s()+.-]+$/) ? query : ''}
        />
      )}

      <div className="mt-3 flex gap-2">
        {SCOPES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setScope(s.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
              scope === s.id ? 'bg-gray-800 text-white' : 'bg-white text-[#2c2c2a] border border-gray-300'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-900">{error}</p>}
        {loading && partners.length === 0 && <div className="h-20 animate-pulse rounded-lg bg-gray-200" />}
        {!loading && !error && partners.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center">
            {query || scope !== 'all' ? (
              <p className="text-sm text-[#2c2c2a]">
                No match.{' '}
                {query && (
                  <button type="button" onClick={() => setAdding(true)} className="font-semibold text-indigo-700">
                    Add &ldquo;{query}&rdquo;
                  </button>
                )}
              </p>
            ) : (
              <p className="text-sm text-[#2c2c2a]">
                Add the agents and partners you network with. They&apos;re yours, and you get paid on jobs they send.
              </p>
            )}
          </div>
        )}
        {partners.map((p) => (
          <PartnerRow key={p.id} partner={p} />
        ))}
      </div>
    </div>
  )
}

function PartnerRow({ partner }: { partner: PartnerListItem }) {
  const opens = formatOpensIn(partner.days_until_open)
  return (
    <Link
      href={`/referral-partners/${partner.id}`}
      className="block rounded-lg border border-gray-200 bg-white p-3 hover:border-gray-400"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-[#2c2c2a]">{partner.name}</p>
          <p className="truncate text-sm text-gray-700">
            {[partner.company, partnerTypeLabel(partner), partner.phone].filter(Boolean).join(' · ')}
          </p>
        </div>
        <OwnerBadge partner={partner} />
      </div>
      {(opens || partner.similar) && (
        <p className="mt-1 text-xs font-medium text-gray-700">
          {partner.similar ? 'Similar spelling' : ''}
          {partner.similar && opens ? ' · ' : ''}
          {partner.is_mine ? opens : ''}
        </p>
      )}
    </Link>
  )
}

function AddPartnerForm({
  types,
  initialName,
  initialPhone,
}: {
  types: Array<{ id: string; name: string }>
  initialName: string
  initialPhone: string
}) {
  const router = useRouter()
  const [typeId, setTypeId] = useState('')
  const [otherText, setOtherText] = useState('')
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone)
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [more, setMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existing, setExisting] = useState<PartnerListItem | null>(null)

  const isOther = types.find((t) => t.id === typeId)?.name.toLowerCase() === 'other'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setExisting(null)
    try {
      const res = await fetch('/api/referral-partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type_id: typeId,
          other_type_text: otherText,
          name,
          phone,
          company,
          email,
          notes,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409 && json.partner) {
        setExisting(json.partner)
        return
      }
      if (!res.ok) throw new Error(json.error || 'Could not save')
      router.push(`/referral-partners/${json.partner.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-3 text-base text-[#2c2c2a]'

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border border-gray-200 bg-white p-3">
      <select value={typeId} onChange={(e) => setTypeId(e.target.value)} required className={input}>
        <option value="">Type…</option>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {isOther && (
        <input value={otherText} onChange={(e) => setOtherText(e.target.value)} placeholder="What kind?" className={input} />
      )}
      <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Name" className={input} />
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        required
        type="tel"
        inputMode="tel"
        placeholder="Phone"
        className={input}
      />
      <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company (optional)" className={input} />
      {more ? (
        <>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email (optional)" className={input} />
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2} className={input} />
        </>
      ) : (
        <button type="button" onClick={() => setMore(true)} className="text-sm font-semibold text-indigo-700">
          + Email, notes
        </button>
      )}

      {existing && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-[#2c2c2a]">
          That phone number is already in the system:{' '}
          <Link href={`/referral-partners/${existing.id}`} className="font-semibold text-indigo-700 underline">
            {existing.name}
          </Link>{' '}
          — {existing.status === 'assigned' ? `Assigned To ${assignedToLabel(existing)}` : assignedToLabel(existing)}.
        </div>
      )}
      {error && <p className="text-sm font-medium text-red-800">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-indigo-700 px-4 py-3 text-base font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save — Assigned To me'}
      </button>
    </form>
  )
}
