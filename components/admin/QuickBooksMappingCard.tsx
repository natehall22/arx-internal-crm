'use client'

import { useCallback, useEffect, useState } from 'react'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from '@/components/ui'
import type { MappingScreen } from '@/lib/quickbooks/mapping-screen'
import type { QbSettings } from '@/lib/quickbooks/mapping'

const FIELD = 'min-h-tap w-full rounded-ui border border-surface-line bg-white px-3 text-base text-ink'
const LABEL = 'flex flex-col gap-1 text-ui-base font-semibold text-ink'
const HINT = 'text-ui-sm font-normal text-ink'

type Pick = { id: string; name: string }

function Select({ value, onChange, options, none }: { value: string | null; onChange: (v: string | null) => void; options: Pick[]; none: string }) {
  return (
    <select className={FIELD} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{none}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  )
}

/**
 * Settings → QuickBooks → "What goes where" (owners). Plain-words mapping: every choice is one of the company's OWN QuickBooks
 * lists, pre-picked where there is an obvious answer. Nothing is sent until "Start sending". /api/admin/quickbooks/mapping.
 */
export default function QuickBooksMappingCard({ initial = null }: { initial?: MappingScreen | null }) {
  const [screen, setScreen] = useState<MappingScreen | null>(initial)
  const [draft, setDraft] = useState<QbSettings | null>(initial ? initial.settings : null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/quickbooks/mapping', { cache: 'no-store' }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as MappingScreen & { error?: string }) : null
    if (!res || !res.ok || !data) {
      setError(data?.error ?? 'Could not load your QuickBooks lists.')
      return
    }
    setError(null)
    setScreen(data)
    // First time through: start from the obvious picks, never over something already saved.
    const s = data.settings
    const g = data.suggested
    setDraft({
      ...s,
      startDate: s.startDate ?? g.startDate ?? null,
      income: { ...s.income, defaultItemId: s.income.defaultItemId ?? g.income?.defaultItemId ?? null },
      tax: s.tax.mode !== 'none' || s.tax.taxCodeId ? s.tax : { ...s.tax, ...(g.tax ?? {}) },
      depositToAccountId: s.depositToAccountId ?? g.depositToAccountId ?? null,
      receivablesAccountId: s.receivablesAccountId ?? g.receivablesAccountId ?? null,
      bills: { ...s.bills, expenseAccountId: s.bills.expenseAccountId ?? g.bills?.expenseAccountId ?? null },
    })
  }, [])

  useEffect(() => {
    if (!initial) void load()
  }, [initial, load])

  async function save(confirm: boolean) {
    if (!draft) return
    setBusy(true)
    const res = await fetch('/api/admin/quickbooks/mapping', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, confirm }) }).catch(() => null)
    const data = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : null
    setBusy(false)
    if (!res || !res.ok) {
      toast.error(data?.error ?? 'Could not save. Please try again.')
      return
    }
    toast.success(confirm ? 'Saved. QuickBooks sending is on from your start date.' : 'Saved')
    await load()
  }

  if (error) return <Card id="quickbooks-mapping"><CardHeader><CardTitle>What goes where in QuickBooks</CardTitle></CardHeader><CardContent><p role="status" className="text-ui-base font-semibold text-ink">{error}</p></CardContent></Card>
  if (!screen || !draft) return <Card id="quickbooks-mapping"><CardContent><p className="text-ui-sm text-ink">Loading your QuickBooks lists…</p></CardContent></Card>

  const { lists } = screen
  const set = (patch: Partial<QbSettings>) => setDraft({ ...draft, ...patch })
  const live = Boolean(screen.settings.confirmedAt)
  const code = lists.taxCodes.find((c) => c.id === draft.tax.taxCodeId) ?? null

  return (
    <Card id="quickbooks-mapping" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>What goes where in QuickBooks</CardTitle>
        {live ? <Badge tone="success">Sending</Badge> : <Badge tone="warning">Not sending yet</Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-ui-base text-ink">Pick where each kind of money lands. These are your own QuickBooks lists. Nothing is sent until you tap Start sending, and nothing dated before your start date is ever sent.</p>

        {screen.problems.length ? (
          <ul className="list-disc rounded-ui border border-surface-line bg-surface-subtle p-3 pl-6 text-ui-base font-semibold text-ink">
            {screen.problems.map((p) => <li key={p.field}>{p.message}</li>)}
          </ul>
        ) : null}

        <label className={LABEL}>
          Start date
          <input type="date" className={FIELD} value={draft.startDate ?? ''} max={undefined} onChange={(e) => set({ startDate: e.target.value || null })} />
          <span className={HINT}>Your bookkeeper’s books are closed before this. Invoices, payments and bills dated earlier are never sent.</span>
        </label>

        <label className={LABEL}>
          How should jobs become invoices?
          <select className={FIELD} value={draft.invoiceMode} onChange={(e) => set({ invoiceMode: e.target.value as QbSettings['invoiceMode'] })}>
            <option value="per_job">One invoice per job (roofing: the sale amount, updated when a change order is signed)</option>
            <option value="per_invoice">Every invoice I send from the CRM</option>
          </select>
        </label>

        <label className={LABEL}>
          Sales go to this item
          <Select value={draft.income.defaultItemId} onChange={(v) => set({ income: { ...draft.income, defaultItemId: v } })} options={lists.items} none="Choose a QuickBooks item" />
          <span className={HINT}>The item decides the income account your bookkeeper sees.</span>
        </label>
        {screen.tradeSlugs.length > 1 ? (
          <div className="flex flex-col gap-2">
            <p className="text-ui-base font-semibold text-ink">Different item for a trade (optional)</p>
            {screen.tradeSlugs.map((t) => (
              <label key={t.slug} className={LABEL}>
                {t.label}
                <Select
                  value={draft.income.byTrade[t.slug] ?? null}
                  onChange={(v) => {
                    const byTrade = { ...draft.income.byTrade }
                    if (v) byTrade[t.slug] = v
                    else delete byTrade[t.slug]
                    set({ income: { ...draft.income, byTrade } })
                  }}
                  options={lists.items}
                  none="Same as above"
                />
              </label>
            ))}
          </div>
        ) : null}

        <label className={LABEL}>
          Customer payments are deposited to
          <Select value={draft.depositToAccountId} onChange={(v) => set({ depositToAccountId: v })} options={lists.depositAccounts} none="Choose an account" />
          <span className={HINT}>Often “Undeposited Funds”, so your bookkeeper matches the bank deposit.</span>
        </label>

        {lists.receivableAccounts.length > 1 ? (
          <label className={LABEL}>
            Money owed to you (receivables)
            <Select value={draft.receivablesAccountId} onChange={(v) => set({ receivablesAccountId: v })} options={lists.receivableAccounts} none="Choose an account" />
          </label>
        ) : null}

        <label className={LABEL}>
          Sales tax
          <select className={FIELD} value={draft.tax.mode} onChange={(e) => set({ tax: { ...draft.tax, mode: e.target.value as QbSettings['tax']['mode'] } })}>
            <option value="none">I don’t charge sales tax</option>
            <option value="quickbooks">QuickBooks works out the tax (automatic sales tax)</option>
            <option value="code">Send the tax the CRM worked out</option>
          </select>
        </label>
        {draft.tax.mode === 'code' ? (
          <>
            <label className={LABEL}>
              Taxable sales use this QuickBooks tax code
              <Select value={draft.tax.taxCodeId} onChange={(v) => set({ tax: { ...draft.tax, taxCodeId: v, rateMap: {} } })} options={lists.taxCodes.map((c) => ({ id: c.id, name: c.name }))} none="Choose a tax code" />
            </label>
            {code
              ? screen.crmRates.filter((r) => r.active).map((r) => (
                  <label key={r.id} className={LABEL}>
                    {r.name} ({r.percent}%) is this QuickBooks rate
                    <Select
                      value={draft.tax.rateMap[r.id] ?? null}
                      onChange={(v) => {
                        const rateMap = { ...draft.tax.rateMap }
                        if (v) rateMap[r.id] = v
                        else delete rateMap[r.id]
                        set({ tax: { ...draft.tax, rateMap } })
                      }}
                      options={code.rates.map((x) => ({ id: x.id, name: x.name }))}
                      none="Choose a rate"
                    />
                  </label>
                ))
              : null}
          </>
        ) : null}

        <label className="flex min-h-tap items-center gap-3 text-ui-base font-semibold text-ink">
          <input type="checkbox" className="h-5 w-5" checked={draft.bills.enabled} onChange={(e) => set({ bills: { ...draft.bills, enabled: e.target.checked } })} />
          Send approved subcontractor and supplier bills
        </label>
        {draft.bills.enabled ? (
          <>
            <label className={LABEL}>
              Bills are booked to this expense account
              <Select value={draft.bills.expenseAccountId} onChange={(v) => set({ bills: { ...draft.bills, expenseAccountId: v } })} options={lists.expenseAccounts} none="Choose an account" />
            </label>
            {lists.classes.length ? (
              <label className={LABEL}>
                Class (optional)
                <Select value={draft.bills.classId} onChange={(v) => set({ bills: { ...draft.bills, classId: v } })} options={lists.classes} none="No class" />
              </label>
            ) : null}
            {screen.vendors.length ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="text-ui-base font-semibold text-ink">Report to the IRS as a 1099 vendor</legend>
                {screen.vendors.map((v) => (
                  <label key={v.id} className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={draft.vendors1099.includes(v.id)}
                      onChange={(e) => set({ vendors1099: e.target.checked ? [...draft.vendors1099, v.id] : draft.vendors1099.filter((x) => x !== v.id) })}
                    />
                    {v.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
          </>
        ) : null}

        {screen.preview ? (
          <p className="rounded-ui border border-surface-line bg-surface-subtle p-3 text-ui-sm text-ink">
            From your start date this would send {screen.preview.invoices} invoice(s), {screen.preview.payments} payment(s) and {screen.preview.bills} bill(s) not yet sent.
          </p>
        ) : null}

        <div className="sticky bottom-0 flex flex-wrap gap-2 bg-white py-2">
          <Button variant="secondary" className="min-h-tap" loading={busy} onClick={() => void save(false)}>Save</Button>
          <Button className="min-h-tap" loading={busy} onClick={() => void save(true)}>{live ? 'Save and keep sending' : 'Start sending'}</Button>
        </div>
      </CardContent>
    </Card>
  )
}
