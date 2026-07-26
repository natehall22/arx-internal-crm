'use client'

import { useState, useEffect, useRef } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'
import AssistantMessageContent from '@/components/AssistantMessageContent'
import { AI_CHAT_MAX_MESSAGE_LENGTH } from '@/lib/ai/chat-constants'
import { consumeAiChatSseStream, type AiChatStreamEvent } from '@/lib/ai/chat-stream'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

type FeedbackRating = 'up' | 'down'

interface ConversationSummary {
  id: string
  contextType: string
  contextId: string | null
  updatedAt: string
  preview: string
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function contextTypeLabel(contextType: string): string {
  if (contextType === 'job') return 'Ops job'
  if (contextType === 'general') return 'General'
  return contextType.charAt(0).toUpperCase() + contextType.slice(1)
}

interface AIAssistantProps {
  context?: {
    type: 'lead' | 'opportunity' | 'project' | 'job' | 'general'
    id?: string
  }
  /** Lift FAB when another bottom-right action button is present (e.g. ops orders +). */
  stackedFab?: boolean
}

export default function AIAssistant({ context, stackedFab = false }: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyItems, setHistoryItems] = useState<ConversationSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [feedbackRatings, setFeedbackRatings] = useState<Record<number, FeedbackRating>>({})
  const [feedbackPending, setFeedbackPending] = useState<Record<number, boolean>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)
  const sendGenerationRef = useRef(0)
  const contextKey = `${context?.type ?? 'general'}:${context?.id ?? ''}`

  useEffect(() => {
    sendGenerationRef.current += 1
    checkAIEnabled()
    setSuggestions([])
    loadSuggestions()
    setMessages([])
    setConversationId(null)
    setShowHistory(false)
    setLoading(false)
    setIsStreaming(false)
    sendingRef.current = false
    setFeedbackRatings({})
    setFeedbackPending({})
  }, [contextKey])

  useEffect(() => {
    if (!isOpen) return
    const onFocus = () => {
      checkAIEnabled()
      loadSuggestions()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [isOpen, contextKey])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const checkAIEnabled = async () => {
    setIsEnabled(null)
    const supabase = createClientBrowser()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setIsEnabled(false)
      return
    }

    const { data: settings } = await supabase
      .from('user_settings')
      .select('ai_enabled')
      .eq('user_id', user.id)
      .maybeSingle()

    setIsEnabled(settings?.ai_enabled ?? false)
  }

  const loadSuggestions = async () => {
    const loadGeneration = sendGenerationRef.current
    try {
      const params = new URLSearchParams()
      if (context?.type) params.set('context_type', context.type)
      if (context?.id) params.set('context_id', context.id)

      const response = await fetch(`/api/ai/chat?${params}`)
      if (loadGeneration !== sendGenerationRef.current) return

      if (response.ok) {
        const data = await response.json()
        setSuggestions(data.suggestions || [])
      }
    } catch (error) {
      console.error('Failed to load suggestions:', error)
    }
  }

  const sendMessage = async (messageText?: string) => {
    if (sendingRef.current || loading || isEnabled !== true) return

    const text = messageText || input.trim()
    if (!text) return
    if (text.length > AI_CHAT_MAX_MESSAGE_LENGTH) return

    sendingRef.current = true
    setInput('')
    setLoading(true)

    const sendGeneration = sendGenerationRef.current
    const requestContext = context
    const requestContextKey = `${requestContext?.type ?? 'general'}:${requestContext?.id ?? ''}`
    const requestConversationId = conversationId

    const userMessage: Message = {
      role: 'user',
      content: text,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMessage])

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          context: requestContext,
          conversationId: requestConversationId,
        }),
      })

      if (sendGeneration !== sendGenerationRef.current || requestContextKey !== contextKey) {
        return
      }

      const contentType = response.headers.get('content-type') ?? ''

      if (contentType.includes('text/event-stream') && response.body) {
        setIsStreaming(true)
        let streamingIndex = -1
        setMessages(prev => {
          streamingIndex = prev.length
          return [
            ...prev,
            {
              role: 'assistant',
              content: '',
              timestamp: new Date(),
            },
          ]
        })

        let streamError: string | null = null

        await consumeAiChatSseStream(response.body, (event: AiChatStreamEvent) => {
          if (sendGeneration !== sendGenerationRef.current || requestContextKey !== contextKey) {
            return
          }

          if (event.type === 'token') {
            setMessages(prev =>
              prev.map((msg, index) =>
                index === streamingIndex
                  ? { ...msg, content: msg.content + event.content }
                  : msg
              )
            )
          } else if (event.type === 'done') {
            setConversationId(event.conversationId)
            setMessages(prev =>
              prev.map((msg, index) =>
                index === streamingIndex ? { ...msg, content: event.response } : msg
              )
            )
          } else if (event.type === 'error') {
            streamError = event.error
          }
        })

        if (sendGeneration !== sendGenerationRef.current || requestContextKey !== contextKey) {
          return
        }

        if (streamError) {
          setMessages(prev => [
            ...prev.slice(0, streamingIndex),
            {
              role: 'assistant',
              content: `Sorry, I encountered an error: ${streamError}`,
              timestamp: new Date(),
            },
          ])
        }
      } else {
        const data = await response.json()

        if (sendGeneration !== sendGenerationRef.current || requestContextKey !== contextKey) {
          return
        }

        if (data.needsEnable) {
          setIsEnabled(false)
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: 'AI assistant is not enabled. Please enable it in your Settings to use this feature.',
            timestamp: new Date(),
          }])
        } else if (data.response) {
          setConversationId(data.conversationId)
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: data.response,
            timestamp: new Date(),
          }])
        } else if (data.error) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `Sorry, I encountered an error: ${data.error}`,
            timestamp: new Date(),
          }])
        }
      }
    } catch (error) {
      if (sendGeneration !== sendGenerationRef.current || requestContextKey !== contextKey) {
        return
      }
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      }])
    } finally {
      if (sendGeneration === sendGenerationRef.current && requestContextKey === contextKey) {
        setLoading(false)
        setIsStreaming(false)
        sendingRef.current = false
      }
    }
  }

  const startNewChat = () => {
    setMessages([])
    setConversationId(null)
    setShowHistory(false)
    setInput('')
    setLoading(false)
    setIsStreaming(false)
    sendingRef.current = false
    setFeedbackRatings({})
    setFeedbackPending({})
  }

  const submitFeedback = async (messageIndex: number, rating: FeedbackRating) => {
    if (!conversationId || feedbackPending[messageIndex]) return

    const previousRating = feedbackRatings[messageIndex]
    setFeedbackRatings(prev => ({ ...prev, [messageIndex]: rating }))
    setFeedbackPending(prev => ({ ...prev, [messageIndex]: true }))

    try {
      const response = await fetch('/api/ai/chat/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          messageIndex,
          rating,
        }),
      })

      if (!response.ok) {
        setFeedbackRatings(prev => {
          const next = { ...prev }
          if (previousRating) {
            next[messageIndex] = previousRating
          } else {
            delete next[messageIndex]
          }
          return next
        })
      }
    } catch (error) {
      console.error('Failed to submit AI feedback:', error)
      setFeedbackRatings(prev => {
        const next = { ...prev }
        if (previousRating) {
          next[messageIndex] = previousRating
        } else {
          delete next[messageIndex]
        }
        return next
      })
    } finally {
      setFeedbackPending(prev => {
        const next = { ...prev }
        delete next[messageIndex]
        return next
      })
    }
  }

  const isAssistantMessageStreaming = (index: number) =>
    isStreaming && index === messages.length - 1 && messages[index]?.role === 'assistant'

  const canRateAssistantMessage = (index: number) =>
    Boolean(conversationId) &&
    !isAssistantMessageStreaming(index) &&
    Boolean(messages[index]?.content.trim())

  const loadHistory = async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const response = await fetch('/api/ai/chat/conversations')
      const data = await response.json()

      if (!response.ok) {
        if (data.needsEnable) {
          setIsEnabled(false)
        }
        setHistoryError(data.error || 'Failed to load history')
        setHistoryItems([])
        return
      }

      setHistoryItems(data.conversations || [])
    } catch (error) {
      console.error('Failed to load conversation history:', error)
      setHistoryError('Failed to load history')
      setHistoryItems([])
    } finally {
      setHistoryLoading(false)
    }
  }

  const openHistory = () => {
    setShowHistory(true)
    loadHistory()
  }

  const resumeConversation = async (id: string) => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const response = await fetch(`/api/ai/chat/conversations?id=${encodeURIComponent(id)}`)
      const data = await response.json()

      if (!response.ok) {
        setHistoryError(data.error || 'Failed to load conversation')
        return
      }

      const loadedAt = new Date()
      setConversationId(data.conversationId)
      setMessages(
        (data.messages || []).map((msg: { role: 'user' | 'assistant'; content: string }) => ({
          role: msg.role,
          content: msg.content,
          timestamp: loadedAt,
        }))
      )
      setFeedbackRatings({})
      setFeedbackPending({})
      setShowHistory(false)
      setHistoryError(null)
    } catch (error) {
      console.error('Failed to resume conversation:', error)
      setHistoryError('Failed to load conversation')
    } finally {
      setHistoryLoading(false)
    }
  }

  const deleteConversation = async (id: string) => {
    if (!window.confirm('Delete this conversation?')) return

    try {
      const response = await fetch('/api/ai/chat/conversations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: id }),
      })

      if (!response.ok) {
        const data = await response.json()
        setHistoryError(data.error || 'Failed to delete conversation')
        return
      }

      setHistoryItems(prev => prev.filter(item => item.id !== id))
      if (conversationId === id) {
        startNewChat()
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error)
      setHistoryError('Failed to delete conversation')
    }
  }

  const openAssistant = () => {
    checkAIEnabled()
    loadSuggestions()
    setIsOpen(true)
  }

  const fabBottomClass = stackedFab
    ? 'bottom-[calc(8.5rem+var(--safe-area-inset-bottom))]'
    : 'bottom-[calc(5rem+var(--safe-area-inset-bottom))]'

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Floating button when closed
  if (!isOpen) {
    return (
      <button
        onClick={openAssistant}
        className={`fixed right-6 w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center z-[9999] ${fabBottomClass}`}
        title="AI Assistant"
      >
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      </button>
    )
  }

  return (
    <div className={`fixed right-3 sm:right-6 w-[calc(100vw-1.5rem-var(--safe-area-inset-left)-var(--safe-area-inset-right))] sm:w-96 max-w-md h-[min(500px,calc(100vh-6rem-var(--safe-area-inset-bottom)))] bg-white rounded-2xl shadow-2xl flex flex-col z-[9999] overflow-hidden border border-gray-200 ${fabBottomClass}`}>
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold">AI Assistant</h3>
            <p className="text-xs text-white/80">
              {context?.type && context.type !== 'general'
                ? `Helping with ${context.type === 'job' ? 'ops job' : context.type}`
                : 'Navigation & workflow help'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={showHistory ? () => setShowHistory(false) : openHistory}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              showHistory ? 'bg-white text-indigo-700' : 'bg-white/15 hover:bg-white/25 text-white'
            }`}
          >
            History
          </button>
          <button
            onClick={startNewChat}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors"
          >
            New chat
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 hover:bg-white/20 rounded-full transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages / History */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {showHistory ? (
          <div className="space-y-3">
            {historyLoading && historyItems.length === 0 ? (
              <p className="text-sm text-[#2c2c2a] text-center py-8">Loading history…</p>
            ) : historyError && historyItems.length === 0 ? (
              <p className="text-sm text-[#2c2c2a] text-center py-8">{historyError}</p>
            ) : historyItems.length === 0 ? (
              <p className="text-sm text-[#2c2c2a] text-center py-8">No recent conversations yet.</p>
            ) : (
              historyItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-2 p-3 bg-gray-50 hover:bg-indigo-50 rounded-lg border border-gray-200"
                >
                  <button
                    type="button"
                    onClick={() => resumeConversation(item.id)}
                    disabled={historyLoading}
                    className="flex-1 min-w-0 text-left disabled:opacity-50"
                  >
                    <p className="text-sm text-[#2c2c2a] truncate">{item.preview}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-[#6b6b68]">{formatRelativeTime(item.updatedAt)}</span>
                      {item.contextType !== 'general' && (
                        <span className="text-xs font-medium text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                          {contextTypeLabel(item.contextType)}
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteConversation(item.id)}
                    disabled={historyLoading}
                    className="p-1.5 text-[#6b6b68] hover:text-red-700 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                    title="Delete conversation"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))
            )}
            {historyError && historyItems.length > 0 && (
              <p className="text-xs text-red-700">{historyError}</p>
            )}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-[#2c2c2a] mb-4">Hi! I can help you find your way around ARX CRM — where things go, what to do next, and how to get to the right page.</p>
            
            {/* Suggestions */}
            {suggestions.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-[#6b6b68] uppercase tracking-wide">Try asking:</p>
                {suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => sendMessage(suggestion)}
                    disabled={loading || isEnabled !== true}
                    className="block w-full text-left px-4 py-2 bg-gray-50 hover:bg-indigo-50 rounded-lg text-sm text-[#2c2c2a] hover:text-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-50 disabled:hover:text-[#2c2c2a]"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((msg, index) => (
            <div
              key={index}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-md'
                    : 'bg-gray-100 text-[#2c2c2a] rounded-bl-md'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">
                  {msg.role === 'assistant' ? (
                    <AssistantMessageContent content={msg.content} />
                  ) : (
                    msg.content
                  )}
                </p>
                <div
                  className={`mt-1 flex items-center gap-2 ${
                    msg.role === 'user' ? 'justify-end' : 'justify-between'
                  }`}
                >
                  <p className={`text-xs ${msg.role === 'user' ? 'text-indigo-200' : 'text-[#6b6b68]'}`}>
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  {msg.role === 'assistant' && canRateAssistantMessage(index) && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => submitFeedback(index, 'up')}
                        disabled={Boolean(feedbackPending[index])}
                        aria-label="Helpful answer"
                        title="Helpful"
                        className={`p-1 rounded-md transition-colors disabled:opacity-50 ${
                          feedbackRatings[index] === 'up'
                            ? 'text-indigo-700 bg-indigo-100'
                            : 'text-[#2c2c2a] hover:text-indigo-700 hover:bg-indigo-50'
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => submitFeedback(index, 'down')}
                        disabled={Boolean(feedbackPending[index])}
                        aria-label="Not helpful answer"
                        title="Not helpful"
                        className={`p-1 rounded-md transition-colors disabled:opacity-50 ${
                          feedbackRatings[index] === 'down'
                            ? 'text-indigo-700 bg-indigo-100'
                            : 'text-[#2c2c2a] hover:text-indigo-700 hover:bg-indigo-50'
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.737 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        
        {loading && !isStreaming && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t bg-gray-50">
        {isEnabled === null ? (
          <div className="text-center py-2">
            <p className="text-sm text-[#2c2c2a]">Checking AI settings…</p>
          </div>
        ) : isEnabled === false ? (
          <div className="text-center">
            <p className="text-sm text-[#2c2c2a] mb-2">AI Assistant is disabled</p>
            <a
              href="/settings?tab=ai"
              className="text-sm text-indigo-700 hover:text-indigo-900 font-medium underline underline-offset-2"
            >
              Enable in Settings →
            </a>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Where do I enter labor cost?"
              maxLength={AI_CHAT_MAX_MESSAGE_LENGTH}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm text-[#2c2c2a]"
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
