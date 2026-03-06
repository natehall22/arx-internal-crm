'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { Notification } from '@/lib/types/database'

interface AppointmentPrompt {
  id: string
  appointment_id: string
  prompt_at: string
  scheduled_appointments: {
    id: string
    scheduled_for: string
    address_text: string | null
    lead_id: string | null
    leads?: {
      id?: string
      homeowner_name: string | null
      address_text: string | null
    }
    setter?: {
      full_name: string | null
    }
  }
}

interface InspectionResult {
  id: string
  type: string
  title: string
  body: string
  created_at: string
  read_at: string | null
  data: {
    appointment_id?: string
    opportunity_id?: string
    lead_id?: string
    outcome: string
    closer_name?: string
    notes?: string
    setter_feedback?: string
  }
}

interface RealtimeState {
  notifications: Notification[]
  unreadCount: number
  appointmentPrompts: AppointmentPrompt[]
  inspectionResults: InspectionResult[]
  connected: boolean
}

type RealtimeListener = (state: RealtimeState) => void

class RealtimeManager {
  private eventSource: EventSource | null = null
  private listeners: Set<RealtimeListener> = new Set()
  private state: RealtimeState = {
    notifications: [],
    unreadCount: 0,
    appointmentPrompts: [],
    inspectionResults: [],
    connected: false,
  }
  private reconnectTimeout: NodeJS.Timeout | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private baseReconnectDelay = 1000

  connect() {
    if (this.eventSource?.readyState === EventSource.OPEN) {
      return
    }

    this.disconnect()

    // Delay initial connection slightly to ensure auth state is ready
    // This prevents "Failed to fetch" errors on page load
    setTimeout(() => {
      if (this.listeners.size === 0) return // Don't connect if no listeners
      
      try {
        this.eventSource = new EventSource('/api/notifications/stream')

        this.eventSource.onopen = () => {
          this.reconnectAttempts = 0
          this.updateState({ connected: true })
        }

        this.eventSource.addEventListener('notifications', (event) => {
          try {
            const data = JSON.parse(event.data)
            this.updateState({
              notifications: data.notifications || [],
              unreadCount: data.unread_count || 0,
            })
          } catch (e) {
            console.error('Failed to parse notifications event:', e)
          }
        })

        this.eventSource.addEventListener('appointment_prompts', (event) => {
          try {
            const data = JSON.parse(event.data)
            this.updateState({
              appointmentPrompts: data.prompts || [],
            })
          } catch (e) {
            console.error('Failed to parse appointment_prompts event:', e)
          }
        })

        this.eventSource.addEventListener('inspection_results', (event) => {
          try {
            const data = JSON.parse(event.data)
            this.updateState({
              inspectionResults: data.results || [],
            })
          } catch (e) {
            console.error('Failed to parse inspection_results event:', e)
          }
        })

        this.eventSource.onerror = () => {
          this.updateState({ connected: false })
          this.scheduleReconnect()
        }
      } catch (error) {
        console.error('Failed to create EventSource:', error)
        this.scheduleReconnect()
      }
    }, 100)
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('Max reconnect attempts reached, stopping reconnection')
      return
    }

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000
    )
    this.reconnectAttempts++

    this.reconnectTimeout = setTimeout(() => {
      this.connect()
    }, delay)
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    this.updateState({ connected: false })
  }

  private updateState(partial: Partial<RealtimeState>) {
    this.state = { ...this.state, ...partial }
    this.listeners.forEach((listener) => listener(this.state))
  }

  subscribe(listener: RealtimeListener) {
    this.listeners.add(listener)
    listener(this.state)

    if (this.listeners.size === 1) {
      this.connect()
    }

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.disconnect()
      }
    }
  }

  getState() {
    return this.state
  }

  refresh() {
    if (this.eventSource?.readyState === EventSource.OPEN) {
      this.disconnect()
      this.connect()
    }
  }
}

let realtimeManager: RealtimeManager | null = null

function getRealtimeManager() {
  if (typeof window === 'undefined') {
    return null
  }
  if (!realtimeManager) {
    realtimeManager = new RealtimeManager()
  }
  return realtimeManager
}

export function useRealtimeUpdates() {
  const [state, setState] = useState<RealtimeState>({
    notifications: [],
    unreadCount: 0,
    appointmentPrompts: [],
    inspectionResults: [],
    connected: false,
  })

  useEffect(() => {
    const manager = getRealtimeManager()
    if (!manager) return

    const unsubscribe = manager.subscribe(setState)
    return unsubscribe
  }, [])

  const refresh = useCallback(() => {
    const manager = getRealtimeManager()
    manager?.refresh()
  }, [])

  return { ...state, refresh }
}

export function useNotifications() {
  const { notifications, unreadCount, connected, refresh } = useRealtimeUpdates()
  return { notifications, unreadCount, connected, refresh }
}

export function useAppointmentPrompts() {
  const { appointmentPrompts, connected, refresh } = useRealtimeUpdates()
  return { prompts: appointmentPrompts, connected, refresh }
}

export function useInspectionResults() {
  const { inspectionResults, connected, refresh } = useRealtimeUpdates()
  return { results: inspectionResults, connected, refresh }
}
