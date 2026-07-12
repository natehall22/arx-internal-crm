'use client'

import { useEffect } from 'react'
import {
  useAIAssistantPageContext,
  type AIAssistantPageContext,
} from '@/components/AIAssistantProvider'

interface RecordAIContextHelperProps {
  context: AIAssistantPageContext
}

/** Registers page record context for the global AI assistant (server pages use this). */
export default function RecordAIContextHelper({ context }: RecordAIContextHelperProps) {
  const { setPageContext } = useAIAssistantPageContext()

  useEffect(() => {
    setPageContext(context)
    return () => setPageContext(null)
  }, [context.type, context.id, setPageContext])

  return null
}
