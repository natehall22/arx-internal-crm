'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'

export type AIAssistantPageContext = {
  type: 'lead' | 'opportunity' | 'project' | 'job' | 'general'
  id?: string
}

export type AIAssistantPanelMode = 'closed' | 'minimized' | 'open'

export type AIAssistantMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export type AIAssistantFeedbackRating = 'up' | 'down'

type AIAssistantContextValue = {
  pageContext: AIAssistantPageContext
  setPageContext: (ctx: AIAssistantPageContext | null) => void
  panelMode: AIAssistantPanelMode
  setPanelMode: (mode: AIAssistantPanelMode) => void
  messages: AIAssistantMessage[]
  setMessages: Dispatch<SetStateAction<AIAssistantMessage[]>>
  conversationId: string | null
  setConversationId: Dispatch<SetStateAction<string | null>>
  input: string
  setInput: Dispatch<SetStateAction<string>>
  feedbackRatings: Record<number, AIAssistantFeedbackRating>
  setFeedbackRatings: Dispatch<SetStateAction<Record<number, AIAssistantFeedbackRating>>>
}

const AIAssistantContext = createContext<AIAssistantContextValue | null>(null)

const DEFAULT_CONTEXT: AIAssistantPageContext = { type: 'general' }

export function AIAssistantProvider({ children }: { children: ReactNode }) {
  const [pageContext, setPageContextState] = useState<AIAssistantPageContext>(DEFAULT_CONTEXT)
  const [panelMode, setPanelMode] = useState<AIAssistantPanelMode>('closed')
  const [messages, setMessages] = useState<AIAssistantMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [feedbackRatings, setFeedbackRatings] = useState<
    Record<number, AIAssistantFeedbackRating>
  >({})

  const setPageContext = useCallback((ctx: AIAssistantPageContext | null) => {
    setPageContextState(ctx ?? DEFAULT_CONTEXT)
  }, [])

  const value = useMemo(
    () => ({
      pageContext,
      setPageContext,
      panelMode,
      setPanelMode,
      messages,
      setMessages,
      conversationId,
      setConversationId,
      input,
      setInput,
      feedbackRatings,
      setFeedbackRatings,
    }),
    [
      pageContext,
      setPageContext,
      panelMode,
      messages,
      conversationId,
      input,
      feedbackRatings,
    ]
  )

  return <AIAssistantContext.Provider value={value}>{children}</AIAssistantContext.Provider>
}

function useAIAssistantContext() {
  const ctx = useContext(AIAssistantContext)
  if (!ctx) {
    throw new Error('useAIAssistantContext must be used within AIAssistantProvider')
  }
  return ctx
}

/** Page context for record-aware suggestions (unchanged API for record pages). */
export function useAIAssistantPageContext() {
  const { pageContext, setPageContext } = useAIAssistantContext()
  return { pageContext, setPageContext }
}

/** Full assistant shell state (panel mode + persisted chat). */
export function useAIAssistantShell() {
  return useAIAssistantContext()
}
