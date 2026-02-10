'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AutoRefresh({
  shouldRefresh,
  endpoint,
}: {
  shouldRefresh: boolean
  endpoint?: string
}) {
  const router = useRouter()

  useEffect(() => {
    if (shouldRefresh) {
      const refreshData = async () => {
        if (endpoint) {
          await fetch(endpoint, { method: 'POST' })
        }
        router.refresh()
      }
      refreshData()
    }
  }, [shouldRefresh, endpoint, router])

  return null
}
