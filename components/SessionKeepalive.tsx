'use client'

import { useEffect } from 'react'

const PING_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Keeps the session cookie fresh during long single-page sessions
 * (proposal builder, canvassing, etc.). Pings /api/auth/refresh on an
 * interval and when the tab regains focus; the endpoint only rotates
 * the token when it's within 10 minutes of expiry, so pings are cheap.
 * Renders nothing; silently no-ops when logged out or offline.
 */
export default function SessionKeepalive() {
  useEffect(() => {
    let stopped = false

    const ping = () => {
      if (stopped || document.visibilityState !== 'visible') return
      fetch('/api/auth/refresh', { method: 'POST' }).catch(() => {
        // Offline or transient failure — middleware will retry on next navigation
      })
    }

    const intervalId = setInterval(ping, PING_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') ping()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stopped = true
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return null
}
