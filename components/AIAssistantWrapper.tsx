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
  const [aiEnabled, setAiEnabled] = useState(false)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    const supabase = createClientBrowser()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      setIsAuthenticated(true)
      
      // Check if AI is enabled
      const { data: settings } = await supabase
        .from('user_settings')
        .select('ai_enabled')
        .eq('user_id', user.id)
        .single()
      
      setAiEnabled(settings?.ai_enabled ?? false)
    }
  }

  // Only show AI assistant if user is authenticated and has AI enabled
  if (!isAuthenticated || !aiEnabled) {
    return null
  }

  return <AIAssistant context={context} />
}
