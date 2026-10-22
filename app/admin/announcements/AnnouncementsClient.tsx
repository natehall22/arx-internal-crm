'use client'

import { useCallback, useEffect, useState } from 'react'

import { DEFAULT_WINDOW_DAYS, MAX_LINES_PER_GROUP, ROLE_GROUPS, ROLE_GROUP_LABELS, type AnnouncementBody, type RoleGroup } from '@/lib/announcements'

type Person = { name: string | null; at?: string }
type Announcement = {
  id?: string
  slug: string
  title: string
  body: AnnouncementBody
  link_url: string
  starts_at: string
  ends_at: string
  active: boolean
  dismissed?: Person[]
  not_dismissed?: Person[]
}

const ctl = 'block w-full min-h-[44px] rounded-lg border border-[#8a877d] bg-white px-3 py-2 text-base text-[#2c2c2a]'
const btn = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#5f5e5a] bg-white px-4 py-2 text-sm font-semibold text-[#2c2c2a] disabled:opacity-50'
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function blank(): Announcement {
  const start = new Date()
  const end = new Date(start.getTime() + DEFAULT_WINDOW_DAYS * 86400000)
  const slug = `whats-new-${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`
  return { slug, title: "What's new", body: {}, link_url: '/whats-new', starts_at: start.toISOString(), ends_at: end.toISOString(), active: true }
}

export default function AnnouncementsClient() {
  const [items, setItems] = useState<Announcement[]>([])
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState<Announcement | null>(null)
  const [text, setText] = useState<Record<RoleGroup, string>>({ owner: '', ops: '', closer: '', setter: '' })
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/announcements')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setMessage(json.error || 'Could not load announcements')
    else setItems(json.announcements)
    setLoaded(true)
  }, [])
  useEffect(() => { void load() }, [load])

  const open = (a: Announcement) => {
    setDraft({ ...a })
    setText({
      owner: (a.body.owner ?? []).join('\n'), ops: (a.body.ops ?? []).join('\n'),
      closer: (a.body.closer ?? []).join('\n'), setter: (a.body.setter ?? []).join('\n'),
    })
    setError(null)
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    const body: AnnouncementBody = {}
    for (const g of ROLE_GROUPS) {
      const lines = text[g].split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length) body[g] = lines
    }
    const res = await fetch('/api/admin/announcements', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draft, body }),
    })
    const json = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return setError(json.error || 'Could not save')
    setDraft(null)
    setMessage('Saved.')
    await load()
  }

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24 text-[#2c2c2a]">
      <h1 className="mb-1 mt-0 text-2xl font-bold">Announcements</h1>
      <p className="mb-4 text-sm">The &quot;What&apos;s new&quot; banner. Each role gets its own short copy (at most {MAX_LINES_PER_GROUP} lines). It shows between the start and end dates and stops on its own.</p>
      {message && <p role="status" className="mb-3 rounded-lg border border-[#d3d1c7] bg-white p-3 text-sm">{message}</p>}
      {!loaded && <p>Loading…</p>}
      <ul className="m-0 list-none space-y-3 p-0">
        {items.map((a) => (
          <li key={a.id} className="rounded-lg border border-[#d3d1c7] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{a.title}</strong>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${a.active ? 'bg-green-100 text-green-900' : 'bg-gray-200 text-gray-900'}`}>{a.active ? 'Active' : 'Off'}</span>
            </div>
            <p className="mb-0 mt-1 text-sm">{day(a.starts_at)} → {day(a.ends_at)}</p>
            <p className="mb-0 mt-2 text-sm">
              Closed by {a.dismissed?.length ?? 0} · not yet closed by {a.not_dismissed?.length ?? 0}
            </p>
            <details className="mt-1">
              <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-semibold">Who has and hasn&apos;t closed it</summary>
              <div className="text-sm">
                <p className="mb-1 mt-0 font-semibold">Closed</p>
                <ul className="m-0 list-none p-0">{(a.dismissed ?? []).map((p, i) => <li key={i}>{p.name ?? 'Unnamed'} · {p.at ? day(p.at) : ''}</li>)}{(a.dismissed ?? []).length === 0 && <li>Nobody yet</li>}</ul>
                <p className="mb-1 mt-3 font-semibold">Not closed yet</p>
                <ul className="m-0 list-none p-0">{(a.not_dismissed ?? []).map((p, i) => <li key={i}>{p.name ?? 'Unnamed'}</li>)}{(a.not_dismissed ?? []).length === 0 && <li>Everyone has closed it</li>}</ul>
              </div>
            </details>
            <div className="mt-2"><button type="button" className={`${btn} w-full sm:w-auto`} onClick={() => open(a)}>Edit</button></div>
          </li>
        ))}
      </ul>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#d3d1c7] bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mt-4 sm:border-0 sm:p-0">
        <button type="button" className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-sm font-semibold text-white sm:w-auto" onClick={() => open(blank())}>
          New announcement
        </button>
      </div>

      {draft && (
        <div className="fixed inset-0 z-[100] flex items-end bg-black/50 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Announcement">
          <div className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white sm:max-w-lg sm:rounded-xl">
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <h2 className="m-0 text-lg font-bold">{draft.id ? 'Edit announcement' : 'New announcement'}</h2>
              <label className="block text-sm font-medium">Title
                <input className={ctl} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label className="block text-sm font-medium">Short name (slug)
                <input className={ctl} value={draft.slug} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} autoCapitalize="none" />
              </label>
              <label className="block text-sm font-medium">Starts
                <input className={ctl} type="datetime-local" value={toLocalInput(draft.starts_at)} onChange={(e) => e.target.value && setDraft({ ...draft, starts_at: new Date(e.target.value).toISOString() })} />
              </label>
              <label className="block text-sm font-medium">Stops
                <input className={ctl} type="datetime-local" value={toLocalInput(draft.ends_at)} onChange={(e) => e.target.value && setDraft({ ...draft, ends_at: new Date(e.target.value).toISOString() })} />
              </label>
              {ROLE_GROUPS.map((g) => (
                <label key={g} className="block text-sm font-medium">{ROLE_GROUP_LABELS[g]} — one line per row, up to {MAX_LINES_PER_GROUP}
                  <textarea className={ctl} rows={3} value={text[g]} onChange={(e) => setText({ ...text, [g]: e.target.value })} />
                </label>
              ))}
              <label className="flex min-h-[44px] items-center gap-3 text-sm font-medium">
                <input type="checkbox" className="h-5 w-5" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                Show it
              </label>
              {error && <p role="alert" className="m-0 text-sm font-semibold text-[#a32d2d]">{error}</p>}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#e6e4dc] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              <button type="button" className={`${btn} w-full sm:w-auto`} onClick={() => setDraft(null)}>Cancel</button>
              <button type="button" className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
