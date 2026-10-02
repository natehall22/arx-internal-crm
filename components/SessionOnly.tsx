'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { isPublicPath } from '@/lib/public-paths'

/**
 * Mounts its children only on pages middleware gates behind a session.
 * The session cookie is httpOnly, so the client can't read it — but every
 * non-public page is redirected to /login without one, so the path answers
 * "is there a session" with no request. Public pages (/, /login, /crew/…)
 * then make no authed API calls. Leaving a gated page unmounts the children,
 * which closes the notification stream.
 */
export default function SessionOnly({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  if (isPublicPath(pathname)) return null
  return <>{children}</>
}
