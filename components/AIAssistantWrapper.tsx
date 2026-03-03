'use client'

import { useState, useEffect } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'

interface AIAssistantWrapperProps {
  context?: {
    type: 'lead' | 'opportunity' | 'project' | 'general'
    id?: string
  }
}

export default function AIAssistantWrapper({ context }: AIAssistantWrapperProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)

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

  // Simple floating button
  return (
    <button
      onClick={() => setIsOpen(!isOpen)}
      className="fixed bottom-20 right-6 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 flex items-center justify-center"
      style={{ zIndex: 99999 }}
      title="AI Assistant"
    >
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    </button>
  )
}
