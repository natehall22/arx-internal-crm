'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CanvassPin } from '../page'

interface OfflineState {
  pendingLeads: CanvassPin[]
  isOnline: boolean
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
        const { pendingLeads, removeLead } = get()
        if (pendingLeads.length === 0) return

        const origin = typeof window !== 'undefined' ? window.location.origin : ''

        for (const lead of pendingLeads) {
          try {
            // Same server path as online saves — avoids duplicate rows from raw inserts + retries.
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
                rep_lat:             lead.rep_lat             ?? null,
                rep_lng:             lead.rep_lng             ?? null,
                rep_geo_accuracy:    lead.rep_geo_accuracy    ?? null,
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
      },

      setOnline: (online) => {
        set({ isOnline: online })
      },
    }),
    {
      name: 'canvass-offline-store',
      partialize: (state) => ({
        pendingLeads: state.pendingLeads,
        lastSyncAt: state.lastSyncAt,
      }),
    }
  )
)

// Listen for online/offline events
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useOfflineStore.getState().setOnline(true)
    useOfflineStore.getState().syncLeads()
  })
  
  window.addEventListener('offline', () => {
    useOfflineStore.getState().setOnline(false)
  })
}
