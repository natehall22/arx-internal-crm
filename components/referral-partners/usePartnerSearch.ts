'use client'

import { useEffect, useState } from 'react'

import type { PartnerListItem } from '@/lib/referral-partners'

const DEBOUNCE_MS = 200

/** Debounced search against /api/referral-partners; shared by the page and the Referred By picker. */
export function usePartnerSearch(query: string, scope: 'all' | 'mine' | 'open' = 'all', enabled = true) {
  const [partners, setPartners] = useState<PartnerListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/referral-partners?scope=${scope}&q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal }
        )
        if (!res.ok) throw new Error('Could not load partners')
        const json = await res.json()
        setPartners(json.partners ?? [])
        setError(null)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setError('Could not load partners. Check your connection.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, query ? DEBOUNCE_MS : 0)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, scope, enabled])

  return { partners, loading, error }
}
