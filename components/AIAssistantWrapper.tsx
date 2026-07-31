'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import AIAssistant from '@/components/AIAssistant'
import { useAIAssistantPageContext } from '@/components/AIAssistantProvider'

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
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isAllowlisted, setIsAllowlisted] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const checkAuth = async () => {
      try {
        const settingsResponse = await fetch('/api/settings')
        if (!mounted) return

        if (settingsResponse.status === 401) {
          setIsAuthenticated(false)
          setIsAllowlisted(false)
          return
        }

        if (!settingsResponse.ok) {
          setIsAuthenticated(false)
          setIsAllowlisted(false)
          return
        }

        const data = await settingsResponse.json()
        setIsAuthenticated(true)
        setIsAllowlisted(Boolean(data.profile?.aiAssistantAllowlisted))
      } catch (err) {
        console.error('AI Wrapper auth check error:', err)
        if (mounted) {
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

  if (isLoading || !isAuthenticated || !isAllowlisted || isCanvassPath(pathname)) {
    return null
  }

  return <AIAssistant context={pageContext} stackedFab={hasStackedOpsFab(pathname)} />
}
