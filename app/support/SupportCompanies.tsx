'use client'

import { useState } from 'react'

type Company = { orgId: string; name: string; always: boolean; expiresAt: string | null; users: Array<{ id: string; name: string; role: string }> }

const until = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function SupportCompanies({ companies }: { companies: Company[] }) {
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function enter(orgId: string, actingAsUserId: string | null) {
    setBusy(orgId)
    setError(null)
    try {
      const res = await fetch('/api/support/enter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId, actingAsUserId }) })
      const j = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string }
      if (!res.ok || !j.redirect) throw new Error(j.error || 'Could not enter')
      window.location.assign(j.redirect)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enter')
      setBusy(null)
    }
  }

  if (companies.length === 0) return <p className="text-[16px] text-[#2c2c2a]">No company has support access on right now.</p>
  return (
    <div className="flex flex-col gap-3">
      {error ? <p role="alert" className="text-[16px] font-semibold text-red-800">{error}</p> : null}
      {companies.map((c) => (
        <section key={c.orgId} className="rounded-xl border border-gray-300 bg-white p-4">
          <h2 className="text-[18px] font-semibold text-[#2c2c2a]">{c.name}</h2>
          <p className="mb-3 text-[14px] text-[#2c2c2a]">{c.always ? 'Always on' : `Allowed until ${until(c.expiresAt!)}`}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" disabled={busy !== null} onClick={() => void enter(c.orgId, null)} className="min-h-[44px] rounded-lg bg-indigo-700 px-4 text-[16px] font-semibold text-white disabled:opacity-60">
              Enter as owner
            </button>
            <select aria-label={`User at ${c.name}`} value={picked[c.orgId] ?? ''} onChange={(e) => setPicked({ ...picked, [c.orgId]: e.target.value })} className="min-h-[44px] flex-1 rounded-lg border border-gray-400 bg-white px-3 text-[16px] text-[#2c2c2a]">
              <option value="">Pick a user…</option>
              {c.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
            <button type="button" disabled={busy !== null || !picked[c.orgId]} onClick={() => void enter(c.orgId, picked[c.orgId])} className="min-h-[44px] rounded-lg border border-indigo-700 px-4 text-[16px] font-semibold text-indigo-800 disabled:opacity-60">
              Enter as user
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
