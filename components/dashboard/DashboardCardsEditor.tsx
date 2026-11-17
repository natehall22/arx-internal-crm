'use client'

import { useCallback, useEffect, useState } from 'react'

import type { DashboardMode } from '@/lib/dashboard-cards'

/**
 * Settings → Dashboard settings → "Dashboard cards": the owner adds, removes and reorders the dashboard's cards, sets a goal on
 * the cards that take one, and resets to the industry profile's starting set. Everything saves through
 * `/api/admin/dashboard-cards` (one writer, server-side validation against the catalog). Reorder is by buttons (works on a phone).
 */
type Offered = { key: string; label: string; description: string; group: string; goal: boolean; goalUnit: 'money' | 'percent' | 'count' }
type Entry = { key: string; goal: string }
type Loaded = {
  mode: DashboardMode
  editingMode: DashboardMode
  custom: boolean
  cards: Array<{ key: string; goal: number | null }>
  offered: Offered[]
  unavailable: Array<{ key: string; label: string; reason: string }>
  canBuildCards: boolean
  canEdit: boolean
}

const BTN = 'inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-900 disabled:opacity-40'

export default function DashboardCardsEditor({ onMode }: { onMode?: (mode: DashboardMode) => void }) {
  const [data, setData] = useState<Loaded | null>(null)
  const [list, setList] = useState<Entry[]>([])
  const [editingMode, setEditingMode] = useState<DashboardMode>('classic')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async (mode?: DashboardMode) => {
    const res = await fetch(`/api/admin/dashboard-cards${mode === 'cards' ? '?mode=cards' : ''}`)
    if (!res.ok) {
      setMessage({ kind: 'error', text: 'Could not load the dashboard cards.' })
      return
    }
    const d = (await res.json()) as Loaded
    setData(d)
    setEditingMode(d.editingMode)
    setList(d.cards.map((c) => ({ key: c.key, goal: c.goal ? String(c.goal) : '' })))
    onMode?.(d.mode)
  }, [onMode])

  useEffect(() => { void load() }, [load])

  if (!data) return message ? <p className="mb-6 text-sm text-red-700">{message.text}</p> : null

  const byKey = new Map(data.offered.map((o) => [o.key, o]))
  const reorderable = editingMode === 'cards'
  const move = (i: number, d: -1 | 1) => setList((l) => { const n = [...l]; const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n })
  const remove = (key: string) => setList((l) => l.filter((e) => e.key !== key))
  const add = (key: string) => setList((l) => (l.some((e) => e.key === key) ? l : [...l, { key, goal: '' }]))

  async function save() {
    setBusy(true)
    setMessage(null)
    const cards = list.map((e) => ({ key: e.key, goal: e.goal.trim() === '' ? null : Number(e.goal) }))
    const res = await fetch('/api/admin/dashboard-cards', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cards }) })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setMessage({ kind: 'error', text: body.error || 'Could not save.' })
    setMessage({ kind: 'ok', text: 'Saved. The dashboard shows this list now.' })
    await load()
  }

  async function reset() {
    setBusy(true)
    setMessage(null)
    const res = await fetch('/api/admin/dashboard-cards', { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) return setMessage({ kind: 'error', text: 'Could not reset.' })
    setMessage({ kind: 'ok', text: 'Back to the starting set.' })
    await load()
  }

  const onList = new Set(list.map((e) => e.key))
  const addable = data.offered.filter((o) => !onList.has(o.key))
  const groups = Array.from(new Set(addable.map((o) => o.group)))

  return (
    <section className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6" aria-label="Dashboard cards">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Dashboard cards</h2>
      <p className="text-sm text-gray-800 mb-4">
        {reorderable
          ? 'Choose the cards on your dashboard and their order. People see the cards that fit their role; money cards only show to people who can see financials.'
          : 'Choose which sections of the classic dashboard are shown. Their place on the page stays the same.'}
      </p>

      {message ? (
        <p role="status" className={`mb-4 rounded-lg border p-3 text-sm ${message.kind === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{message.text}</p>
      ) : null}

      <ol className="space-y-2 mb-4">
        {list.map((e, i) => {
          const o = byKey.get(e.key)
          return (
            <li key={e.key} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{o?.label ?? e.key}</p>
                  <p className="text-sm text-gray-700">{o?.description}</p>
                </div>
                {data.canEdit ? (
                  <div className="flex shrink-0 gap-1">
                    {reorderable ? (
                      <>
                        <button type="button" className={BTN} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${o?.label ?? e.key} up`}>↑</button>
                        <button type="button" className={BTN} onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Move ${o?.label ?? e.key} down`}>↓</button>
                      </>
                    ) : null}
                    <button type="button" className={BTN} onClick={() => remove(e.key)} aria-label={`Remove ${o?.label ?? e.key}`}>Remove</button>
                  </div>
                ) : null}
              </div>
              {o?.goal && reorderable ? (
                <label className="mt-3 flex flex-col gap-1 text-sm font-medium text-gray-800">
                  Goal {o.goalUnit === 'money' ? '($)' : ''} — shown as a progress bar (leave blank for none)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={e.goal}
                    disabled={!data.canEdit}
                    onChange={(ev) => setList((l) => l.map((x) => (x.key === e.key ? { ...x, goal: ev.target.value.replace(/[^0-9.]/g, '') } : x)))}
                    className="w-full sm:w-48 min-h-[44px] rounded-lg border border-gray-300 px-3 text-base text-gray-900"
                  />
                </label>
              ) : null}
            </li>
          )
        })}
        {list.length === 0 ? <li className="text-sm text-gray-800">No cards yet. Add one below.</li> : null}
      </ol>

      {data.canEdit && addable.length > 0 ? (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Add a card</h3>
          {groups.map((g) => (
            <div key={g} className="mb-3">
              {groups.length > 1 ? <p className="text-sm font-semibold uppercase tracking-wide text-gray-700 mb-1">{g}</p> : null}
              <ul className="space-y-2">
                {addable.filter((o) => o.group === g).map((o) => (
                  <li key={o.key} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">{o.label}</p>
                      <p className="text-sm text-gray-700">{o.description}</p>
                    </div>
                    <button type="button" className={BTN} onClick={() => add(o.key)} aria-label={`Add ${o.label}`}>Add</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {reorderable && data.unavailable.length > 0 ? (
        <details className="mb-4 text-sm text-gray-800">
          <summary className="min-h-[44px] flex items-center cursor-pointer font-medium text-gray-900">Not available yet ({data.unavailable.length})</summary>
          <ul className="space-y-2 mt-1">
            {data.unavailable.map((u) => (
              <li key={u.key} className="rounded-lg border border-dashed border-gray-300 p-3">
                <p className="font-medium text-gray-900">{u.label}</p>
                <p className="text-gray-700">{u.reason}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {data.canBuildCards && editingMode === 'classic' ? (
        <button type="button" className={`${BTN} mb-4`} onClick={() => void load('cards')}>Build a card dashboard instead</button>
      ) : null}

      {data.canEdit ? (
        <div className="sticky bottom-0 -mx-4 sm:mx-0 flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3 sm:border-0 sm:px-0">
          <button type="button" className={BTN} onClick={() => void reset()} disabled={busy}>Reset to starting set</button>
          <button type="button" onClick={() => void save()} disabled={busy || list.length === 0} className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">
            {busy ? 'Saving…' : 'Save cards'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-gray-800">{data.mode === 'classic' ? 'Only the owner can change which sections this dashboard shows.' : 'Only an owner or admin can change the cards.'}</p>
      )}
    </section>
  )
}
