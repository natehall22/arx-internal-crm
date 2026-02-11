'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Nav from '@/components/Nav'
import { createClientBrowser } from '@/lib/supabase/client'
import type { CanvassDisposition, Lead } from '@/lib/types/database'

type UserOption = { id: string; full_name: string | null; role: string }

type LeadFormState = {
  lead_id?: string | null
  homeowner_name: string
  phone: string
  email: string
  address_text: string
  lat: number | null
  lng: number | null
  canvass_disposition: CanvassDisposition | ''
  canvass_notes: string
  closer_user_id: string
  schedule_inspection: boolean
  inspection_scheduled_for: string
}

type CachedPin = LeadFormState & {
  cached_at: number
  synced: boolean
}

type MapType = 'roadmap' | 'satellite' | 'hybrid' | 'terrain'

const DB_NAME = 'arx_canvass_db'
const DB_VERSION = 1
const STORE_NAME = 'pending_pins'

// Default disposition config with colors and categories
// These can be customized by admin in Settings > Canvass Dispositions
const defaultDispositionOptions = [
  { id: 'not_home', label: 'Not Home', category: 'No Contact', color: '#ef4444', active: true },
  { id: 'bad_roof', label: 'Bad Roof', category: 'No Contact', color: '#f97316', active: true },
  { id: 'renter', label: 'Renter', category: 'Unqualified', color: '#eab308', active: true },
  { id: 'go_back', label: 'Go Back', category: 'Contact', color: '#3b82f6', active: true },
  { id: 'hot_lead', label: 'Hot Lead', category: 'Contact', color: '#22c55e', active: true },
  { id: 'not_interested', label: 'Not Interested', category: 'Closed', color: '#6b7280', active: true },
]

const defaultForm: LeadFormState = {
  lead_id: null,
  homeowner_name: '',
  phone: '',
  email: '',
  address_text: '',
  lat: null,
  lng: null,
  canvass_disposition: '',
  canvass_notes: '',
  closer_user_id: '',
  schedule_inspection: false,
  inspection_scheduled_for: '',
}

declare global {
  interface Window {
    google?: any
  }
}

// IndexedDB helpers
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'cached_at' })
      }
    }
  })
}

const savePinOffline = async (pin: CachedPin): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(pin)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

const getPendingPins = async (): Promise<CachedPin[]> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result || [])
  })
}

const clearSyncedPins = async (): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.clear()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

export default function CanvassMapPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [closers, setClosers] = useState<UserOption[]>([])
  const [currentUserRole, setCurrentUserRole] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [dispositionOptions, setDispositionOptions] = useState(defaultDispositionOptions)

  // Get disposition color - uses current dispositionOptions state
  const getDispositionColor = (disposition?: CanvassDisposition | string | null): string => {
    const opt = dispositionOptions.find(o => o.id === disposition)
    return opt?.color || '#a855f7' // Purple for new/unknown
  }

  const getDispositionLabel = (disposition?: CanvassDisposition | string | null): string => {
    const opt = dispositionOptions.find(o => o.id === disposition)
    return opt?.label || 'New'
  }

  const getDispositionCategory = (disposition?: CanvassDisposition | string | null): string => {
    const opt = dispositionOptions.find(o => o.id === disposition)
    return opt?.category || ''
  }
  const [formState, setFormState] = useState<LeadFormState>(defaultForm)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [mapKey, setMapKey] = useState<string>(
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
  )
  const [allowManualKey, setAllowManualKey] = useState(false)
  const [mapStatus, setMapStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('loading')
  const [mapType, setMapType] = useState<MapType>('hybrid')
  const [isOnline, setIsOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showMapTypeMenu, setShowMapTypeMenu] = useState(false)
  const [showImportExport, setShowImportExport] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showAddressSearch, setShowAddressSearch] = useState(false)
  const [searchAddress, setSearchAddress] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchAutocompleteRef = useRef<any>(null)

  const mapRef = useRef<any>(null)
  const markersRef = useRef<Record<string, any>>({})
  const userMarkerRef = useRef<any>(null)
  const infoWindowRef = useRef<any>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const newPinMarkerRef = useRef<any>(null)

  const hasPin = formState.lat != null && formState.lng != null

  const defaultCenter = useMemo(() => ({ lat: 38.5, lng: -97.0 }), [])

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    
    setIsOnline(navigator.onLine)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Load pending pins count
  useEffect(() => {
    const loadPendingCount = async () => {
      try {
        const pins = await getPendingPins()
        setPendingCount(pins.filter(p => !p.synced).length)
      } catch {
        // IndexedDB not available
      }
    }
    loadPendingCount()
  }, [])

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      syncPendingPins()
    }
  }, [isOnline, pendingCount])

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname
      setAllowManualKey(host === 'localhost' || host === '127.0.0.1')
    }
    if (!mapKey && typeof window !== 'undefined') {
      const storedKey = window.localStorage.getItem('arx_maps_key') || ''
      if (storedKey) {
        setMapKey(storedKey)
      }
    }
  }, [mapKey])

  useEffect(() => {
    initializeMap()
  }, [defaultCenter, mapKey])

  useEffect(() => {
    if (!mapRef.current || !window.google) return
    renderMarkers()
  }, [leads])

  // Change map type when selection changes
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setMapTypeId(mapType)
    }
  }, [mapType])

  // Battery-efficient GPS - only when map is loaded
  useEffect(() => {
    if (mapStatus !== 'loaded') return
    
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          setUserLocation(loc)
          if (mapRef.current) {
            mapRef.current.setCenter(loc)
            mapRef.current.setZoom(18)
          }
        },
        () => {},
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      )

      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        },
        () => {},
        { enableHighAccuracy: false, timeout: 30000, maximumAge: 30000 }
      )
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [mapStatus])

  // Update user location marker (blue dot)
  useEffect(() => {
    if (!mapRef.current || !window.google || !userLocation) return

    if (userMarkerRef.current) {
      userMarkerRef.current.setPosition(userLocation)
    } else {
      userMarkerRef.current = new window.google.maps.Marker({
        position: userLocation,
        map: mapRef.current,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 10,
          strokeColor: '#3b82f6',
          strokeWeight: 3,
          fillColor: '#3b82f6',
          fillOpacity: 0.3,
        },
        title: 'You are here',
        zIndex: 1000,
      })
    }
  }, [userLocation])

  // Update new pin marker when form lat/lng changes
  useEffect(() => {
    if (!mapRef.current || !window.google) return

    if (hasPin && !formState.lead_id) {
      // New pin being placed
      if (newPinMarkerRef.current) {
        newPinMarkerRef.current.setPosition({ lat: formState.lat, lng: formState.lng })
      } else {
        newPinMarkerRef.current = new window.google.maps.Marker({
          position: { lat: formState.lat, lng: formState.lng },
          map: mapRef.current,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 14,
            strokeColor: '#a855f7',
            strokeWeight: 3,
            fillColor: '#a855f7',
            fillOpacity: 0.9,
          },
          zIndex: 999,
          animation: window.google.maps.Animation.DROP,
        })
      }
    } else {
      // Remove new pin marker
      if (newPinMarkerRef.current) {
        newPinMarkerRef.current.setMap(null)
        newPinMarkerRef.current = null
      }
    }
  }, [hasPin, formState.lat, formState.lng, formState.lead_id])

  const loadData = async () => {
    if (!navigator.onLine) {
      setLoading(false)
      return
    }
    
    const supabase = createClientBrowser()
    
    // Get current user's role and org settings
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('users')
        .select('role, org_id')
        .eq('id', user.id)
        .single()
      if (profile) {
        setCurrentUserRole(profile.role)
        
        // Load org disposition settings
        const { data: org } = await supabase
          .from('orgs')
          .select('settings')
          .eq('id', profile.org_id)
          .single()
        
        if (org?.settings?.canvass_dispositions) {
          // Filter to only active dispositions
          const activeDispositions = org.settings.canvass_dispositions.filter((d: any) => d.active !== false)
          if (activeDispositions.length > 0) {
            setDispositionOptions(activeDispositions)
          }
        }
      }
    }
    
    const { data: leadsData } = await supabase
      .from('leads')
      .select('*')
      .not('lat', 'is', null)
      .not('lng', 'is', null)

    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, role')
      .order('full_name', { ascending: true })

    setLeads(leadsData || [])
    setClosers((users || []) as UserOption[])
    setLoading(false)
  }

  const initializeMap = async () => {
    if (!mapContainerRef.current) return
    if (!mapKey) return

    setMapStatus('loading')

    try {
      await loadGoogleMapsScript()
    } catch (error) {
      setMapStatus('error')
      return
    }

    if (!window.google) return

    mapRef.current = new window.google.maps.Map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 18,
      mapTypeId: mapType,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
      zoomControl: true,
      gestureHandling: 'greedy',
    })
    setMapStatus('loaded')
    infoWindowRef.current = new window.google.maps.InfoWindow()

    // Click on map to drop a new pin
    mapRef.current.addListener('click', async (event: any) => {
      const lat = event.latLng?.lat()
      const lng = event.latLng?.lng()
      if (lat == null || lng == null) return

      // Close any open info window
      if (infoWindowRef.current) {
        infoWindowRef.current.close()
      }

      let address = ''
      if (isOnline) {
        address = await reverseGeocode(lat, lng) || ''
      }
      
      setFormState({
        ...defaultForm,
        lat,
        lng,
        address_text: address,
      })
      setShowForm(true)
    })
  }

  const loadGoogleMapsScript = () => {
    return new Promise<void>((resolve, reject) => {
      if (window.google) {
        resolve()
        return
      }
      const existing = document.querySelector('script[data-google-maps]')
      if (existing) {
        existing.addEventListener('load', () => resolve())
        return
      }
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${mapKey}`
      script.async = true
      script.defer = true
      script.dataset.googleMaps = 'true'
      script.onload = () => resolve()
      script.onerror = () => reject()
      document.head.appendChild(script)
    })
  }

  const reverseGeocode = async (lat: number, lng: number) => {
    if (!window.google) return null
    try {
      const geocoder = new window.google.maps.Geocoder()
      const { results } = await geocoder.geocode({ location: { lat, lng } })
      return results?.[0]?.formatted_address || null
    } catch {
      return null
    }
  }

  const renderMarkers = () => {
    // Clear existing markers
    Object.values(markersRef.current).forEach((marker) => marker.setMap(null))
    markersRef.current = {}

    leads.forEach((lead) => {
      if (lead.lat == null || lead.lng == null) return
      
      const color = getDispositionColor(lead.canvass_disposition)
      
      // Create round bubble marker
      const marker = new window.google.maps.Marker({
        position: { lat: Number(lead.lat), lng: Number(lead.lng) },
        map: mapRef.current,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 12,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: 1,
        },
        title: lead.homeowner_name || lead.address_text || 'Lead',
      })

      marker.addListener('click', () => {
        openInfoWindow(marker, lead)
      })

      markersRef.current[lead.id] = marker
    })
  }

  const openInfoWindow = (marker: any, lead: Lead) => {
    if (!infoWindowRef.current) return

    const color = getDispositionColor(lead.canvass_disposition)
    const label = getDispositionLabel(lead.canvass_disposition)
    const category = getDispositionCategory(lead.canvass_disposition)
    
    // Rich info window with all customer details
    const content = `
      <div style="min-width:240px;max-width:300px;font-family:system-ui,-apple-system,sans-serif">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="width:12px;height:12px;border-radius:50%;background:${color}"></div>
          <span style="font-size:12px;color:#6b7280">${category ? category + ' - ' : ''}${label}</span>
        </div>
        <div style="font-weight:600;font-size:16px;margin-bottom:4px">${lead.homeowner_name || 'Unknown'}</div>
        <div style="font-size:13px;color:#4b5563;margin-bottom:8px">${lead.address_text || 'No address'}</div>
        ${lead.phone ? `<div style="font-size:13px;margin-bottom:2px"><a href="tel:${lead.phone}" style="color:#3b82f6">${lead.phone}</a></div>` : ''}
        ${lead.email ? `<div style="font-size:13px;margin-bottom:8px"><a href="mailto:${lead.email}" style="color:#3b82f6">${lead.email}</a></div>` : ''}
        ${lead.canvass_notes ? `<div style="font-size:12px;color:#6b7280;background:#f3f4f6;padding:8px;border-radius:6px;margin-top:8px;white-space:pre-wrap">${lead.canvass_notes}</div>` : ''}
        <button 
          onclick="window.dispatchEvent(new CustomEvent('edit-lead', {detail: '${lead.id}'}))"
          style="margin-top:12px;width:100%;padding:8px;background:#4f46e5;color:white;border:none;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer"
        >
          Edit Lead
        </button>
      </div>
    `
    
    infoWindowRef.current.setContent(content)
    infoWindowRef.current.open({ anchor: marker, map: mapRef.current })
  }

  // Listen for edit-lead events from info window
  useEffect(() => {
    const handleEditLead = (e: CustomEvent) => {
      const leadId = e.detail
      const lead = leads.find(l => l.id === leadId)
      if (!lead) return

      setFormState({
        lead_id: lead.id,
        homeowner_name: lead.homeowner_name || '',
        phone: lead.phone || '',
        email: lead.email || '',
        address_text: lead.address_text || '',
        lat: lead.lat,
        lng: lead.lng,
        canvass_disposition: (lead.canvass_disposition as CanvassDisposition) || '',
        canvass_notes: lead.canvass_notes || '',
        closer_user_id: lead.closer_user_id || '',
        schedule_inspection: lead.status === 'inspection',
        inspection_scheduled_for: lead.inspection_scheduled_for
          ? lead.inspection_scheduled_for.slice(0, 16)
          : '',
      })
      setShowForm(true)
      if (infoWindowRef.current) {
        infoWindowRef.current.close()
      }
    }

    window.addEventListener('edit-lead', handleEditLead as EventListener)
    return () => window.removeEventListener('edit-lead', handleEditLead as EventListener)
  }, [leads])

  const syncPendingPins = async () => {
    if (syncing || !isOnline) return
    setSyncing(true)
    setStatusMessage('Syncing cached pins...')

    try {
      const pins = await getPendingPins()
      const unsynced = pins.filter(p => !p.synced)
      
      for (const pin of unsynced) {
        const res = await fetch('/api/canvass/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pin),
        })
        
        if (res.ok) {
          pin.synced = true
          await savePinOffline(pin)
        }
      }

      await clearSyncedPins()
      setPendingCount(0)
      setStatusMessage(`Synced ${unsynced.length} pin(s)`)
      await loadData()
    } catch (err) {
      setStatusMessage('Sync failed. Will retry when online.')
    } finally {
      setSyncing(false)
      setTimeout(() => setStatusMessage(null), 3000)
    }
  }

  const handleSave = async () => {
    if (formState.lat == null || formState.lng == null) {
      setStatusMessage('Drop a pin to set the location first.')
      return
    }
    if (formState.schedule_inspection && !formState.closer_user_id) {
      setStatusMessage('Select a closer before scheduling.')
      return
    }
    if (formState.schedule_inspection && !formState.inspection_scheduled_for) {
      setStatusMessage('Select inspection date/time.')
      return
    }

    // If offline, cache the pin locally
    if (!isOnline) {
      const cachedPin: CachedPin = {
        ...formState,
        cached_at: Date.now(),
        synced: false,
      }
      await savePinOffline(cachedPin)
      setPendingCount(prev => prev + 1)
      setStatusMessage('Saved offline. Will sync when connected.')
      setFormState(defaultForm)
      setShowForm(false)
      return
    }

    setStatusMessage('Saving...')
    const res = await fetch('/api/canvass/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formState),
    })

    if (!res.ok) {
      const cachedPin: CachedPin = {
        ...formState,
        cached_at: Date.now(),
        synced: false,
      }
      await savePinOffline(cachedPin)
      setPendingCount(prev => prev + 1)
      setStatusMessage('Save failed. Cached for later.')
      return
    }

    const data = await res.json()
    if (data?.opportunity_id) {
      setStatusMessage('Lead saved + Opportunity created!')
    } else {
      setStatusMessage('Lead saved')
    }
    setFormState(defaultForm)
    setShowForm(false)
    await loadData()
    setTimeout(() => setStatusMessage(null), 2000)
  }

  const centerOnUser = () => {
    if (userLocation && mapRef.current) {
      mapRef.current.panTo(userLocation)
      mapRef.current.setZoom(18)
    }
  }

  const handleExportCSV = async () => {
    const csvRows = [
      ['homeowner_name', 'address', 'phone', 'email', 'lat', 'lng', 'disposition', 'notes', 'created_at'].join(',')
    ]
    
    leads.forEach(lead => {
      const row = [
        `"${(lead.homeowner_name || '').replace(/"/g, '""')}"`,
        `"${(lead.address_text || '').replace(/"/g, '""')}"`,
        `"${(lead.phone || '').replace(/"/g, '""')}"`,
        `"${(lead.email || '').replace(/"/g, '""')}"`,
        lead.lat || '',
        lead.lng || '',
        `"${(lead.canvass_disposition || '').replace(/"/g, '""')}"`,
        `"${(lead.canvass_notes || '').replace(/"/g, '""')}"`,
        lead.created_at || ''
      ]
      csvRows.push(row.join(','))
    })
    
    const csvContent = csvRows.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `leads_export_${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setShowImportExport(false)
  }

  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setImporting(true)
    setStatusMessage('Importing leads...')

    try {
      const text = await file.text()
      const lines = text.split('\n').filter(line => line.trim())
      
      if (lines.length < 2) {
        setStatusMessage('CSV file is empty or has no data rows')
        setImporting(false)
        return
      }

      // Parse header
      const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''))
      const nameIdx = header.findIndex(h => h.includes('name') || h === 'homeowner_name')
      const addressIdx = header.findIndex(h => h.includes('address'))
      const phoneIdx = header.findIndex(h => h.includes('phone'))
      const emailIdx = header.findIndex(h => h.includes('email'))
      const latIdx = header.findIndex(h => h === 'lat' || h === 'latitude')
      const lngIdx = header.findIndex(h => h === 'lng' || h === 'longitude')
      const dispositionIdx = header.findIndex(h => h.includes('disposition'))
      const notesIdx = header.findIndex(h => h.includes('notes'))

      const leadsToImport = []
      
      for (let i = 1; i < lines.length; i++) {
        // Simple CSV parsing (handles quoted fields)
        const values: string[] = []
        let current = ''
        let inQuotes = false
        
        for (const char of lines[i]) {
          if (char === '"') {
            inQuotes = !inQuotes
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim())
            current = ''
          } else {
            current += char
          }
        }
        values.push(current.trim())

        const getValue = (idx: number) => idx >= 0 && idx < values.length ? values[idx].replace(/^"|"$/g, '') : ''
        
        const lat = latIdx >= 0 ? parseFloat(getValue(latIdx)) : null
        const lng = lngIdx >= 0 ? parseFloat(getValue(lngIdx)) : null
        
        // Skip rows without lat/lng - they can't be placed on map
        if (!lat || !lng || isNaN(lat) || isNaN(lng)) continue

        leadsToImport.push({
          homeowner_name: getValue(nameIdx),
          address_text: getValue(addressIdx),
          phone: getValue(phoneIdx),
          email: getValue(emailIdx),
          lat,
          lng,
          canvass_disposition: getValue(dispositionIdx) || '',
          canvass_notes: getValue(notesIdx),
        })
      }

      if (leadsToImport.length === 0) {
        setStatusMessage('No valid leads found (need lat/lng coordinates)')
        setImporting(false)
        return
      }

      // Send to API
      const res = await fetch('/api/canvass/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: leadsToImport }),
      })

      if (!res.ok) {
        const err = await res.json()
        setStatusMessage(err.error || 'Import failed')
      } else {
        const result = await res.json()
        setStatusMessage(`Imported ${result.count} leads`)
        await loadData()
      }
    } catch (err) {
      setStatusMessage('Failed to parse CSV file')
    } finally {
      setImporting(false)
      setShowImportExport(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setTimeout(() => setStatusMessage(null), 3000)
    }
  }

  const mapTypeOptions: { id: MapType; label: string; icon: string }[] = [
    { id: 'roadmap', label: 'Map', icon: '🗺️' },
    { id: 'satellite', label: 'Satellite', icon: '🛰️' },
    { id: 'hybrid', label: 'Hybrid', icon: '🌍' },
    { id: 'terrain', label: 'Terrain', icon: '⛰️' },
  ]

  // Initialize address search autocomplete
  const initializeSearchAutocomplete = () => {
    if (!searchInputRef.current || !window.google?.maps?.places) {
      return
    }

    if (searchAutocompleteRef.current) return // Already initialized

    try {
      const autocomplete = new (google.maps as any).places.Autocomplete(searchInputRef.current, {
        types: ['address'],
        componentRestrictions: { country: 'us' },
        fields: ['formatted_address', 'geometry', 'address_components'],
      })

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        
        if (place.geometry?.location) {
          const lat = place.geometry.location.lat()
          const lng = place.geometry.location.lng()
          
          // Pan and zoom to the selected location
          if (mapRef.current) {
            mapRef.current.panTo({ lat, lng })
            mapRef.current.setZoom(19)
          }
          
          setSearchAddress(place.formatted_address || '')
          setShowAddressSearch(false)
        }
      })

      searchAutocompleteRef.current = autocomplete
    } catch (error) {
      console.error('Error initializing search autocomplete:', error)
    }
  }

  // Initialize autocomplete when search opens
  useEffect(() => {
    if (showAddressSearch && mapStatus === 'loaded') {
      // Small delay to ensure input is rendered
      setTimeout(() => {
        initializeSearchAutocomplete()
        searchInputRef.current?.focus()
      }, 100)
    }
    
    // Cleanup when closing
    if (!showAddressSearch && searchAutocompleteRef.current) {
      (google.maps as any).event.clearInstanceListeners(searchAutocompleteRef.current)
      searchAutocompleteRef.current = null
    }
  }, [showAddressSearch, mapStatus])

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden touch-manipulation">
      {/* Mobile-optimized header - hidden on small screens when map is active */}
      <div className="hidden lg:block">
        <Nav />
      </div>
      
      {/* Mobile header */}
      <div className="lg:hidden bg-indigo-600 text-white px-4 py-3 flex items-center justify-between safe-area-inset-top">
        <div className="flex items-center gap-3">
          <span className="font-bold text-lg">Canvass</span>
          <span className={`inline-flex items-center gap-1.5 text-xs ${isOnline ? 'text-green-300' : 'text-amber-300'}`}>
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400' : 'bg-amber-400'}`} />
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <button
              onClick={syncPendingPins}
              disabled={syncing || !isOnline}
              className="px-3 py-1.5 bg-white/20 rounded-full text-xs font-medium disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : `Sync ${pendingCount}`}
            </button>
          )}
          <span className="text-xs text-indigo-200">{leads.length} pins</span>
        </div>
      </div>
      
      {/* Desktop status bar */}
      <div className="hidden lg:flex bg-white border-b px-4 py-2 items-center justify-between text-sm">
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 ${isOnline ? 'text-green-600' : 'text-amber-600'}`}>
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-amber-500'}`} />
            {isOnline ? 'Online' : 'Offline'}
          </span>
          {pendingCount > 0 && (
            <span className="text-amber-600">
              {pendingCount} pin{pendingCount > 1 ? 's' : ''} pending
            </span>
          )}
          <span className="text-gray-400">|</span>
          <span className="text-gray-600">{leads.length} leads</span>
        </div>
        <div className="flex items-center gap-3">
          {pendingCount > 0 && isOnline && (
            <button
              onClick={syncPendingPins}
              disabled={syncing}
              className="text-indigo-600 font-medium disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : 'Sync now'}
            </button>
          )}
          {/* Import/Export - Admin only */}
          {currentUserRole === 'admin' && (
            <>
              <div className="relative">
                <button
                  onClick={() => setShowImportExport(!showImportExport)}
                  className="flex items-center gap-1 text-gray-600 hover:text-gray-900"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span>Import/Export</span>
                </button>
                {showImportExport && (
                  <div className="absolute right-0 top-full mt-2 bg-white rounded-lg shadow-xl border z-50 min-w-[160px]">
                    <button
                      onClick={handleExportCSV}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Export CSV
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={importing}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      {importing ? 'Importing...' : 'Import CSV'}
                    </button>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleImportCSV}
                className="hidden"
              />
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Map container - always visible, takes remaining space */}
        <div className="flex-1 relative">
          {mapKey ? (
            <>
              <div ref={mapContainerRef} className="absolute inset-0" />
              
              {/* Map status overlay */}
              {mapStatus !== 'loaded' && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-100/80 z-10">
                  {mapStatus === 'loading' && (
                    <div className="text-gray-600">Loading map...</div>
                  )}
                  {mapStatus === 'error' && (
                    <div className="text-center p-4">
                      <p className="text-gray-600 mb-2">Map failed to load</p>
                      <button
                        onClick={() => {
                          setMapStatus('idle')
                          initializeMap()
                        }}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Map controls */}
              {mapStatus === 'loaded' && (
                <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
                  {/* Map type selector */}
                  <div className="relative">
                    <button
                      onClick={() => setShowMapTypeMenu(!showMapTypeMenu)}
                      className="w-12 h-12 bg-white rounded-lg shadow-lg flex items-center justify-center text-gray-700 active:bg-gray-100"
                      title="Map type"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                    </button>
                    {showMapTypeMenu && (
                      <div className="absolute top-full right-0 mt-2 bg-white rounded-lg shadow-xl overflow-hidden min-w-[140px] z-50">
                        {mapTypeOptions.map((opt) => (
                          <button
                            key={opt.id}
                            onClick={() => {
                              setMapType(opt.id)
                              setShowMapTypeMenu(false)
                            }}
                            className={`w-full px-4 py-3 text-left text-sm flex items-center gap-2 ${
                              mapType === opt.id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-900 hover:bg-gray-50'
                            }`}
                          >
                            <span>{opt.icon}</span>
                            <span>{opt.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Bottom controls */}
              {mapStatus === 'loaded' && (
                <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-10">
                  <button
                    onClick={centerOnUser}
                    className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-700 active:bg-gray-100"
                    title="Center on my location"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Legend */}
              {mapStatus === 'loaded' && (
                <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur rounded-lg shadow-lg p-3 z-10">
                  <div className="text-xs font-medium text-gray-500 mb-2">Dispositions</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {dispositionOptions.map((opt) => (
                      <div key={opt.id} className="flex items-center gap-2 text-xs">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: opt.color }}
                        />
                        <span className="text-gray-600">{opt.label}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 text-xs">
                      <div className="w-3 h-3 rounded-full bg-purple-500" />
                      <span className="text-gray-600">New</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <div className="text-center p-4">
                <p className="text-gray-600 mb-3">Maps API key required</p>
                {allowManualKey && (
                  <button
                    onClick={() => {
                      const nextKey = window.prompt('Paste Google Maps API key')
                      if (nextKey) {
                        window.localStorage.setItem('arx_maps_key', nextKey)
                        setMapKey(nextKey)
                      }
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg"
                  >
                    Enter API key
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Form panel - Desktop sidebar (always beside map) */}
        {showForm && hasPin && (
          <>
            {/* Desktop sidebar - fixed width, beside map */}
            <div className="hidden lg:flex lg:flex-col lg:w-96 lg:border-l lg:bg-white lg:h-full">
              <div className="flex-1 overflow-y-auto">
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-gray-900 text-lg">
                      {formState.lead_id ? 'Edit Lead' : 'New Lead'}
                    </h2>
                    <button
                      onClick={() => {
                        setShowForm(false)
                        setFormState(defaultForm)
                      }}
                      className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* DISPOSITION FIRST - at the top */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Disposition</label>
                    <div className="grid grid-cols-2 gap-2">
                      {dispositionOptions.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setFormState((prev) => ({ ...prev, canvass_disposition: opt.id as CanvassDisposition }))}
                          className={`flex items-center gap-2 px-3 py-3 rounded-lg text-sm font-medium border-2 transition-all ${
                            formState.canvass_disposition === opt.id
                              ? 'border-current shadow-sm'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                          style={{
                            borderColor: formState.canvass_disposition === opt.id ? opt.color : undefined,
                            backgroundColor: formState.canvass_disposition === opt.id ? `${opt.color}15` : undefined,
                          }}
                        >
                          <div 
                            className="w-4 h-4 rounded-full flex-shrink-0" 
                            style={{ backgroundColor: opt.color }}
                          />
                          <span className="text-gray-700">{opt.label}</span>
                        </button>
                      ))}
                    </div>
                    {formState.canvass_disposition && (
                      <div className="mt-2 text-xs text-gray-500">
                        Category: {getDispositionCategory(formState.canvass_disposition)}
                      </div>
                    )}
                  </div>

                  {/* Contact info - after disposition */}
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Homeowner name"
                      className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base"
                      value={formState.homeowner_name}
                      onChange={(e) => setFormState((prev) => ({ ...prev, homeowner_name: e.target.value }))}
                    />
                    <input
                      type="text"
                      placeholder="Address"
                      className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base"
                      value={formState.address_text}
                      onChange={(e) => setFormState((prev) => ({ ...prev, address_text: e.target.value }))}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="tel"
                        placeholder="Phone"
                        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base"
                        value={formState.phone}
                        onChange={(e) => setFormState((prev) => ({ ...prev, phone: e.target.value }))}
                      />
                      <input
                        type="email"
                        placeholder="Email"
                        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base"
                        value={formState.email}
                        onChange={(e) => setFormState((prev) => ({ ...prev, email: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                    <textarea
                      placeholder="Add notes about this lead..."
                      rows={2}
                      className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base resize-none"
                      value={formState.canvass_notes}
                      onChange={(e) => setFormState((prev) => ({ ...prev, canvass_notes: e.target.value }))}
                    />
                  </div>

                  {/* Schedule inspection */}
                  <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                        checked={formState.schedule_inspection}
                        onChange={(e) => setFormState((prev) => ({ ...prev, schedule_inspection: e.target.checked }))}
                      />
                      <span className="font-medium text-gray-900">Schedule Inspection</span>
                    </label>
                    
                    {formState.schedule_inspection && (
                      <>
                        <p className="text-xs text-gray-500">
                          This will create an Opportunity assigned to the selected closer.
                        </p>
                        <select
                          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base bg-white"
                          value={formState.closer_user_id}
                          onChange={(e) => setFormState((prev) => ({ ...prev, closer_user_id: e.target.value }))}
                        >
                          <option value="">Select closer / sales rep</option>
                          {closers.map((closer) => (
                            <option key={closer.id} value={closer.id}>
                              {closer.full_name || 'Unknown'} ({closer.role})
                            </option>
                          ))}
                        </select>
                        <input
                          type="datetime-local"
                          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base"
                          value={formState.inspection_scheduled_for}
                          onChange={(e) => setFormState((prev) => ({ ...prev, inspection_scheduled_for: e.target.value }))}
                        />
                      </>
                    )}
                  </div>

                  {statusMessage && (
                    <div className={`text-sm py-2 px-3 rounded-lg ${
                      statusMessage.includes('failed') || statusMessage.includes('Select') 
                        ? 'bg-red-50 text-red-700' 
                        : 'bg-green-50 text-green-700'
                    }`}>
                      {statusMessage}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSave}
                    className="w-full py-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 text-lg"
                  >
                    {formState.lead_id ? 'Update' : 'Save'}
                    {!isOnline && ' (Offline)'}
                  </button>
                </div>
              </div>
            </div>

            {/* Mobile slide-up sheet - full screen overlay */}
            <div className="lg:hidden fixed inset-0 z-40">
              {/* Backdrop */}
              <div 
                className="absolute inset-0 bg-black/30"
                onClick={() => {
                  setShowForm(false)
                  setFormState(defaultForm)
                }}
              />
              
              {/* Drawer */}
              <div className="absolute inset-x-0 bottom-0 bg-white rounded-t-3xl shadow-2xl max-h-[90vh] flex flex-col animate-slide-up safe-area-inset-bottom">
                {/* Drag handle */}
                <div className="flex justify-center py-3 flex-shrink-0">
                  <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
                </div>
                
                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-24">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between sticky top-0 bg-white py-2 -mx-4 px-4">
                      <h2 className="font-semibold text-gray-900 text-lg">
                        {formState.lead_id ? 'Edit Lead' : 'New Lead'}
                      </h2>
                      <button
                        onClick={() => {
                          setShowForm(false)
                          setFormState(defaultForm)
                        }}
                        className="p-2 text-gray-400 hover:text-gray-600 rounded-lg active:bg-gray-100"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* DISPOSITION FIRST - at the top */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Disposition</label>
                      <div className="grid grid-cols-2 gap-2">
                        {dispositionOptions.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setFormState((prev) => ({ ...prev, canvass_disposition: opt.id as CanvassDisposition }))}
                            className={`flex items-center gap-2 px-3 py-3 rounded-lg text-sm font-medium border-2 transition-all ${
                              formState.canvass_disposition === opt.id
                                ? 'border-current shadow-sm'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                            style={{
                              borderColor: formState.canvass_disposition === opt.id ? opt.color : undefined,
                              backgroundColor: formState.canvass_disposition === opt.id ? `${opt.color}15` : undefined,
                            }}
                          >
                            <div 
                              className="w-4 h-4 rounded-full flex-shrink-0" 
                              style={{ backgroundColor: opt.color }}
                            />
                            <span className="text-gray-700">{opt.label}</span>
                          </button>
                        ))}
                      </div>
                      {formState.canvass_disposition && (
                        <div className="mt-2 text-xs text-gray-500">
                          Category: {getDispositionCategory(formState.canvass_disposition)}
                        </div>
                      )}
                    </div>

                    {/* Contact info - after disposition */}
                    <div className="space-y-3">
                      <input
                        type="text"
                        placeholder="Homeowner name"
                        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base"
                        value={formState.homeowner_name}
                        onChange={(e) => setFormState((prev) => ({ ...prev, homeowner_name: e.target.value }))}
                      />
                      <input
                        type="text"
                        placeholder="Address"
                        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base"
                        value={formState.address_text}
                        onChange={(e) => setFormState((prev) => ({ ...prev, address_text: e.target.value }))}
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          type="tel"
                          placeholder="Phone"
                          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base"
                          value={formState.phone}
                          onChange={(e) => setFormState((prev) => ({ ...prev, phone: e.target.value }))}
                        />
                        <input
                          type="email"
                          placeholder="Email"
                          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base"
                          value={formState.email}
                          onChange={(e) => setFormState((prev) => ({ ...prev, email: e.target.value }))}
                        />
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                      <textarea
                        placeholder="Add notes about this lead..."
                        rows={2}
                        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base resize-none"
                        value={formState.canvass_notes}
                        onChange={(e) => setFormState((prev) => ({ ...prev, canvass_notes: e.target.value }))}
                      />
                    </div>

                    {/* Schedule inspection */}
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                          checked={formState.schedule_inspection}
                          onChange={(e) => setFormState((prev) => ({ ...prev, schedule_inspection: e.target.checked }))}
                        />
                        <span className="font-medium text-gray-900">Schedule Inspection</span>
                      </label>
                      
                      {formState.schedule_inspection && (
                        <>
                          <p className="text-xs text-gray-500">
                            This will create an Opportunity assigned to the selected closer.
                          </p>
                          <select
                            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base bg-white"
                            value={formState.closer_user_id}
                            onChange={(e) => setFormState((prev) => ({ ...prev, closer_user_id: e.target.value }))}
                          >
                            <option value="">Select closer / sales rep</option>
                            {closers.map((closer) => (
                              <option key={closer.id} value={closer.id}>
                                {closer.full_name || 'Unknown'} ({closer.role})
                              </option>
                            ))}
                          </select>
                          <input
                            type="datetime-local"
                            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base"
                            value={formState.inspection_scheduled_for}
                            onChange={(e) => setFormState((prev) => ({ ...prev, inspection_scheduled_for: e.target.value }))}
                          />
                        </>
                      )}
                    </div>

                    {statusMessage && (
                      <div className={`text-sm py-2 px-3 rounded-lg ${
                        statusMessage.includes('failed') || statusMessage.includes('Select') 
                          ? 'bg-red-50 text-red-700' 
                          : 'bg-green-50 text-green-700'
                      }`}>
                        {statusMessage}
                      </div>
                    )}
                  </div>
                </div>

                {/* Fixed save button at bottom */}
                <div className="flex-shrink-0 p-4 bg-white border-t">
                  <button
                    type="button"
                    onClick={handleSave}
                    className="w-full py-4 bg-indigo-600 text-white font-semibold rounded-xl active:bg-indigo-700 text-lg touch-manipulation"
                  >
                    {formState.lead_id ? 'Update' : 'Save'}
                    {!isOnline && ' (Offline)'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Tap hint */}
        {!showForm && mapStatus === 'loaded' && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 pointer-events-none safe-area-inset-bottom">
            <div className="bg-black/80 text-white px-6 py-3 rounded-full text-sm font-medium shadow-lg backdrop-blur-sm">
              Tap anywhere to drop a pin
            </div>
          </div>
        )}

        {/* Mobile bottom nav */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t safe-area-inset-bottom z-30">
          <div className="flex items-center justify-around py-2">
            <a href="/dashboard" className="flex flex-col items-center gap-1 px-4 py-2 text-gray-500">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span className="text-xs">Home</span>
            </a>
            <a href="/canvass/map" className="flex flex-col items-center gap-1 px-4 py-2 text-indigo-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-xs font-medium">Canvass</span>
            </a>
            <a href="/calendar" className="flex flex-col items-center gap-1 px-4 py-2 text-gray-500">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-xs">Calendar</span>
            </a>
            <a href="/reports" className="flex flex-col items-center gap-1 px-4 py-2 text-gray-500">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-xs">Reports</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
