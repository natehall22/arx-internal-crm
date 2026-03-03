'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { createClientBrowser } from '@/lib/supabase/client'

// Dynamically import AI Assistant to avoid SSR issues
const AIAssistant = dynamic(() => import('./AIAssistant'), { ssr: false })

interface AIAssistantWrapperProps {
  context?: {
    type: 'lead' | 'opportunity' | 'project' | 'general'
    id?: string
  }
}

export default function AIAssistantWrapper({ context }: AIAssistantWrapperProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const supabase = createClientBrowser()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        setIsAuthenticated(true)
      }
    } catch (err) {
      console.error('AI Wrapper auth check error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // Don't render anything while loading or if not authenticated
  if (isLoading || !isAuthenticated) {
    return null
  }

  // Always show the AI Assistant - it handles the enabled/disabled state internally
  return <AIAssistant context={context} />
}
