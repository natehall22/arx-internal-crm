'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { matchesCanvassDispositionFilter } from '@/lib/canvass-pin-filter'
import { CanvassTerritoriesEditor } from '@/components/canvass-territories/CanvassTerritoriesEditor'
import CanvassMap from './components/CanvassMap'
import CanvassNav from './components/CanvassNav'
import LeadModal from './components/LeadModal'
import SyncStatus from './components/SyncStatus'
import { recordSuccessfulInspectionSubmit } from './lib/inspectionSubmitCooldown'
import { useOfflineStore } from './lib/offlineStore'
import { useGeolocation } from './lib/useGeolocation'
import { useViewportLeads, ViewportPin, FullPinData } from './lib/useViewportLeads'
import type { AssignedTerritoryMapPayload } from '@/lib/canvass-territories'

// Global type declarations for Google Maps and MarkerClusterer
declare global {
  interface Window {
    google?: any
    markerClusterer?: any
  }
}

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
  updated_at?: string
  synced: boolean
  owner_user_id?: string
  owner_name?: string
}

// Union type for display
type DisplayPin = CanvassPin | ViewportPin

export default function CanvassPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const workAreasParam = searchParams.get('areas') === '1'

  const [selectedPin, setSelectedPin] = useState<CanvassPin | null>(null)
  const [showLeadModal, setShowLeadModal] = useState(false)
  const [newPinLocation, setNewPinLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [prefillAddress, setPrefillAddress] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<any>(null)
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map')
  
  // Users and teams for scheduling
  const [users, setUsers] = useState<Array<{ id: string; full_name: string; has_calendar?: boolean }>>([])
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([])
  const [inspectionDuration, setInspectionDuration] = useState(60)
  const [assignedTerritories, setAssignedTerritories] = useState<AssignedTerritoryMapPayload[]>([])
  
  // Disposition settings from admin
  const [dispositions, setDispositions] = useState<Array<{ id: string; label: string; color: string; active: boolean }>>([
    { id: 'not_home', label: 'Not Home', color: '#9CA3AF', active: true },
    { id: 'bad_roof', label: 'Bad Roof', color: '#78716C', active: true },
    { id: 'renter', label: 'Renter', color: '#A1A1AA', active: true },
    { id: 'go_back', label: 'Go Back', color: '#F59E0B', active: true },
    { id: 'hot_lead', label: 'Hot Lead', color: '#EF4444', active: true },
    { id: 'not_interested', label: 'Not Interested', color: '#6B7280', active: true },
  ])
  
  const { position, error: geoError, requestPermission } = useGeolocation()
  const { pendingLeads, addLead, syncLeads, isOnline } = useOfflineStore()
  
  const { 
    pins: viewportPins, 
    loading: viewportLoading, 
    totalLoaded: viewportTotalLoaded,
    fetchForBounds,
    getPinDetails,
    clearCache: clearViewportCache,
    addPin: addViewportPin,
    updatePin: updateViewportPin,
    removePin: removeViewportPin,
    dispositionFilter,
    setDispositionFilter,
  } = useViewportLeads()
  
  // State for loading pin details (viewport mode)
  const [loadingPinDetails, setLoadingPinDetails] = useState(false)
  const [refetchTrigger, setRefetchTrigger] = useState(0)

  // Strip legacy mapDataMode from localStorage (viewport-only map)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('canvass-settings')
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if ('mapDataMode' in parsed) {
        delete parsed.mapDataMode
        localStorage.setItem('canvass-settings', JSON.stringify(parsed))
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadData()

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/canvass-sw.js').catch(console.error)
    }
  }, [])

  /** Work areas deep-link only for managers; strip ?areas=1 for everyone else. */
  useEffect(() => {
    if (loading || !profile) return
    if (workAreasParam && !profile.canManageCanvassTerritories) {
      router.replace('/canvass')
    }
  }, [loading, profile, workAreasParam, router])

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
          const next =
            typeof window !== 'undefined'
              ? `${window.location.pathname}${window.location.search}`
              : '/canvass'
          window.location.href = `/login?next=${encodeURIComponent(next)}`
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
        canManageCanvassTerritories: !!data.canManageCanvassTerritories,
      })
      
      // Store users and teams for scheduling
      if (data.users) {
        setUsers(data.users.map((u: any) => ({
          id: u.id,
          full_name: u.full_name,
          has_calendar: u.has_calendar,
        })))
      }
      if (data.teams) {
        setTeams(data.teams.map((t: any) => ({
          id: t.id,
          name: t.name,
        })))
      }
      if (data.inspectionDuration) {
        setInspectionDuration(data.inspectionDuration)
      }
      
      // Load dispositions from org settings
      if (data.orgSettings?.canvass_dispositions) {
        const orgDispositions = data.orgSettings.canvass_dispositions
        if (Array.isArray(orgDispositions) && orgDispositions.length > 0) {
          setDispositions(orgDispositions.filter((d: any) => d.active !== false))
        }
      }

      if (Array.isArray(data.assignedTerritories)) {
        setAssignedTerritories(data.assignedTerritories)
      } else {
        setAssignedTerritories([])
      }

      // Pins load via viewport bounds (useViewportLeads); pending offline leads merge in displayPins
      setLoading(false)
    } catch (error) {
      console.error('Error in loadData:', error)
      setLoading(false)
    }
  }

  const handleBoundsChanged = useCallback((bounds: MapBounds, zoom: number) => {
    fetchForBounds(bounds, zoom)
  }, [fetchForBounds])

  const displayPins: DisplayPin[] = useMemo(() => {
    const merged: DisplayPin[] = [
      ...pendingLeads.map((lead) => ({ ...lead, synced: false } as CanvassPin)),
      ...viewportPins,
    ]
    if (dispositionFilter == null || dispositionFilter === '') {
      return merged
    }
    return merged.filter((p) => matchesCanvassDispositionFilter(p, dispositionFilter))
  }, [pendingLeads, viewportPins, dispositionFilter])

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
        // Note: API returns canvass_notes, we map it to notes for the modal
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
          notes: details.canvass_notes || details.notes || '',
          created_at: details.created_at,
          updated_at: details.updated_at,
          synced: true,
          owner_user_id: details.owner_user_id,
          owner_name: details.owner?.full_name,
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

  const handleSaveLead = async (leadData: Partial<CanvassPin> & {
    schedule_inspection?: boolean
    closer_user_id?: string
    inspection_scheduled_for?: string
  }) => {
    if (selectedPin) {
      // Update existing pin via API
      let apiSuccess = false
      if (isOnline && selectedPin.synced) {
        try {
          const response = await fetch('/api/canvass/lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lead_id: selectedPin.id,
              homeowner_name: leadData.homeowner_name,
              phone: leadData.phone,
              email: leadData.email,
              address_text: leadData.address_text,
              canvass_notes: leadData.notes,
              canvass_disposition: leadData.disposition,
              // Scheduling fields
              schedule_inspection: leadData.schedule_inspection,
              closer_user_id: leadData.closer_user_id,
              inspection_scheduled_for: leadData.inspection_scheduled_for,
            }),
          })
          
          if (response.ok) {
            apiSuccess = true
            const data = await response.json()
            if (leadData.schedule_inspection) {
              recordSuccessfulInspectionSubmit()
            }
            console.log('Lead updated successfully:', { 
              lead_id: data.lead_id,
              disposition: leadData.disposition,
              notes: leadData.notes 
            })
            if (data.calendar_synced) {
              console.log('Calendar synced successfully')
            }
            if (data.opportunity_id) {
              console.log('Opportunity created:', data.opportunity_id)
            }
          } else {
            const errorData = await response.json().catch(() => ({}))
            console.error('Failed to update lead - API error:', errorData)
            const msg =
              typeof (errorData as { error?: string }).error === 'string'
                ? (errorData as { error: string }).error
                : 'Failed to save changes. Please try again.'
            alert(msg)
          }
        } catch (error) {
          console.error('Failed to update lead:', error)
          alert('Failed to save changes. Please check your connection.')
        }
      } else {
        // Offline mode - will sync later
        apiSuccess = true
      }
      
      // Only update local state if API succeeded (or offline)
      if (!apiSuccess) {
        return
      }
      
      // Update local state
      const updatedPin = { ...selectedPin, ...leadData }
      if (leadData.schedule_inspection) {
        updatedPin.status = 'inspection'
        updatedPin.disposition = 'scheduled'
      }
      
      const viewportPin = {
        id: selectedPin.id,
        lat: selectedPin.lat,
        lng: selectedPin.lng,
        d: updatedPin.disposition || null,
        s: updatedPin.status,
        o: selectedPin.owner_user_id || null,
        t: selectedPin.created_at,
      }
      updateViewportPin(viewportPin)
    } else if (newPinLocation) {
      let createFailed = false
      // Create new pin
      const newPin: CanvassPin = {
        id: `offline_${Date.now()}`,
        lat: newPinLocation.lat,
        lng: newPinLocation.lng,
        homeowner_name: leadData.homeowner_name,
        address_text: leadData.address_text,
        phone: leadData.phone,
        email: leadData.email,
        status: leadData.schedule_inspection ? 'inspection' : 'new',
        disposition: leadData.schedule_inspection ? 'scheduled' : leadData.disposition,
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
              canvass_notes: leadData.notes,
              source: 'canvass',
              // Scheduling fields
              schedule_inspection: leadData.schedule_inspection,
              closer_user_id: leadData.closer_user_id,
              inspection_scheduled_for: leadData.inspection_scheduled_for,
            }),
          })

          if (response.ok) {
            const data = await response.json()
            if (leadData.schedule_inspection) {
              recordSuccessfulInspectionSubmit()
            }
            if (data.lead_id) {
              newPin.id = data.lead_id
              newPin.synced = true
            }
            // Match server + existing-pin path: API may omit schedule_inspection; opportunity can be null
            if (
              leadData.schedule_inspection ||
              data.schedule_inspection ||
              data.opportunity_id
            ) {
              newPin.status = 'inspection'
              newPin.disposition = 'scheduled'
            }
            if (data.calendar_synced) {
              console.log('Calendar synced successfully')
            }
          } else {
            const errorData = await response.json().catch(() => ({}))
            const msg =
              typeof (errorData as { error?: string }).error === 'string'
                ? (errorData as { error: string }).error
                : 'Could not save lead. Please try again.'
            alert(msg)
            createFailed = true
          }
        } catch (error) {
          console.error('Failed to create lead:', error)
          // Network error - save to offline store so pin persists
          addLead(newPin)
        }
      } else {
        // Save to offline store (scheduling not available offline)
        addLead(newPin)
      }

      if (createFailed) {
        return
      }

      const viewportPin = {
        id: newPin.id,
        lat: newPin.lat,
        lng: newPin.lng,
        d: newPin.disposition || null,
        s: newPin.status,
        o: newPin.owner_user_id || null,
        t: newPin.created_at,
      }
      addViewportPin(viewportPin)
    }

    setShowLeadModal(false)
    setSelectedPin(null)
    setNewPinLocation(null)
    setPrefillAddress('')
    setRefetchTrigger(t => t + 1)
  }

  const handleDropPinAtLocation = () => {
    if (position) {
      handleMapClick(position.lat, position.lng)
    } else {
      requestPermission()
    }
  }

  const showWorkAreasPanel =
    workAreasParam && profile?.canManageCanvassTerritories === true

  const clearWorkAreasQuery = useCallback(() => {
    router.replace('/canvass')
  }, [router])

  const handleViewModeChange = useCallback(
    (mode: 'map' | 'list') => {
      clearWorkAreasQuery()
      setViewMode(mode)
    },
    [clearWorkAreasQuery]
  )

  const openWorkAreas = useCallback(() => {
    router.replace('/canvass?areas=1')
  }, [router])

  const handleDeleteLead = async (pinId: string) => {
    if (!isOnline) {
      alert('Cannot delete pins while offline')
      return
    }

    try {
      const response = await fetch(`/api/canvass/lead?id=${pinId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        removeViewportPin(pinId)
        
        setShowLeadModal(false)
        setSelectedPin(null)
        setRefetchTrigger(t => t + 1)
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to delete pin')
      }
    } catch (error) {
      console.error('Failed to delete lead:', error)
      alert('Failed to delete pin')
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
            <p className="text-xs text-indigo-200">
              {showWorkAreasPanel ? 'Work areas — draw polygons & assign reps' : profile?.full_name}
            </p>
          </div>
        </div>
        <SyncStatus pendingCount={pendingLeads.length} isOnline={isOnline} />
      </header>

      {/* Main Content */}
      <main className="flex-1 relative overflow-hidden">
        {showWorkAreasPanel ? (
          <div className="h-full overflow-y-auto overflow-x-hidden p-3 pb-28 sm:p-4">
            <CanvassTerritoriesEditor forbiddenRedirect="/canvass" compact />
          </div>
        ) : viewMode === 'map' ? (
          <CanvassMap
            pins={displayPins}
            currentPosition={position}
            onMapClick={handleMapClick}
            onPinClick={handlePinClick}
            onAddressSelect={handleAddressSelect}
            onBoundsChanged={handleBoundsChanged}
            isViewportMode
            viewportLoading={viewportLoading || loadingPinDetails}
            totalPinsLoaded={viewportTotalLoaded}
            onRefreshArea={clearViewportCache}
            refetchTrigger={refetchTrigger}
            dispositionFilter={dispositionFilter}
            onDispositionFilterChange={setDispositionFilter}
            dispositions={dispositions}
            assignedTerritories={assignedTerritories}
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

        {!showWorkAreasPanel && (
          <button
            type="button"
            onClick={handleDropPinAtLocation}
            className="absolute bottom-24 right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition-transform active:scale-95"
          >
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </button>
        )}
      </main>

      {/* Bottom Navigation */}
      <CanvassNav
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        showWorkAreasLink={profile?.canManageCanvassTerritories === true}
        workAreasActive={showWorkAreasPanel}
        onWorkAreas={profile?.canManageCanvassTerritories ? openWorkAreas : undefined}
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
          onDelete={selectedPin?.synced ? handleDeleteLead : undefined}
          onClose={() => {
            setShowLeadModal(false)
            setSelectedPin(null)
            setNewPinLocation(null)
            setPrefillAddress('')
            setRefetchTrigger(t => t + 1)
          }}
          users={users}
          teams={teams}
          inspectionDuration={inspectionDuration}
          isOnline={isOnline}
          dispositions={dispositions}
        />
      )}
    </div>
  )
}
