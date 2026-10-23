'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/field'
import { cn } from '@/lib/cn'

type Hit = { kind: 'customer' | 'job' | 'proposal' | 'opportunity'; id: string; title: string; subtitle: string; href: string }
const KIND_LABEL: Record<Hit['kind'], string> = { customer: 'Customer', job: 'Job', proposal: 'Proposal', opportunity: 'Opportunity' }

/** Cmd/Ctrl-K (or the search button) opens it; type to search, ↑/↓ to move, Enter to open. */
export default function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const [hits, setHits] = React.useState<Hit[]>([])
  const [state, setState] = React.useState<'idle' | 'loading' | 'error'>('idle')
  const [active, setActive] = React.useState(0)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('arx:open-search', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('arx:open-search', onOpen)
    }
  }, [])

  React.useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits([])
      setState('idle')
      return
    }
    const ctl = new AbortController()
    setState('loading')
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal, cache: 'no-store' })
        if (!r.ok) throw new Error('search')
        const body = await r.json()
        setHits(Array.isArray(body?.results) ? body.results : [])
        setActive(0)
        setState('idle')
      } catch (e) {
        if ((e as { name?: string }).name !== 'AbortError') setState('error')
      }
    }, 200)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [q])

  const go = (h: Hit | undefined) => {
    if (!h) return
    setOpen(false)
    setQ('')
    router.push(h.href)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(hits[active])
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Search" description="Customers, addresses, phone numbers, job numbers and proposals." className="sm:top-[20%] sm:-translate-y-0">
        <Input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder="Name, address, phone, job #…" aria-label="Search" role="combobox" aria-expanded={hits.length > 0} aria-controls="search-results" />
        <div id="search-results" role="listbox" aria-label="Results" className="max-h-[50dvh] overflow-y-auto">
          {state === 'error' ? <p className="py-3 text-ui-base text-danger">Search isn&apos;t working right now. Try again.</p> : null}
          {state === 'idle' && q.trim().length >= 2 && hits.length === 0 ? <p className="py-3 text-ui-base text-ink-muted">No matches for “{q.trim()}”.</p> : null}
          {hits.map((h, i) => (
            <button
              key={`${h.kind}:${h.id}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(h)}
              className={cn('flex min-h-tap w-full flex-col justify-center border-b border-surface-line px-2 py-2 text-left', i === active && 'bg-surface-subtle')}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">{h.title}</span>
                <span className="shrink-0 text-ui-sm text-ink-muted">{KIND_LABEL[h.kind]}</span>
              </span>
              {h.subtitle ? <span className="text-ui-sm text-ink-muted">{h.subtitle}</span> : null}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
