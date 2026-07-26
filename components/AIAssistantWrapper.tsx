'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClientBrowser } from '@/lib/supabase/client'
import { isAiAssistantAllowlistedEmail } from '@/lib/ai/chat-allowlist'
import AIAssistant from '@/components/AIAssistant'
import { useAIAssistantPageContext } from '@/components/AIAssistantProvider'

/** Canvass has its own map FAB in the same corner — hide assistant there. */
function isCanvassPath(pathname: string | null): boolean {
  return Boolean(pathname?.startsWith('/canvass'))
}

function hasStackedOpsFab(pathname: string | null): boolean {
  return Boolean(pathname?.match(/^\/ops\/jobs\/[^/]+\/orders(\/|$)/))
}

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
        const supabase = createClientBrowser()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (mounted) {
          setIsAuthenticated(!!user)
          setIsAllowlisted(isAiAssistantAllowlistedEmail(user?.email))
        }
      } catch (err) {
        console.error('AI Wrapper auth check error:', err)
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
