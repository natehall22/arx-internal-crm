'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * Entry: latest period, or deep link ?period_id=uuid (email-safe redirect to /commissions/statement/[id]).
 */
export default function CommissionStatementIndexPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const periodIdParam = searchParams.get('period_id')
  const userIdParam = searchParams.get('user_id')

  useEffect(() => {
    if (periodIdParam) {
      const q = userIdParam ? `?user_id=${encodeURIComponent(userIdParam)}` : ''
      router.replace(`/commissions/statement/${periodIdParam}${q}`)
      return
    }

    fetch('/api/commissions/periods')
      .then(async (res) => {
        if (res.status === 401) {
          router.replace('/login')
          return
        }
        const j = res.ok ? await res.json() : { periods: [] }
        const first = j.periods?.[0]?.id
        if (first) router.replace(`/commissions/statement/${first}`)
        else router.replace('/dashboard')
      })
      .catch(() => router.replace('/dashboard'))
  }, [router, periodIdParam, userIdParam])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">
      Loading pay statement…
    </div>
  )
}
