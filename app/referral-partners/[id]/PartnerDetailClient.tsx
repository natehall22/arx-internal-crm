'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import TouchButtons from '@/components/referral-partners/TouchButtons'
import {
  assignedToLabel,
  formatOpensIn,
  partnerTypeLabel,
  type PartnerListItem,
} from '@/lib/referral-partners'
import { OwnerBadge } from '../ReferralPartnersClient'

type Detail = {
  partner: PartnerListItem
  can_work: boolean
  can_manage: boolean
  touches: Array<{ id: string; type: string; body: string; created_at: string; user: { full_name: string | null } | null }>
  assignment_log: Array<{
    id: string
    created_at: string
    reason: string
    to_status: string
    to_user: { full_name: string | null } | null
    by: { full_name: string | null } | null
  }>
  referred_count: number
  jobs_sold: number
  revenue_sold: number
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const dateFmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })

export default function PartnerDetailClient({
  partnerId,
  types,
  reps,
}: {
  partnerId: string
  types: Array<{ id: string; name: string }>
  reps: Array<{ id: string; full_name: string | null }>
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/referral-partners/${partnerId}`)
      if (res.status === 404) return setError('Partner not found')
      if (!res.ok) throw new Error()
      setDetail(await res.json())
      setError(null)
    } catch {
      setError('Could not load this partner. Check your connection.')
    }
  }, [partnerId])

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-3 py-6 sm:px-6">
        <p className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-900">{error}</p>
        <Link href="/referral-partners" className="mt-3 inline-block text-sm font-semibold text-indigo-700">
          ← Referral Partners
        </Link>
      </div>
    )
  }
  if (!detail) {
    return (
      <div className="mx-auto max-w-3xl px-3 py-6 sm:px-6">
        <div className="h-40 animate-pulse rounded-lg bg-gray-200" />
      </div>
    )
  }

  const { partner } = detail
  const opens = formatOpensIn(partner.days_until_open)

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-3 py-4 sm:px-6">
      <Link href="/referral-partners" className="text-sm font-semibold text-indigo-700">
        ← Referral Partners
      </Link>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-[#2c2c2a]">{partner.name}</h1>
            <p className="text-sm text-gray-700">
              {[partner.company, partnerTypeLabel(partner)].filter(Boolean).join(' · ')}
            </p>
          </div>
          <OwnerBadge partner={partner} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#2c2c2a]">
          {partner.phone && (
            <a href={`tel:${partner.phone}`} className="font-semibold text-indigo-700">
              {partner.phone}
            </a>
          )}
          {partner.email && (
            <a href={`mailto:${partner.email}`} className="font-semibold text-indigo-700">
              {partner.email}
            </a>
          )}
        </div>
        {partner.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-[#2c2c2a]">{partner.notes}</p>}
      </div>

      {detail.can_work && partner.status === 'assigned' && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-[#2c2c2a]">Log a touch</h2>
          <TouchButtons partnerId={partner.id} onLogged={() => void load()} />
        </div>
      )}

      {partner.status === 'open' && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-[#2c2c2a]">
          This partner is open. Ask an admin to assign it.
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <Fact
          label="Last touched"
          value={partner.status === 'assigned' || partner.status === 'open' ? dateFmt(partner.last_touched_at) : '—'}
        />
        <Fact
          label="Opens up"
          value={partner.status === 'company_relationship' ? 'Never' : (opens ?? '—').replace('Opens ', '')}
        />
        <Fact label="Jobs sold" value={`${detail.jobs_sold} · ${money.format(detail.revenue_sold)}`} />
      </div>
      <p className="-mt-2 text-center text-xs text-gray-700">{detail.referred_count} referred in total</p>

      {detail.can_work && <EditSection detail={detail} types={types} onSaved={() => void load()} />}
      {detail.can_manage && <ManageSection detail={detail} reps={reps} onDone={() => void load()} />}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-[#2c2c2a]">Touch history</h2>
        {detail.touches.length === 0 ? (
          <p className="text-sm text-gray-700">No touches logged yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {detail.touches.map((t) => (
              <li key={t.id} className="py-2 text-sm text-[#2c2c2a]">
                <span className="font-semibold">{t.body}</span>{' '}
                <span className="text-gray-700">
                  · {t.user?.full_name ?? 'Someone'} · {dateFmt(t.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {detail.assignment_log.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-[#2c2c2a]">Assignment history</h2>
          <ul className="divide-y divide-gray-100">
            {detail.assignment_log.map((l) => (
              <li key={l.id} className="py-2 text-sm text-[#2c2c2a]">
                <span className="font-semibold">
                  {l.to_status === 'assigned'
                    ? `Assigned To ${l.to_user?.full_name ?? 'unknown'}`
                    : l.to_status === 'open'
                      ? 'Opened up'
                      : 'Company Relationship'}
                </span>{' '}
                <span className="text-gray-700">
                  · {l.reason}
                  {l.by?.full_name ? ` · ${l.by.full_name}` : ''} · {dateFmt(l.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2 py-3">
      <p className="text-sm font-bold text-[#2c2c2a]">{value}</p>
      <p className="text-[11px] font-medium text-gray-700">{label}</p>
    </div>
  )
}

async function postAssignment(partnerId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/referral-partners/${partnerId}/assignment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Could not save')
}

function EditSection({
  detail,
  types,
  onSaved,
}: {
  detail: Detail
  types: Array<{ id: string; name: string }>
  onSaved: () => void
}) {
  const p = detail.partner
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    name: p.name,
    phone: p.phone ?? '',
    company: p.company ?? '',
    email: p.email ?? '',
    notes: p.notes ?? '',
    type_id: p.type_id,
    other_type_text: p.other_type_text ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-[#2c2c2a]'
  const isOther = types.find((t) => t.id === form.type_id)?.name.toLowerCase() === 'other'

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-indigo-700">
        Edit details
      </button>
    )
  }
  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
      <select value={form.type_id} onChange={(e) => setForm({ ...form, type_id: e.target.value })} className={input}>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {isOther && (
        <input value={form.other_type_text} onChange={(e) => setForm({ ...form, other_type_text: e.target.value })} placeholder="What kind?" className={input} />
      )}
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" className={input} />
      <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} type="tel" placeholder="Phone" className={input} />
      <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Company" className={input} />
      <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" placeholder="Email" className={input} />
      <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Notes" className={input} />
      {error && <p className="text-sm font-medium text-red-800">{error}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              const res = await fetch(`/api/referral-partners/${p.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
              })
              const json = await res.json().catch(() => ({}))
              if (res.status === 409 && json.partner) {
                throw new Error(`That phone is already ${json.partner.name} (${assignedToLabel(json.partner)})`)
              }
              if (!res.ok) throw new Error(json.error || 'Could not save')
              setOpen(false)
              onSaved()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not save')
            } finally {
              setBusy(false)
            }
          }}
          className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-semibold text-gray-700">
          Cancel
        </button>
      </div>
    </div>
  )
}

function ManageSection({
  detail,
  reps,
  onDone,
}: {
  detail: Detail
  reps: Array<{ id: string; full_name: string | null }>
  onDone: () => void
}) {
  const [userId, setUserId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await postAssignment(detail.partner.id, { ...body, reason })
      setReason('')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-[#2c2c2a]'
  return (
    <div className="space-y-2 rounded-xl border border-gray-300 bg-white p-4">
      <h2 className="text-sm font-semibold text-[#2c2c2a]">Admin</h2>
      <select value={userId} onChange={(e) => setUserId(e.target.value)} className={input}>
        <option value="">Assigned To…</option>
        {reps.map((r) => (
          <option key={r.id} value={r.id}>
            {r.full_name ?? r.id}
          </option>
        ))}
      </select>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className={input} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !userId || !reason.trim()}
          onClick={() => run({ action: 'reassign', user_id: userId })}
          className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Reassign
        </button>
        {detail.partner.status !== 'company_relationship' && (
          <button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() => run({ action: 'company_relationship' })}
            className="rounded-lg border border-gray-400 px-3 py-2 text-sm font-semibold text-[#2c2c2a] disabled:opacity-40"
          >
            Mark Company Relationship
          </button>
        )}
        {detail.partner.status !== 'open' && (
          <button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() => run({ action: 'open' })}
            className="rounded-lg border border-gray-400 px-3 py-2 text-sm font-semibold text-[#2c2c2a] disabled:opacity-40"
          >
            Make open
          </button>
        )}
      </div>
      {error && <p className="text-sm font-medium text-red-800">{error}</p>}
    </div>
  )
}
