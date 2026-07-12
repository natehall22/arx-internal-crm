'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type AIAssistantPageContext = {
  type: 'lead' | 'opportunity' | 'project' | 'job' | 'general'
  id?: string
}

type AIAssistantContextValue = {
  pageContext: AIAssistantPageContext
  setPageContext: (ctx: AIAssistantPageContext | null) => void
}

const AIAssistantContext = createContext<AIAssistantContextValue | null>(null)

const DEFAULT_CONTEXT: AIAssistantPageContext = { type: 'general' }

export function AIAssistantProvider({ children }: { children: ReactNode }) {
  const [pageContext, setPageContextState] = useState<AIAssistantPageContext>(DEFAULT_CONTEXT)

  const setPageContext = useCallback((ctx: AIAssistantPageContext | null) => {
    setPageContextState(ctx ?? DEFAULT_CONTEXT)
  }, [])

  const value = useMemo(
    () => ({
      pageContext,
      setPageContext,
    }),
    [pageContext, setPageContext]
  )

  return <AIAssistantContext.Provider value={value}>{children}</AIAssistantContext.Provider>
}

export function useAIAssistantPageContext() {
  const ctx = useContext(AIAssistantContext)
  if (!ctx) {
    throw new Error('useAIAssistantPageContext must be used within AIAssistantProvider')
  }
  return ctx
}
