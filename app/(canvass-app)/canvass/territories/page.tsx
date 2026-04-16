'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CanvassTerritoriesEditor } from '@/components/canvass-territories/CanvassTerritoriesEditor'

export default function CanvassTerritoriesPage() {
  const router = useRouter()
  const [gate, setGate] = useState<'loading' | 'ok' | 'denied'>('loading')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetch('/api/canvass/data')
      if (cancelled) return
      if (r.status === 401) {
        router.replace('/login?next=/canvass/territories')
        return
      }
      const d = await r.json().catch(() => ({}))
      if (!d.canManageCanvassTerritories) {
        setGate('denied')
        router.replace('/canvass')
        return
      }
      setGate('ok')
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  if (gate === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-600 text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  if (gate === 'denied') {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <header className="bg-indigo-600 text-white px-4 py-3 safe-area-top flex items-start gap-3 shrink-0">
        <Link
          href="/canvass"
          className="mt-0.5 p-1.5 -ml-1 rounded-lg hover:bg-white/10 shrink-0"
          aria-label="Back to map"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="min-w-0">
          <h1 className="font-bold text-lg leading-tight">Work areas</h1>
          <p className="text-xs text-indigo-200 mt-0.5">
            Polygon tool on the map — assign reps or teams (Spotio / Sales Rabbit style).
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-3 md:p-4 min-h-0">
        <CanvassTerritoriesEditor forbiddenRedirect="/canvass" compact />
      </div>
    </div>
  )
}
