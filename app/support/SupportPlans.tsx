'use client'

import { useState } from 'react'

import { ORG_FEATURE_DEFS, ORG_FEATURE_KEYS, type OrgFeature, type OrgFeatures } from '@/lib/org-features'

export type PlanCompanyRow = { orgId: string; name: string; profileLabel: string; entitlements: OrgFeatures; unrestricted: boolean }

/** /support → Plans: pick a company, switch each module's entitlement. Platform staff only (the page and PATCH /api/support/plans both check). */
export default function SupportPlans({ companies }: { companies: PlanCompanyRow[] }) {
  const [rows, setRows] = useState<PlanCompanyRow[]>(companies)
  const [orgId, setOrgId] = useState(companies[0]?.orgId ?? '')
  const [busy, setBusy] = useState<OrgFeature | null>(null)
  const [error, setError] = useState<string | null>(null)
  const company = rows.find((c) => c.orgId === orgId) ?? null

  async function toggle(feature: OrgFeature) {
    if (!company) return
    setBusy(feature)
    setError(null)
    try {
      const res = await fetch('/api/support/plans', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId: company.orgId, feature, entitled: !company.entitlements[feature] }) })
      const j = (await res.json().catch(() => ({}))) as { entitlements?: OrgFeatures; error?: string }
      if (!res.ok || !j.entitlements) throw new Error(j.error || 'Could not save')
      setRows((all) => all.map((c) => (c.orgId === company.orgId ? { ...c, entitlements: j.entitlements!, unrestricted: false } : c)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(null)
    }
  }

  if (rows.length === 0) return null
  return (
    <section aria-labelledby="plans-h" className="mt-8 rounded-xl border border-gray-300 bg-white p-4">
      <h2 id="plans-h" className="text-[18px] font-semibold text-[#2c2c2a]">Plans</h2>
      <p className="mb-3 text-[16px] text-[#2c2c2a]">Which modules a company may use. A module that is not in the plan is off for that company and its owner cannot turn it on. Nothing is deleted. Every change is logged.</p>
      <label className="mb-1 block text-[14px] font-semibold text-[#2c2c2a]" htmlFor="plans-company">Company</label>
      <select id="plans-company" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="mb-3 min-h-[44px] w-full rounded-lg border border-gray-400 bg-white px-3 text-[16px] text-[#2c2c2a]">
        {rows.map((c) => (
          <option key={c.orgId} value={c.orgId}>{c.name}</option>
        ))}
      </select>
      {company ? (
        <>
          <p className="mb-2 text-[14px] text-[#2c2c2a]">
            Profile: <span className="font-semibold">{company.profileLabel}</span>
            {company.unrestricted ? ' · No plan set yet (every module allowed)' : ''}
          </p>
          {error ? <p role="alert" className="mb-2 text-[16px] font-semibold text-red-800">{error}</p> : null}
          <ul className="divide-y divide-gray-200">
            {ORG_FEATURE_KEYS.map((key) => {
              const on = company.entitlements[key]
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[16px] font-semibold text-[#2c2c2a]">
                      {ORG_FEATURE_DEFS[key].label} <span className={on ? 'text-green-800' : 'text-red-800'}>· {on ? 'In plan' : 'Not in plan'}</span>
                    </p>
                    <p className="text-[14px] text-[#2c2c2a]">{ORG_FEATURE_DEFS[key].description}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    aria-pressed={on}
                    aria-label={`${on ? 'Remove' : 'Add'} ${ORG_FEATURE_DEFS[key].label} ${on ? 'from' : 'to'} ${company.name}`}
                    onClick={() => void toggle(key)}
                    className={`min-h-[44px] min-w-[7rem] rounded-lg px-4 text-[16px] font-semibold disabled:opacity-60 ${on ? 'border border-indigo-700 text-indigo-800' : 'bg-indigo-700 text-white'}`}
                  >
                    {busy === key ? 'Saving…' : on ? 'Remove' : 'Add'}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </section>
  )
}
