'use client'

import { useState } from 'react'

/**
 * The red bar shown on EVERY page while a support session is live. Presentational (props only) so the mobile checks can render it
 * without a server; `SupportBanner` (server) supplies the company, user and level it reads from the session.
 */
export default function SupportBannerView({ company, user, level }: { company: string; user: string; level: 'view' | 'full' }) {
  const [busy, setBusy] = useState<'exit' | 'upgrade' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function call(path: '/api/support/exit' | '/api/support/upgrade') {
    setBusy(path === '/api/support/exit' ? 'exit' : 'upgrade')
    setError(null)
    try {
      const res = await fetch(path, { method: 'POST' })
      if (!res.ok) throw new Error('failed')
      window.location.assign(path === '/api/support/exit' ? '/' : window.location.pathname)
    } catch {
      setError(path === '/api/support/exit' ? 'Could not exit' : 'Could not switch')
      setBusy(null)
    }
  }

  return (
    <div role="status" data-support-banner className="sticky top-0 z-[60] flex flex-wrap items-center gap-x-3 gap-y-2 bg-red-700 px-3 py-2 text-[14px] font-semibold text-white">
      <span className="min-w-0 flex-1 basis-60">
        Support access — viewing {company} as {user} ({level === 'full' ? 'full' : 'view only'}).
        {error ? <span className="ml-2 underline">{error}</span> : null}
      </span>
      {level === 'view' ? (
        <button type="button" disabled={busy !== null} onClick={() => void call('/api/support/upgrade')} className="min-h-[44px] rounded-lg border border-white px-4 text-[14px] font-semibold text-white disabled:opacity-60">
          Switch to full
        </button>
      ) : null}
      <button type="button" disabled={busy !== null} onClick={() => void call('/api/support/exit')} className="min-h-[44px] rounded-lg bg-white px-4 text-[14px] font-semibold text-red-800 disabled:opacity-60">
        Exit
      </button>
    </div>
  )
}
