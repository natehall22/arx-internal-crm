'use client'

import { useEffect, useState, useCallback } from 'react'
import CanvassMap from './components/CanvassMap'
import CanvassNav from './components/CanvassNav'
import LeadModal from './components/LeadModal'
import SyncStatus from './components/SyncStatus'
import { useOfflineStore } from './lib/offlineStore'
import { useGeolocation } from './lib/useGeolocation'
import { useViewportLeads, ViewportPin, FullPinData } from './lib/useViewportLeads'

// Map data mode type - matches settings
type MapDataMode = 'ALL_LEADS' | 'VIEWPORT'

// Declare google as a global variable for TypeScript
declare const google: any

// Bounds type (google.maps.LatLngBounds at runtime)
type MapBounds = any

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

// Union type for display
type DisplayPin = CanvassPin | ViewportPin

export default function CanvassPage() {
  const [pins, setPins] = useState<CanvassPin[]>([])
  const [selectedPin, setSelectedPin] = useState<CanvassPin | null>(null)
  const [showLeadModal, setShowLeadModal] = useState(false)
  const [newPinLocation, setNewPinLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [prefillAddress, setPrefillAddress] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<any>(null)
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map')
  
  // Map data mode - default to VIEWPORT for scale (Spotio/Terros style)
  const [mapDataMode, setMapDataMode] = useState<MapDataMode>('VIEWPORT')
  
  const { position, error: geoError, requestPermission } = useGeolocation()
  const { pendingLeads, addLead, syncLeads, isOnline } = useOfflineStore()
  
  // Viewport mode hook - only active when mapDataMode === 'VIEWPORT'
  const { 
    pins: viewportPins, 
    loading: viewportLoading, 
    totalLoaded: viewportTotalLoaded,
    fetchForBounds,
    getPinDetails,
    clearCache: clearViewportCache,
    dispositionFilter,
    setDispositionFilter,
  } = useViewportLeads()
  
  // State for loading pin details (viewport mode)
  const [loadingPinDetails, setLoadingPinDetails] = useState(false)

  // Load settings on mount to determine map data mode
  useEffect(() => {
    const savedSettings = localStorage.getItem('canvass-settings')
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings)
        // Only switch to ALL_LEADS if explicitly set (VIEWPORT is default)
        if (parsed.mapDataMode === 'ALL_LEADS') {
          setMapDataMode('ALL_LEADS')
        }
      } catch (e) {
        // Ignore parse errors, use default (VIEWPORT)
      }
    }
  }, [])

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
    try {
      // Use API call instead of client-side Supabase (cookie compatibility)
      const response = await fetch('/api/canvass/data')
      
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = '/login?next=/canvass'
          return
        }
        console.error('Failed to load canvass data:', response.status)
        setLoading(false)
        return
      }

      const data = await response.json()
      
      // Set profile from API response
      setProfile({
        id: data.currentUserId,
        full_name: data.currentUserName,
        role: data.currentUserRole,
        org_id: data.orgId,
      })

      // Check current map data mode from settings (default is VIEWPORT)
      const savedSettings = localStorage.getItem('canvass-settings')
      let currentMode: MapDataMode = 'VIEWPORT' // Default to viewport for scale
      if (savedSettings) {
        try {
          const parsed = JSON.parse(savedSettings)
          if (parsed.mapDataMode === 'ALL_LEADS') {
            currentMode = 'ALL_LEADS'
          }
        } catch (e) {
          // Ignore parse errors, use default (VIEWPORT)
        }
      }

      // In VIEWPORT mode, skip loading all leads - they'll load via viewport
      if (currentMode === 'VIEWPORT') {
        // Just load pending offline leads
        const offlinePins: CanvassPin[] = pendingLeads.map(lead => ({
          ...lead,
          synced: false,
        }))
        setPins(offlinePins)
        setLoading(false)
        return
      }

      // ALL_LEADS mode: Use leads from API response
      const serverPins: CanvassPin[] = (data.leads || []).map((lead: any) => ({
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
    } catch (error) {
      console.error('Error in loadData:', error)
      setLoading(false)
    }
  }

  // Handler for map bounds change (viewport mode only)
  const handleBoundsChanged = useCallback((bounds: MapBounds, zoom: number) => {
    if (mapDataMode === 'VIEWPORT') {
      fetchForBounds(bounds, zoom)
    }
  }, [mapDataMode, fetchForBounds])

  // Merge viewport pins with local pins when in viewport mode
  const displayPins: DisplayPin[] = mapDataMode === 'VIEWPORT'
    ? [...pendingLeads.map(lead => ({ ...lead, synced: false } as CanvassPin)), ...viewportPins]
    : pins

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

  const handlePinClick = async (pin: DisplayPin) => {
    setNewPinLocation(null)
    
    // If it's a viewport pin (minimal data), fetch full details
    if ('d' in pin && !('homeowner_name' in pin)) {
      setLoadingPinDetails(true)
      const details = await getPinDetails(pin.id)
      setLoadingPinDetails(false)
      
      if (details) {
        // Convert to CanvassPin format
        const fullPin: CanvassPin = {
          id: details.id,
          lat: details.lat,
          lng: details.lng,
          homeowner_name: details.homeowner_name,
          address_text: details.address_text,
          phone: details.phone,
          email: details.email,
          status: details.status,
          disposition: details.canvass_disposition,
          notes: details.notes,
          created_at: details.created_at,
          synced: true,
          owner_user_id: details.owner_user_id,
        }
        setSelectedPin(fullPin)
        setShowLeadModal(true)
      }
    } else {
      // It's already a full CanvassPin
      setSelectedPin(pin as CanvassPin)
      setShowLeadModal(true)
    }
  }

  const handleSaveLead = async (leadData: Partial<CanvassPin>) => {
    if (selectedPin) {
      // Update existing pin via API
      if (isOnline && selectedPin.synced) {
        try {
          await fetch('/api/canvass/lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lead_id: selectedPin.id,
              homeowner_name: leadData.homeowner_name,
              phone: leadData.phone,
              email: leadData.email,
              address_text: leadData.address_text,
              notes: leadData.notes,
              canvass_disposition: leadData.disposition,
            }),
          })
        } catch (error) {
          console.error('Failed to update lead:', error)
        }
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
        // Save directly to server via API
        try {
          const response = await fetch('/api/canvass/lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lat: newPinLocation.lat,
              lng: newPinLocation.lng,
              homeowner_name: leadData.homeowner_name,
              address_text: leadData.address_text,
              phone: leadData.phone,
              email: leadData.email,
              canvass_disposition: leadData.disposition,
              notes: leadData.notes,
              source: 'canvass',
            }),
          })

          if (response.ok) {
            const data = await response.json()
            if (data.lead_id) {
              newPin.id = data.lead_id
              newPin.synced = true
            }
          }
        } catch (error) {
          console.error('Failed to create lead:', error)
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
            pins={displayPins}
            currentPosition={position}
            onMapClick={handleMapClick}
            onPinClick={handlePinClick}
            onAddressSelect={handleAddressSelect}
            onBoundsChanged={mapDataMode === 'VIEWPORT' ? handleBoundsChanged : undefined}
            isViewportMode={mapDataMode === 'VIEWPORT'}
            viewportLoading={viewportLoading || loadingPinDetails}
            totalPinsLoaded={viewportTotalLoaded}
            dispositionFilter={dispositionFilter}
            onDispositionFilterChange={setDispositionFilter}
          />
        ) : (
          <div className="h-full overflow-y-auto p-4 pb-24">
            <div className="space-y-3">
              {displayPins.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  </svg>
                  <p>No pins dropped today</p>
                  <p className="text-sm">Tap the map to drop your first pin</p>
                </div>
              ) : (
                displayPins.map(pin => {
                  // Handle both CanvassPin and ViewportPin formats
                  const isViewportPin = 'd' in pin
                  const disposition = isViewportPin ? (pin as ViewportPin).d : (pin as CanvassPin).disposition
                  const homeownerName = isViewportPin ? null : (pin as CanvassPin).homeowner_name
                  const addressText = isViewportPin ? null : (pin as CanvassPin).address_text
                  const phone = isViewportPin ? null : (pin as CanvassPin).phone
                  const synced = isViewportPin ? true : (pin as CanvassPin).synced
                  
                  return (
                    <button
                      key={pin.id}
                      onClick={() => handlePinClick(pin)}
                      className="w-full bg-white rounded-xl p-4 shadow-sm border text-left"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-gray-900">
                              {homeownerName || 'Tap to view'}
                            </h3>
                            {!synced && (
                              <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded">
                                Pending
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-500 mt-0.5">
                            {addressText || `${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`}
                          </p>
                          {phone && (
                            <p className="text-sm text-gray-500">{phone}</p>
                          )}
                        </div>
                        <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                          disposition === 'hot_lead' ? 'bg-red-100 text-red-700' :
                          disposition === 'go_back' ? 'bg-yellow-100 text-yellow-700' :
                          disposition === 'not_home' ? 'bg-gray-100 text-gray-600' :
                          disposition === 'not_interested' ? 'bg-gray-100 text-gray-600' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {disposition?.replace('_', ' ') || 'New'}
                        </span>
                      </div>
                    </button>
                  )
                })
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
        todayCount={displayPins.filter(p => {
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          const createdAt = 't' in p ? p.t : (p as CanvassPin).created_at
          return new Date(createdAt) >= today
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
