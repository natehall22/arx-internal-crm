'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, usePathname } from 'next/navigation'

import { Badge } from '@/components/ui'
import { noteMentionHighlightRegex } from '@/lib/note-mentions'
import { looksLikePricing, type Audience } from '@/lib/threads/visibility'
import type { ThreadMessage } from '@/lib/threads/get-thread'

type Payload = {
  messages: ThreadMessage[]
  pinned: ThreadMessage[]
  nextBefore: string | null
  hiddenSalesCount: number
  writable: Audience[]
  defaultAudience: Audience
  canAllowSetters: boolean
  canPin: boolean
  viewerId: string
  isOwner: boolean
  seesSalesHistoryChip: boolean
}

const AT_TAIL = new RegExp("@([\\p{L}' -]{0,30})$", 'u')
const AUDIENCE_LABEL: Record<Audience, string> = { team: 'Team', sales: 'Sales', production: 'Production', crew: 'Crew' }
const AUDIENCE_HINT: Record<Audience, string> = {
  team: 'Everyone on this deal',
  sales: 'The sales side. Ops can look it up.',
  production: 'Ops, owners and the closer. Never setters.',
  crew: 'Crew will see this on their link',
}
const AUDIENCE_TONE: Record<Audience, 'neutral' | 'info' | 'warning' | 'accent'> = { team: 'neutral', sales: 'accent', production: 'info', crew: 'warning' }

function surfaceFor(pathname: string): 'sales' | 'job' | 'overview' | 'other' {
  if (/\/sales(\/|$)/.test(pathname)) return 'sales'
  if (/\/job(\/|$)/.test(pathname)) return 'job'
  if (/\/overview(\/|$)/.test(pathname)) return 'overview'
  return 'other'
}

function when(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function renderBody(text: string) {
  const re = noteMentionHighlightRegex()
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length
    out.push(text.slice(last, start))
    out.push(<strong key={i++} className="font-semibold text-brand-800">@{m[2]}</strong>)
    last = start + 1 + m[2].length
  }
  out.push(text.slice(last))
  return out
}

/** The deal's conversation: one thread, audiences enforced on the server. `variant="page"` is the mobile Notes tab. */
export default function ThreadPanel({ customerId, dealId, variant = 'rail' }: { customerId: string; dealId: string; variant?: 'rail' | 'page' }) {
  const pathname = usePathname()
  const params = useParams() as { messageId?: string }
  const highlightId = params?.messageId ?? null
  const surface = surfaceFor(pathname)

  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<'deal' | 'customer'>('deal')
  const [humanOnly, setHumanOnly] = useState(true)
  const [salesHistory, setSalesHistory] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const scrolled = useRef<string | null>(null)

  const qs = useMemo(() => {
    const q = new URLSearchParams({ scope, surface })
    if (humanOnly) q.set('humanOnly', '1')
    if (salesHistory) q.set('audience', 'sales,team,production,crew')
    if (highlightId) q.set('around', highlightId)
    return q.toString()
  }, [scope, surface, humanOnly, salesHistory, highlightId])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/threads/${dealId}/messages?${qs}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load notes')
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load notes')
    }
  }, [dealId, qs])

  useEffect(() => {
    load()
    void fetch(`/api/threads/${dealId}/read`, { method: 'POST' })
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 20000)
    return () => clearInterval(t)
  }, [load, dealId])

  // Jump to the message a deep link / search result points at, and flash it.
  useEffect(() => {
    if (!highlightId || !data || scrolled.current === highlightId) return
    const el = document.getElementById(`m-${highlightId}`)
    if (el) {
      scrolled.current = highlightId
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [highlightId, data])

  async function loadMore() {
    if (!data?.nextBefore) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/threads/${dealId}/messages?${qs}&before=${encodeURIComponent(data.nextBefore)}`, { cache: 'no-store' })
      if (res.ok) {
        const more: Payload = await res.json()
        setData({ ...data, messages: [...data.messages, ...more.messages], nextBefore: more.nextBefore })
      }
    } finally {
      setLoadingMore(false)
    }
  }

  async function act(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/threads/messages/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'That did not work')
    await load()
  }

  // Collapse runs of system rows into one gray line between human messages.
  const rows = useMemo(() => {
    const out: Array<{ kind: 'msg'; m: ThreadMessage } | { kind: 'sys'; id: string; items: ThreadMessage[] }> = []
    for (const m of data?.messages ?? []) {
      if (m.origin === 'system') {
        const prev = out[out.length - 1]
        if (prev?.kind === 'sys') prev.items.push(m)
        else out.push({ kind: 'sys', id: m.id, items: [m] })
      } else out.push({ kind: 'msg', m })
    }
    return out
  }, [data])

  const [replyTo, setReplyTo] = useState<ThreadMessage | null>(null)

  return (
    <section aria-label="Notes" className={variant === 'rail' ? 'flex max-h-[calc(100vh-9rem)] flex-col rounded-ui border border-surface-line bg-surface' : 'rounded-ui border border-surface-line bg-surface'}>
      <header className="flex flex-wrap items-center gap-2 border-b border-surface-line p-3">
        <h2 className="mr-auto text-ui-base font-semibold text-ink">Notes</h2>
        <button type="button" onClick={() => setScope(scope === 'deal' ? 'customer' : 'deal')} className="min-h-tap rounded-ui border border-surface-line px-3 text-ui-sm text-ink" aria-pressed={scope === 'customer'}>
          {scope === 'deal' ? 'This deal' : 'All deals'}
        </button>
        <button type="button" onClick={() => setHumanOnly(!humanOnly)} className="min-h-tap rounded-ui border border-surface-line px-3 text-ui-sm text-ink" aria-pressed={!humanOnly}>
          {humanOnly ? 'Hide updates' : 'Show updates'}
        </button>
        {data?.seesSalesHistoryChip && (
          <button type="button" onClick={() => setSalesHistory(!salesHistory)} className="min-h-tap rounded-ui border border-surface-line px-3 text-ui-sm text-ink" aria-pressed={salesHistory}>
            Sales history{data.hiddenSalesCount && !salesHistory ? ` (${data.hiddenSalesCount})` : ''}
          </button>
        )}
      </header>

      {error && <p role="alert" className="m-3 rounded-ui bg-red-50 p-3 text-ui-sm text-danger">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!data && !error && <p className="text-ui-sm text-ink-muted">Loading…</p>}
        {data?.pinned.map((p) => (
          <div key={`pin-${p.id}`} className="mb-2 rounded-ui border-l-4 border-amber-600 bg-amber-50 p-3 text-ui-sm text-ink">
            <span className="font-semibold">Pinned · </span>{renderBody(p.body)}
            {data.canPin && <button type="button" onClick={() => act(p.id, { action: 'unpin' })} className="ml-2 min-h-tap text-ui-sm font-semibold text-brand-800 underline">Unpin</button>}
          </div>
        ))}
        {data && rows.length === 0 && <p className="text-ui-sm text-ink-muted">No notes yet. Be the first.</p>}
        <ul className="space-y-3">
          {rows.map((r) =>
            r.kind === 'sys' ? (
              <li key={r.id} className="text-center">
                <button type="button" onClick={() => setExpanded({ ...expanded, [r.id]: !expanded[r.id] })} className="min-h-tap rounded-full bg-surface-subtle px-3 text-ui-sm text-ink-muted">
                  ⟳ {r.items.length} update{r.items.length === 1 ? '' : 's'} {expanded[r.id] ? '▾' : '▸'}
                </button>
                {expanded[r.id] && (
                  <ul className="mt-1 space-y-1 text-left text-ui-sm text-ink-muted">
                    {r.items.map((s) => <li key={s.id}>{when(s.created_at)} · {s.body}</li>)}
                  </ul>
                )}
              </li>
            ) : (
              <MessageBubble key={r.m.id} m={r.m} data={data!} highlighted={r.m.id === highlightId} onAct={act} onReply={() => setReplyTo(r.m)} parent={data!.messages.find((x) => x.id === r.m.reply_to_id) ?? null} />
            )
          )}
        </ul>
        {data?.nextBefore && (
          <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-3 min-h-tap w-full rounded-ui border border-surface-line text-ui-sm text-ink">
            {loadingMore ? 'Loading…' : 'Earlier notes'}
          </button>
        )}
      </div>

      {data && data.writable.length > 0 && (
        <Composer dealId={dealId} data={data} replyTo={replyTo} onClearReply={() => setReplyTo(null)} onSent={load} />
      )}
      <span className="hidden" data-customer={customerId} />
    </section>
  )
}

function MessageBubble({ m, data, highlighted, onAct, onReply, parent }: { m: ThreadMessage; data: Payload; highlighted: boolean; onAct: (id: string, b: Record<string, unknown>) => void; onReply: () => void; parent: ThreadMessage | null }) {
  const mine = m.user_id === data.viewerId
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.body)
  const [menu, setMenu] = useState(false)
  if (m.deleted) {
    return <li id={`m-${m.id}`} className="text-ui-sm italic text-ink-muted">Message removed</li>
  }
  return (
    <li id={`m-${m.id}`} className={`rounded-ui border p-3 ${highlighted ? 'border-brand-700 bg-brand-50' : 'border-surface-line bg-surface'}`}>
      <div className="flex flex-wrap items-center gap-2 text-ui-sm text-ink-muted">
        <span className="font-semibold text-ink">{m.author_name ?? 'ARX'}</span>
        <span>{when(m.created_at)}</span>
        {m.audience && m.audience !== 'team' && <Badge tone={AUDIENCE_TONE[m.audience]}>{AUDIENCE_LABEL[m.audience]}</Badge>}
        {m.restricted_pricing && <Badge tone="warning">Pricing</Badge>}
        {m.priority === 'needs_reply' && <Badge tone="info">Needs reply</Badge>}
        {m.priority === 'urgent' && <Badge tone="danger">Urgent</Badge>}
        {m.legacy && <Badge>Old note</Badge>}
        {m.edited_at && <span>edited</span>}
      </div>
      {parent && <p className="mt-1 border-l-2 border-surface-line pl-2 text-ui-sm text-ink-muted">{parent.author_name}: {parent.body.slice(0, 80)}</p>}
      {editing ? (
        <div className="mt-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded-ui border border-surface-line p-2 text-ui-base text-ink" rows={3} />
          <button type="button" className="min-h-tap px-3 text-ui-sm font-semibold text-brand-800" onClick={() => { onAct(m.id, { action: 'edit', body: text }); setEditing(false) }}>Save</button>
          <button type="button" className="min-h-tap px-3 text-ui-sm text-ink" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-ui-base text-ink">{renderBody(m.body)}</p>
      )}
      <div className="mt-1 flex flex-wrap gap-1 text-ui-sm">
        <button type="button" onClick={onReply} className="min-h-tap px-2 font-semibold text-brand-800">Reply</button>
        <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} className="min-h-tap px-2 text-ink-muted">More</button>
      </div>
      {menu && (
        <div className="flex flex-wrap gap-1 text-ui-sm">
          {mine && <button type="button" className="min-h-tap px-2 text-ink" onClick={() => { setEditing(true); setMenu(false) }}>Edit</button>}
          {data.canPin && <button type="button" className="min-h-tap px-2 text-ink" onClick={() => onAct(m.id, { action: 'pin', scope: 'customer' })}>Pin to customer</button>}
          {data.canPin && <button type="button" className="min-h-tap px-2 text-ink" onClick={() => onAct(m.id, { action: 'pin', scope: 'deal' })}>Pin to deal</button>}
          {data.writable.includes('production') && m.audience && m.audience !== 'production' && data.isOwner && <button type="button" className="min-h-tap px-2 text-ink" onClick={() => onAct(m.id, { action: 'reclassify', audience: 'production' })}>Make Production</button>}
          {(mine || data.isOwner) && <button type="button" className="min-h-tap px-2 text-danger" onClick={() => { if (confirm('Remove this message?')) onAct(m.id, { action: 'delete' }) }}>Remove</button>}
        </div>
      )}
    </li>
  )
}

function Composer({ dealId, data, replyTo, onClearReply, onSent }: { dealId: string; data: Payload; replyTo: ThreadMessage | null; onClearReply: () => void; onSent: () => void }) {
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<Audience>(data.defaultAudience)
  const [priority, setPriority] = useState<'fyi' | 'needs_reply' | 'urgent'>('fyi')
  const [allowSetters, setAllowSetters] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const clientId = useRef<string>(crypto.randomUUID())

  useEffect(() => { if (data.writable.includes(data.defaultAudience)) setAudience(data.defaultAudience) }, [data.defaultAudience, data.writable])
  const effective = replyTo?.audience && data.writable.includes(replyTo.audience) ? replyTo.audience : audience
  useEffect(() => {
    fetch(`/api/threads/${dealId}/mentionable?audience=${effective}`).then((r) => (r.ok ? r.json() : { users: [] })).then((j) => setPeople(j.users ?? [])).catch(() => setPeople([]))
  }, [dealId, effective])

  const atMatch = AT_TAIL.exec(body)
  const suggestions = atMatch ? people.filter((p) => p.full_name.toLowerCase().includes(atMatch[1].trim().toLowerCase())).slice(0, 5) : []
  const pricing = looksLikePricing(body) && data.canAllowSetters

  async function send() {
    if (!body.trim() || busy) return
    if (priority === 'urgent' && !confirm('This will buzz the people mentioned, even in quiet hours. Send as urgent?')) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/threads/${dealId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, audience: effective, replyToId: replyTo?.id ?? null, selectedMentionIds: picked, priority: priority === 'fyi' ? null : priority, allowSetters, clientId: clientId.current, surface: 'other' }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Not sent — tap to retry')
      setBody(''); setPicked([]); setPriority('fyi'); setAllowSetters(false); onClearReply()
      clientId.current = crypto.randomUUID()
      onSent()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Not sent — tap to retry')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-surface-line p-3">
      {replyTo && <p className="mb-1 text-ui-sm text-ink-muted">Replying to {replyTo.author_name} <button type="button" onClick={onClearReply} className="min-h-tap px-2 underline">Cancel</button></p>}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="aud">Audience</label>
        <select id="aud" value={effective} disabled={!!replyTo?.audience} onChange={(e) => setAudience(e.target.value as Audience)} className="min-h-tap rounded-ui border border-surface-line bg-surface px-2 text-ui-base text-ink">
          {data.writable.map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
        </select>
        <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="min-h-tap rounded-ui border border-surface-line bg-surface px-2 text-ui-base text-ink">
          <option value="fyi">FYI</option>
          <option value="needs_reply">Needs reply</option>
          <option value="urgent">Urgent !</option>
        </select>
        <span className="text-ui-sm text-ink-muted">{AUDIENCE_HINT[effective]}</span>
      </div>
      {effective === 'crew' && <p className="mb-2 rounded-ui bg-amber-50 p-2 text-ui-sm font-semibold text-ink">👷 Crew will see this on their link. No prices.</p>}
      {pricing && (
        <p className="mb-2 rounded-ui bg-amber-50 p-2 text-ui-sm text-ink">
          Looks like pricing. Setters won&apos;t see this.{' '}
          <label className="inline-flex min-h-tap items-center gap-2 font-semibold"><input type="checkbox" checked={allowSetters} onChange={(e) => setAllowSetters(e.target.checked)} /> Let setters see it</label>
        </p>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
        rows={3}
        placeholder="Write a note. @ to mention someone."
        aria-label="Message"
        className="w-full rounded-ui border border-surface-line p-2 text-ui-base text-ink"
      />
      {suggestions.length > 0 && (
        <ul className="mt-1 rounded-ui border border-surface-line bg-surface">
          {suggestions.map((p) => (
            <li key={p.id}>
              <button type="button" className="min-h-tap w-full px-3 text-left text-ui-base text-ink" onClick={() => { setBody(body.replace(AT_TAIL, `@${p.full_name} `)); setPicked([...picked, p.id]) }}>
                {p.full_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="mt-1 text-ui-sm text-danger">{err}</p>}
      <button type="button" onClick={send} disabled={busy || !body.trim()} className="mt-2 min-h-tap w-full rounded-ui bg-brand-700 px-4 text-ui-sm font-semibold text-white disabled:opacity-50">
        {busy ? 'Sending…' : 'Send'}
      </button>
    </div>
  )
}
