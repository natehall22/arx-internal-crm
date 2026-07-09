'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CanvassPin } from '../page'

const SYNC_LOCK_TTL_MS = 5 * 60 * 1000
const PERSIST_KEY = 'canvass-offline-store'

function readPersistedSyncLockAt(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { state?: { syncLockAt?: string | null } }
    return parsed.state?.syncLockAt ?? null
  } catch {
    return null
  }
}

function isSyncLockActive(lockAt: string | null): boolean {
  if (!lockAt) return false
  return Date.now() - new Date(lockAt).getTime() < SYNC_LOCK_TTL_MS
}

interface OfflineState {
  pendingLeads: CanvassPin[]
  isOnline: boolean
  isSyncing: boolean
  syncLockAt: string | null
  lastSyncAt: string | null
  addLead: (lead: CanvassPin) => void
  removeLead: (id: string) => void
  updateLead: (id: string, data: Partial<CanvassPin>) => void
  syncLeads: () => Promise<void>
  setOnline: (online: boolean) => void
}

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set, get) => ({
      pendingLeads: [],
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      isSyncing: false,
      syncLockAt: null,
      lastSyncAt: null,

      addLead: (lead) => {
        set((state) => ({
          pendingLeads: [lead, ...state.pendingLeads],
        }))
      },

      removeLead: (id) => {
        set((state) => ({
          pendingLeads: state.pendingLeads.filter((l) => l.id !== id),
        }))
      },

      updateLead: (id, data) => {
        set((state) => ({
          pendingLeads: state.pendingLeads.map((l) =>
            l.id === id ? { ...l, ...data } : l
          ),
        }))
      },

      syncLeads: async () => {
        const { pendingLeads, removeLead, updateLead } = get()
        if (pendingLeads.length === 0) return

        const persistedLockAt = readPersistedSyncLockAt()
        if (get().isSyncing || isSyncLockActive(persistedLockAt)) return

        const lockAt = new Date().toISOString()
        set({ isSyncing: true, syncLockAt: lockAt })

        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        const queueSnapshot = [...pendingLeads]

        try {
          for (const lead of queueSnapshot) {
            try {
              let clientLeadId = lead.client_lead_id
              if (!clientLeadId) {
                clientLeadId = crypto.randomUUID()
                updateLead(lead.id, { client_lead_id: clientLeadId })
              }

              const res = await fetch(`${origin}/api/canvass/lead`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lat: lead.lat,
                  lng: lead.lng,
                  homeowner_name: lead.homeowner_name,
                  address_text: lead.address_text,
                  phone: lead.phone,
                  email: lead.email,
                  canvass_disposition: lead.disposition,
                  canvass_notes: lead.notes,
                  source: 'canvass',
                  client_lead_id: clientLeadId,
                  rep_lat: lead.rep_lat ?? null,
                  rep_lng: lead.rep_lng ?? null,
                  rep_geo_accuracy: lead.rep_geo_accuracy ?? null,
                  rep_geo_captured_at: lead.rep_geo_captured_at ?? null,
                }),
              })

              if (res.ok) {
                removeLead(lead.id)
              } else {
                const errText = await res.text().catch(() => '')
                console.error('Failed to sync lead:', res.status, errText)
              }
            } catch (e) {
              console.error('Failed to sync lead:', e)
            }
          }

          set({ lastSyncAt: new Date().toISOString() })
        } finally {
          set({ isSyncing: false, syncLockAt: null })
        }
      },

      setOnline: (online) => {
        set({ isOnline: online })
      },
    }),
    {
      name: PERSIST_KEY,
      partialize: (state) => ({
        pendingLeads: state.pendingLeads,
        lastSyncAt: state.lastSyncAt,
        syncLockAt: state.syncLockAt,
      }),
    }
  )
)

// Listen for online/offline events and service-worker background-sync nudges
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useOfflineStore.getState().setOnline(true)
    useOfflineStore.getState().syncLeads()
  })

  window.addEventListener('offline', () => {
    useOfflineStore.getState().setOnline(false)
  })

  // public/canvass-sw.js registers a 'sync-leads' Background Sync tag and posts this
  // message to wake any open tab when the OS fires it — syncLeads() is safe to call
  // redundantly here since it no-ops under the isSyncing/syncLockAt guard.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SYNC_LEADS') {
        useOfflineStore.getState().syncLeads()
      }
    })
  }
}
