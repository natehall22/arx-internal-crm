'use client'

import { useEffect, useState } from 'react'

/** Mount children only at desktop width, so the rail and the phone's Notes tab never both poll. */
export default function DesktopOnly({ children }: { children: React.ReactNode }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const sync = () => setOn(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return on ? <>{children}</> : null
}
