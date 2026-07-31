'use client'

import { useEffect, useRef, useState } from 'react'
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
 */
export default function AIAssistantWrapper() {
  const pathname = usePathname()
  const { pageContext } = useAIAssistantPageContext()
  const allowlistOkRef = useRef(readAiAssistantAllowlistLatch())
  const [isAuthenticated, setIsAuthenticated] = useState(allowlistOkRef.current)
  const [isAllowlisted, setIsAllowlisted] = useState(allowlistOkRef.current)
  const [isLoading, setIsLoading] = useState(!allowlistOkRef.current)

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
