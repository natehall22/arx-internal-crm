'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { TAB_LABELS, type FileTab } from '@/lib/customer-file/access'

/** Lazy tabs = route segments: only the active tab's data loads. The Notes tab is the phone's home for the thread (the desktop rail covers it). */
export default function FileTabs({ base, tabs }: { base: string; tabs: FileTab[] }) {
  const pathname = usePathname()
  const active = tabs.find((t) => pathname === `${base}/${t}` || pathname.startsWith(`${base}/${t}/`)) ?? null

  // Remember the last real tab per person (follows them to their phone); best-effort.
  useEffect(() => {
    if (active && active !== 'notes') void fetch('/api/file-prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileTab: active }) }).catch(() => {})
  }, [active])

  return (
    <nav aria-label="File sections" className="border-b border-surface-line bg-surface">
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`${base}/${t}`}
            aria-current={active === t ? 'page' : undefined}
            className={`inline-flex min-h-tap shrink-0 items-center border-b-2 px-4 text-ui-sm font-semibold ${t === 'notes' ? 'lg:hidden' : ''} ${active === t ? 'border-brand-700 text-ink' : 'border-transparent text-ink-muted'}`}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </div>
    </nav>
  )
}
