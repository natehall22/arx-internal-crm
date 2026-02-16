'use client'

import { useEffect, useState } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'
import CanvassMap from './components/CanvassMap'
import CanvassNav from './components/CanvassNav'
import LeadModal from './components/LeadModal'
import SyncStatus from './components/SyncStatus'
import { useOfflineStore } from './lib/offlineStore'
import { useGeolocation } from './lib/useGeolocation'

export type CanvassPin = {
  id: string
  lat: number
  lng: number
  homeowner_name?: string
  address_text?: string
  phone?: string
  email?: string
  status: string
  disposition?: string
  notes?: string
  created_at: string
  synced: boolean
  owner_user_id?: string
}

export default function CanvassPage() {
  const [pins, setPins] = useState<CanvassPin[]>([])
  const [selectedPin, setSelectedPin] = useState<CanvassPin | null>(null)
  const [showLeadModal, setShowLeadModal] = useState(false)
  const [newPinLocation, setNewPinLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [prefillAddress, setPrefillAddress] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<any>(null)
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map')
  
  const { position, error: geoError, requestPermission } = useGeolocation()
  const { pendingLeads, addLead, syncLeads, isOnline } = useOfflineStore()

  useEffect(() => {
    loadData()
    
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/canvass-sw.js').catch(console.error)
    }
  }, [])

  // Sync pending leads when online
  useEffect(() => {
    if (isOnline && pendingLeads.length > 0) {
      syncLeads()
    }
  }, [isOnline, pendingLeads.length])

  const loadData = async () => {
    const supabase = createClientBrowser()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      window.location.href = '/login?redirect=/canvass'
      return
    }

    const { data: profileData } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    setProfile(profileData)

    // Load pins for today (or recent)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { data: leadsData } = await supabase
      .from('leads')
      .select('*')
      .eq('org_id', profileData?.org_id)
      .gte('created_at', today.toISOString())
      .not('lat', 'is', null)
      .order('created_at', { ascending: false })

    const serverPins: CanvassPin[] = (leadsData || []).map(lead => ({
      id: lead.id,
      lat: parseFloat(lead.lat),
      lng: parseFloat(lead.lng),
      homeowner_name: lead.homeowner_name,
      address_text: lead.address_text,
      phone: lead.phone,
      email: lead.email,
      status: lead.status,
      disposition: lead.canvass_disposition,
      notes: lead.notes,
      created_at: lead.created_at,
      synced: true,
      owner_user_id: lead.owner_user_id,
    }))

    // Merge with pending offline leads
    const offlinePins: CanvassPin[] = pendingLeads.map(lead => ({
      ...lead,
      synced: false,
    }))

    setPins([...offlinePins, ...serverPins])
    setLoading(false)
  }

  const handleMapClick = (lat: number, lng: number) => {
    setNewPinLocation({ lat, lng })
    setSelectedPin(null)
    setPrefillAddress('')
    setShowLeadModal(true)
  }

  const handleAddressSelect = (lat: number, lng: number, address: string) => {
    setNewPinLocation({ lat, lng })
    setSelectedPin(null)
    setPrefillAddress(address)
    setShowLeadModal(true)
  }

  const handlePinClick = (pin: CanvassPin) => {
    setSelectedPin(pin)
    setNewPinLocation(null)
    setShowLeadModal(true)
  }

  const handleSaveLead = async (leadData: Partial<CanvassPin>) => {
    if (selectedPin) {
      // Update existing pin
      if (isOnline && selectedPin.synced) {
        const supabase = createClientBrowser()
        await supabase
          .from('leads')
          .update({
            homeowner_name: leadData.homeowner_name,
            phone: leadData.phone,
            email: leadData.email,
            address_text: leadData.address_text,
            notes: leadData.notes,
            canvass_disposition: leadData.disposition,
            status: leadData.status,
          })
          .eq('id', selectedPin.id)
      }
      
      setPins(pins.map(p => 
        p.id === selectedPin.id ? { ...p, ...leadData } : p
      ))
    } else if (newPinLocation) {
      // Create new pin
      const newPin: CanvassPin = {
        id: `offline_${Date.now()}`,
        lat: newPinLocation.lat,
        lng: newPinLocation.lng,
        homeowner_name: leadData.homeowner_name,
        address_text: leadData.address_text,
        phone: leadData.phone,
        email: leadData.email,
        status: 'new',
        disposition: leadData.disposition,
        notes: leadData.notes,
        created_at: new Date().toISOString(),
        synced: false,
        owner_user_id: profile?.id,
      }

      if (isOnline) {
        // Save directly to server
        const supabase = createClientBrowser()
        const { data, error } = await supabase
          .from('leads')
          .insert({
            org_id: profile?.org_id,
            owner_user_id: profile?.id,
            lat: newPinLocation.lat,
            lng: newPinLocation.lng,
            homeowner_name: leadData.homeowner_name,
            address_text: leadData.address_text,
            phone: leadData.phone,
            email: leadData.email,
            status: 'new',
            canvass_disposition: leadData.disposition,
            notes: leadData.notes,
            source: 'canvass',
            channel: 'outbound',
          })
          .select()
          .single()

        if (data) {
          newPin.id = data.id
          newPin.synced = true
        }
      } else {
        // Save to offline store
        addLead(newPin)
      }

      setPins([newPin, ...pins])
    }

    setShowLeadModal(false)
    setSelectedPin(null)
    setNewPinLocation(null)
  }

  const handleDropPinAtLocation = () => {
    if (position) {
      handleMapClick(position.lat, position.lng)
    } else {
      requestPermission()
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <header className="bg-indigo-600 text-white px-4 py-3 flex items-center justify-between safe-area-top">
        <div className="flex items-center gap-3">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <div>
            <h1 className="font-bold text-lg leading-tight">Canvass</h1>
            <p className="text-xs text-indigo-200">{profile?.full_name}</p>
          </div>
        </div>
        <SyncStatus pendingCount={pendingLeads.length} isOnline={isOnline} />
      </header>

      {/* Main Content */}
      <main className="flex-1 relative overflow-hidden">
        {viewMode === 'map' ? (
          <CanvassMap
            pins={pins}
            currentPosition={position}
            onMapClick={handleMapClick}
            onPinClick={handlePinClick}
            onAddressSelect={handleAddressSelect}
          />
        ) : (
          <div className="h-full overflow-y-auto p-4 pb-24">
            <div className="space-y-3">
              {pins.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  </svg>
                  <p>No pins dropped today</p>
                  <p className="text-sm">Tap the map to drop your first pin</p>
                </div>
              ) : (
                pins.map(pin => (
                  <button
                    key={pin.id}
                    onClick={() => handlePinClick(pin)}
                    className="w-full bg-white rounded-xl p-4 shadow-sm border text-left"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-gray-900">
                            {pin.homeowner_name || 'Unknown'}
                          </h3>
                          {!pin.synced && (
                            <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded">
                              Pending
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-0.5">
                          {pin.address_text || `${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`}
                        </p>
                        {pin.phone && (
                          <p className="text-sm text-gray-500">{pin.phone}</p>
                        )}
                      </div>
                      <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                        pin.disposition === 'hot_lead' ? 'bg-red-100 text-red-700' :
                        pin.disposition === 'go_back' ? 'bg-yellow-100 text-yellow-700' :
                        pin.disposition === 'not_home' ? 'bg-gray-100 text-gray-600' :
                        pin.disposition === 'not_interested' ? 'bg-gray-100 text-gray-600' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {pin.disposition?.replace('_', ' ') || 'New'}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Floating Action Button */}
        <button
          onClick={handleDropPinAtLocation}
          className="absolute bottom-24 right-4 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </button>
      </main>

      {/* Bottom Navigation */}
      <CanvassNav 
        viewMode={viewMode} 
        onViewModeChange={setViewMode}
        todayCount={pins.filter(p => {
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          return new Date(p.created_at) >= today
        }).length}
      />

      {/* Lead Modal */}
      {showLeadModal && (
        <LeadModal
          pin={selectedPin}
          location={newPinLocation}
          prefillAddress={prefillAddress}
          onSave={handleSaveLead}
          onClose={() => {
            setShowLeadModal(false)
            setSelectedPin(null)
            setNewPinLocation(null)
            setPrefillAddress('')
          }}
        />
      )}
    </div>
  )
}
