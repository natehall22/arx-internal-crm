'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createClientBrowser } from '@/lib/supabase/client'
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

        const supabase = createClientBrowser()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: profile } = await supabase
          .from('users')
          .select('org_id')
          .eq('id', user.id)
          .single()

        if (!profile) return

        for (const lead of pendingLeads) {
          try {
            const { error } = await supabase.from('leads').insert({
              org_id: profile.org_id,
              owner_user_id: lead.owner_user_id || user.id,
              lat: lead.lat,
              lng: lead.lng,
              homeowner_name: lead.homeowner_name,
              address_text: lead.address_text,
              phone: lead.phone,
              email: lead.email,
              status: lead.status || 'new',
              canvass_disposition: lead.disposition,
              notes: lead.notes,
              source: 'canvass',
              channel: 'outbound',
            })

            if (!error) {
              removeLead(lead.id)
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
