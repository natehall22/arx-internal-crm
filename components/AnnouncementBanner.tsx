'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

type Banner = { id: string; title: string; lines: string[]; link: string }

/**
 * "What's new" banner, rendered under the site header on every CRM page (Nav). Not a modal and not fixed: it sits
 * in the page flow so it never covers a page's main action. Closing it is saved per user in the database
 * (announcement_dismissals), so it stays closed on every device. It stops on its own when the announcement's
 * window ends (the API simply stops returning it). Any failure just means no banner.
 */
const CACHE_KEY = 'arx-announcement-v1'
const CACHE_MS = 5 * 60 * 1000

/** Per-tab cache so page-to-page navigation doesn't refetch or shift the layout. The database stays the truth. */
function readCache(): { at: number; banner: Banner | null; closed: string[] } {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { at: 0, banner: null, closed: [] }
}
function writeCache(v: { at: number; banner: Banner | null; closed: string[] }) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(v)) } catch {}
}

export default function AnnouncementBanner() {
  const pathname = usePathname()
  const [banner, setBanner] = useState<Banner | null>(null)

  useEffect(() => {
    let cancelled = false
    const cached = readCache()
    if (Date.now() - cached.at < CACHE_MS) {
      if (cached.banner && !cached.closed.includes(cached.banner.id)) setBanner(cached.banner)
      return
    }
    fetch('/api/announcements/active', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const next: Banner | null = j?.announcement ?? null
        writeCache({ at: Date.now(), banner: next, closed: cached.closed })
        if (!cancelled && next && !cached.closed.includes(next.id)) setBanner(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // The What's new page itself is the announcement: no banner on top of it.
  if (!banner || pathname === '/whats-new') return null

  const save = (id: string) => {
    const c = readCache()
    writeCache({ ...c, closed: Array.from(new Set([...c.closed, id])) })
    // keepalive lets the save finish even if the page navigates right after the tap
    void fetch(`/api/announcements/${id}/dismiss`, { method: 'POST', keepalive: true }).catch(() => undefined)
  }

  const dismiss = () => {
    const id = banner.id
    setBanner(null) // close right away; the save follows
    save(id)
    // keep keyboard focus on the page rather than losing it to <body>
    ;(document.querySelector('main, h1') as HTMLElement | null)?.focus?.()
  }

  return (
    <div role="region" aria-label="What's new" className="border-b border-amber-300 bg-amber-50 text-[#2c2c2a] print:hidden">
      <div className="mx-auto flex max-w-7xl items-start gap-2 px-4 sm:px-6 lg:px-8">
        <Link href={banner.link} onClick={() => save(banner.id)} className="flex min-h-[44px] flex-1 items-center py-2 text-sm leading-snug">
          <span className="line-clamp-2 sm:line-clamp-none">
            <strong className="font-semibold">{banner.title}: </strong>
            {banner.lines.join(' · ')}{' '}
            <span className="font-semibold underline">See what&apos;s new</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close this announcement"
          className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[#2c2c2a] hover:bg-amber-100"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
