'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import AIAssistant from '@/components/AIAssistant'
import { useAIAssistantPageContext } from '@/components/AIAssistantProvider'
import {
  readAiAssistantAllowlistLatch,
  writeAiAssistantAllowlistLatch,
} from '@/lib/ai/assistant-shell-storage'

/** Canvass has its own map FAB in the same corner — hide assistant there. */
function isCanvassPath(pathname: string | null): boolean {
  return Boolean(pathname?.startsWith('/canvass'))
}

function hasStackedOpsFab(pathname: string | null): boolean {
  return Boolean(pathname?.match(/^\/ops\/jobs\/[^/]+\/orders(\/|$)/))
}

/**
 * Gate the FAB on cookie-auth `/api/settings`, not `supabase.auth.getUser()`.
 * CRM login writes the session cookie only; the browser Supabase client often
 * has no local session, so getUser() returns null and previously hid the FAB
 * even for allowlisted users who can open Settings → AI.
 *
 * The sessionStorage "latch" that lets a known-good user skip the loading
 * flicker on repeat visits must only be applied in an effect, never read
 * during the initial render (e.g. via a useRef/useState lazy initializer).
 * The server always renders with no window, so an eager read makes the
 * client's first (hydrating) render diverge from the server's whenever the
 * latch is set — React then discards the mismatched tree and throws on this
 * component's <button>, which breaks click handling for the rest of the
 * page until a hard reload. useLayoutEffect applies the latch synchronously
 * after hydration commits but before paint, so there's still no visible
 * flicker for returning allowlisted users.
 */
export default function AIAssistantWrapper() {
  const pathname = usePathname()
  const { pageContext } = useAIAssistantPageContext()
  const allowlistOkRef = useRef(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isAllowlisted, setIsAllowlisted] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useLayoutEffect(() => {
    if (readAiAssistantAllowlistLatch()) {
      allowlistOkRef.current = true
      setIsAuthenticated(true)
      setIsAllowlisted(true)
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const checkAuth = async () => {
      try {
        const settingsResponse = await fetch('/api/settings')
        if (!mounted) return

        if (settingsResponse.status === 401) {
          allowlistOkRef.current = false
          writeAiAssistantAllowlistLatch(false)
          setIsAuthenticated(false)
          setIsAllowlisted(false)
          return
        }

        if (!settingsResponse.ok) {
          // Keep showing the assistant if we already verified this session.
          if (!allowlistOkRef.current) {
            setIsAuthenticated(false)
            setIsAllowlisted(false)
          }
          return
        }

        const data = await settingsResponse.json()
        const allowlisted = Boolean(data.profile?.aiAssistantAllowlisted)
        if (allowlisted) {
          allowlistOkRef.current = true
          writeAiAssistantAllowlistLatch(true)
        } else {
          allowlistOkRef.current = false
          writeAiAssistantAllowlistLatch(false)
        }
        setIsAuthenticated(true)
        setIsAllowlisted(allowlisted)
      } catch (err) {
        console.error('AI Wrapper auth check error:', err)
        if (mounted && !allowlistOkRef.current) {
          setIsAuthenticated(false)
          setIsAllowlisted(false)
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    checkAuth()

    return () => {
      mounted = false
    }
  }, [])

  if (isCanvassPath(pathname)) {
    return null
  }

  const canShowAssistant =
    allowlistOkRef.current || (!isLoading && isAuthenticated && isAllowlisted)

  if (!canShowAssistant) {
    return null
  }

  return <AIAssistant context={pageContext} stackedFab={hasStackedOpsFab(pathname)} />
}
