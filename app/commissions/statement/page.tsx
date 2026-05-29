'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Desire path entry: send reps to their latest pay period statement. */
export default function CommissionStatementIndexPage() {
  const router = useRouter()

  useEffect(() => {
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
  }, [router])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">
      Loading pay statement…
    </div>
  )
}
