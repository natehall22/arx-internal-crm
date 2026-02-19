'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Nav from '@/components/Nav'
import type { CanvassDisposition, Lead } from '@/lib/types/database'

type UserOption = { id: string; full_name: string | null; role: string; has_calendar?: boolean }

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
const DB_VERSION = 2
const STORE_NAME = 'pending_pins'
const LEADS_STORE = 'cached_leads'
const CACHE_META_STORE = 'cache_meta'

// Cache expiry time - 1 hour
const CACHE_EXPIRY_MS = 60 * 60 * 1000

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
    markerClusterer?: any
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
      if (!db.objectStoreNames.contains(LEADS_STORE)) {
        db.createObjectStore(LEADS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(CACHE_META_STORE)) {
        db.createObjectStore(CACHE_META_STORE, { keyPath: 'key' })
      }
    }
  })
}

// Cache leads locally
const cacheLeads = async (leads: Lead[]): Promise<void> => {
  try {
    const db = await openDB()
    const tx = db.transaction([LEADS_STORE, CACHE_META_STORE], 'readwrite')
    const leadsStore = tx.objectStore(LEADS_STORE)
    const metaStore = tx.objectStore(CACHE_META_STORE)
    
    // Clear existing leads and add new ones
    await new Promise<void>((resolve, reject) => {
      const clearReq = leadsStore.clear()
      clearReq.onerror = () => reject(clearReq.error)
      clearReq.onsuccess = () => resolve()
    })
    
    for (const lead of leads) {
      leadsStore.put(lead)
    }
    
    // Update cache timestamp
    metaStore.put({ key: 'leads_cached_at', value: Date.now() })
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.error('Failed to cache leads:', e)
  }
}

// Get cached leads
const getCachedLeads = async (): Promise<{ leads: Lead[]; cachedAt: number | null }> => {
  try {
    const db = await openDB()
    const tx = db.transaction([LEADS_STORE, CACHE_META_STORE], 'readonly')
    const leadsStore = tx.objectStore(LEADS_STORE)
    const metaStore = tx.objectStore(CACHE_META_STORE)
    
    const leads = await new Promise<Lead[]>((resolve, reject) => {
      const req = leadsStore.getAll()
      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve(req.result || [])
    })
    
    const meta = await new Promise<{ key: string; value: number } | undefined>((resolve, reject) => {
      const req = metaStore.get('leads_cached_at')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve(req.result)
    })
    
    return { leads, cachedAt: meta?.value || null }
  } catch (e) {
    return { leads: [], cachedAt: null }
  }
}

// Clear all cached data
const clearAllCache = async (): Promise<void> => {
  try {
    const db = await openDB()
    const tx = db.transaction([LEADS_STORE, CACHE_META_STORE, STORE_NAME], 'readwrite')
    tx.objectStore(LEADS_STORE).clear()
    tx.objectStore(CACHE_META_STORE).clear()
    tx.objectStore(STORE_NAME).clear()
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.error('Failed to clear cache:', e)
    throw e
  }
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

type TeamOption = { id: string; name: string }

export default function CanvassMapPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [closers, setClosers] = useState<UserOption[]>([])
  const [teams, setTeams] = useState<TeamOption[]>([])
  const [currentUserRole, setCurrentUserRole] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [dispositionOptions, setDispositionOptions] = useState(defaultDispositionOptions)
  const [inspectionDuration, setInspectionDuration] = useState<number>(60)

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
  const [mapHeading, setMapHeading] = useState(0)
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
  const [checkingAvailability, setCheckingAvailability] = useState(false)
  const [availabilityStatus, setAvailabilityStatus] = useState<{ available: boolean; hasCalendar: boolean; message?: string } | null>(null)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [timeSlots, setTimeSlots] = useState<{ time: string; available: boolean; display: string }[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [closerTimezone, setCloserTimezone] = useState<string>('America/New_York')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchAutocompleteRef = useRef<any>(null)

  const mapRef = useRef<any>(null)
  const markersRef = useRef<Record<string, any>>({})
  const markerClusterRef = useRef<any>(null)
  const userMarkerRef = useRef<any>(null)
  const infoWindowRef = useRef<any>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const newPinMarkerRef = useRef<any>(null)
  
  // Cache state
  const [cacheInfo, setCacheInfo] = useState<{ cachedAt: number | null; count: number }>({ cachedAt: null, count: 0 })
  const [showCacheMenu, setShowCacheMenu] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)

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

  // Listen for service worker sync events
  useEffect(() => {
    const handleSwSync = () => {
      if (isOnline && pendingCount > 0) {
        syncPendingPins()
      }
    }
    window.addEventListener('sw-sync-pins', handleSwSync)
    return () => window.removeEventListener('sw-sync-pins', handleSwSync)
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

  const loadData = async (forceRefresh = false) => {
    // Try to load from cache first for instant display
    if (!forceRefresh) {
      const cached = await getCachedLeads()
      if (cached.leads.length > 0 && cached.cachedAt) {
        const cacheAge = Date.now() - cached.cachedAt
        console.log('Loading from cache:', cached.leads.length, 'leads, age:', Math.round(cacheAge / 1000), 's')
        setLeads(cached.leads)
        setCacheInfo({ cachedAt: cached.cachedAt, count: cached.leads.length })
        setLoading(false)
        
        // If cache is still fresh and we're offline, don't fetch
        if (!navigator.onLine || cacheAge < CACHE_EXPIRY_MS) {
          return
        }
      }
    }
    
    if (!navigator.onLine) {
      setLoading(false)
      return
    }
    
    try {
      const response = await fetch('/api/canvass/data')
      if (!response.ok) {
        console.error('Failed to load canvass data')
        setLoading(false)
        return
      }
      
      const data = await response.json()
      
      console.log('Canvass data loaded from server:', data.leads?.length, 'leads', 'inspectionDuration:', data.inspectionDuration)
      
      setCurrentUserRole(data.currentUserRole || '')
      setLeads(data.leads || [])
      setClosers((data.users || []) as UserOption[])
      setTeams((data.teams || []) as TeamOption[])
      setInspectionDuration(data.inspectionDuration || 60)
      
      // Cache leads for offline/fast loading
      if (data.leads?.length > 0) {
        await cacheLeads(data.leads)
        setCacheInfo({ cachedAt: Date.now(), count: data.leads.length })
      }
      
      // Load org disposition settings
      if (data.orgSettings?.canvass_dispositions) {
        const activeDispositions = data.orgSettings.canvass_dispositions.filter((d: any) => d.active !== false)
        if (activeDispositions.length > 0) {
          setDispositionOptions(activeDispositions)
        }
      }
    } catch (err) {
      console.error('Error loading canvass data:', err)
    }
    
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

    // Map ID enables vector maps with rotation/tilt gestures
    // Create one at: https://console.cloud.google.com/google/maps-apis/studio/maps
    const googleMapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || 'f9f9a6138b2fd7e46c477374'
    
    mapRef.current = new window.google.maps.Map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 18,
      mapTypeId: mapType,
      tilt: 0,
      heading: 0,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
      zoomControl: true,
      rotateControl: false, // We'll add our own compass button
      gestureHandling: 'greedy',
      // Enable rotation and tilt gestures (requires vector map via mapId)
      ...(googleMapId && {
        mapId: googleMapId,
        headingInteractionEnabled: true,
        tiltInteractionEnabled: true,
      }),
      // Performance optimizations
      maxZoom: 20,
      minZoom: 10,
      clickableIcons: false, // Disable POI clicks for faster rendering
    } as google.maps.MapOptions)
    setMapStatus('loaded')
    infoWindowRef.current = new window.google.maps.InfoWindow()

    // Listen for heading changes (rotation)
    mapRef.current.addListener('heading_changed', () => {
      const heading = mapRef.current?.getHeading() || 0
      setMapHeading(heading)
    })

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
      if (window.google && window.google.maps) {
        // Also load MarkerClusterer if not already loaded
        loadMarkerClusterer().then(resolve).catch(resolve) // Don't fail if clusterer fails
        return
      }
      const existing = document.querySelector('script[src*="maps.googleapis.com"]')
      if (existing) {
        if (window.google && window.google.maps) {
          loadMarkerClusterer().then(resolve).catch(resolve)
        } else {
          existing.addEventListener('load', () => {
            loadMarkerClusterer().then(resolve).catch(resolve)
          })
        }
        return
      }
      
      // Timeout for slow connections (15 seconds)
      const timeout = setTimeout(() => {
        reject(new Error('Map loading timed out - check your connection'))
      }, 15000)
      
      const script = document.createElement('script')
      // Include libraries for compatibility with roof measure tool
      script.src = `https://maps.googleapis.com/maps/api/js?key=${mapKey}&libraries=drawing,geometry,places`
      script.async = true
      script.defer = true
      script.onload = () => {
        clearTimeout(timeout)
        // Load MarkerClusterer after Google Maps
        loadMarkerClusterer().then(resolve).catch(resolve)
      }
      script.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('Failed to load map'))
      }
      document.head.appendChild(script)
    })
  }
  
  const loadMarkerClusterer = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (window.markerClusterer) {
        resolve()
        return
      }
      
      const existing = document.querySelector('script[src*="markerclusterer"]')
      if (existing) {
        if (window.markerClusterer) {
          resolve()
        } else {
          existing.addEventListener('load', () => resolve())
        }
        return
      }
      
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/@googlemaps/markerclusterer/dist/index.min.js'
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => {
        console.warn('MarkerClusterer failed to load - clustering disabled')
        resolve() // Don't fail, just disable clustering
      }
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
    
    // Clear existing cluster
    if (markerClusterRef.current) {
      markerClusterRef.current.clearMarkers()
    }

    console.log('Rendering', leads.length, 'markers')

    const markers: any[] = []
    
    leads.forEach((lead) => {
      if (lead.lat == null || lead.lng == null) {
        return
      }
      
      const color = getDispositionColor(lead.canvass_disposition)
      
      // Create round bubble marker
      const marker = new window.google.maps.Marker({
        position: { lat: Number(lead.lat), lng: Number(lead.lng) },
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 10,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: 1,
        },
        title: lead.homeowner_name || lead.address_text || 'Lead',
        optimized: true, // Enable marker optimization
      })

      marker.addListener('click', () => {
        openInfoWindow(marker, lead)
      })

      markersRef.current[lead.id] = marker
      markers.push(marker)
    })
    
    // Use MarkerClusterer for performance with many markers
    if (window.markerClusterer && markers.length > 50) {
      markerClusterRef.current = new window.markerClusterer.MarkerClusterer({
        map: mapRef.current,
        markers,
        renderer: {
          render: ({ count, position }: { count: number; position: any }) => {
            return new window.google.maps.Marker({
              position,
              icon: {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: Math.min(20 + Math.log2(count) * 3, 35),
                strokeColor: '#ffffff',
                strokeWeight: 2,
                fillColor: '#4f46e5',
                fillOpacity: 0.9,
              },
              label: {
                text: String(count),
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: 'bold',
              },
              zIndex: 1000000 + count,
            })
          },
        },
        algorithmOptions: {
          maxZoom: 17, // Stop clustering at zoom 17+
        },
      })
    } else {
      // For fewer markers, add directly to map (no clustering)
      markers.forEach(marker => marker.setMap(mapRef.current))
    }
  }

  const openInfoWindow = (marker: any, lead: Lead & { owner?: { id: string; full_name: string } }) => {
    if (!infoWindowRef.current) return

    const color = getDispositionColor(lead.canvass_disposition)
    const label = getDispositionLabel(lead.canvass_disposition)
    const category = getDispositionCategory(lead.canvass_disposition)
    const ownerName = (lead as any).owner?.full_name || 'Unknown'
    const createdDate = lead.created_at ? new Date(lead.created_at).toLocaleDateString() : ''
    
    // Rich info window with all customer details and rep info
    const content = `
      <div style="min-width:260px;max-width:320px;font-family:system-ui,-apple-system,sans-serif">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:12px;height:12px;border-radius:50%;background:${color}"></div>
            <span style="font-size:12px;font-weight:600;color:${color}">${label}</span>
          </div>
          ${category ? `<span style="font-size:11px;color:#6b7280;background:#f3f4f6;padding:2px 8px;border-radius:4px">${category}</span>` : ''}
        </div>
        <div style="font-weight:600;font-size:16px;margin-bottom:4px">${lead.homeowner_name || 'Unknown'}</div>
        <div style="font-size:13px;color:#374151;margin-bottom:8px">${lead.address_text || 'No address'}</div>
        ${lead.phone ? `<div style="font-size:13px;margin-bottom:2px"><a href="tel:${lead.phone}" style="color:#3b82f6;text-decoration:none">${lead.phone}</a></div>` : ''}
        ${lead.email ? `<div style="font-size:13px;margin-bottom:8px"><a href="mailto:${lead.email}" style="color:#3b82f6;text-decoration:none">${lead.email}</a></div>` : ''}
        ${lead.canvass_notes ? `
          <div style="margin-top:8px">
            <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:4px">NOTES</div>
            <div style="font-size:12px;color:#374151;background:#f3f4f6;padding:8px;border-radius:6px;white-space:pre-wrap">${lead.canvass_notes}</div>
          </div>
        ` : ''}
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;color:#6b7280">
          <span>Rep: <strong style="color:#374151">${ownerName}</strong></span>
          ${createdDate ? `<span>${createdDate}</span>` : ''}
        </div>
        <button 
          onclick="window.dispatchEvent(new CustomEvent('edit-lead', {detail: '${lead.id}'}))"
          style="margin-top:10px;width:100%;padding:10px;background:#4f46e5;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer"
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

  // Check closer availability via Google Calendar
  const checkAvailability = async (closerId: string, scheduledFor: string) => {
    if (!closerId || !scheduledFor || !isOnline) {
      setAvailabilityStatus(null)
      return
    }

    setCheckingAvailability(true)
    setAvailabilityStatus(null)

    try {
      const startTime = new Date(scheduledFor)
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000) // 1 hour duration

      const res = await fetch(`/api/calendar/sync?action=check&closer_user_id=${closerId}&start_time=${startTime.toISOString()}&end_time=${endTime.toISOString()}`)
      
      if (res.ok) {
        const data = await res.json()
        setAvailabilityStatus({
          available: data.available,
          hasCalendar: data.has_calendar,
          message: data.has_calendar 
            ? (data.available ? 'Time slot is available' : 'Time slot conflicts with existing calendar event')
            : 'Calendar not connected - availability not checked'
        })
      }
    } catch (error) {
      console.error('Availability check failed:', error)
    } finally {
      setCheckingAvailability(false)
    }
  }

  // Check availability when closer or time changes
  useEffect(() => {
    if (formState.schedule_inspection && formState.closer_user_id && formState.inspection_scheduled_for) {
      const debounce = setTimeout(() => {
        checkAvailability(formState.closer_user_id, formState.inspection_scheduled_for)
      }, 500)
      return () => clearTimeout(debounce)
    } else {
      setAvailabilityStatus(null)
    }
  }, [formState.closer_user_id, formState.inspection_scheduled_for, formState.schedule_inspection])

  // Load available time slots when date or closer changes
  const loadTimeSlots = async (closerOrTeamId: string, date: string, duration: number = 60) => {
    if (!closerOrTeamId || !date || !isOnline) {
      setTimeSlots([])
      return
    }

    setLoadingSlots(true)
    try {
      let res: Response
      
      // Check if this is a team selection (format: "team:uuid")
      if (closerOrTeamId.startsWith('team:')) {
        const teamId = closerOrTeamId.replace('team:', '')
        res = await fetch(`/api/canvass/team-availability?team_id=${teamId}&date=${date}&duration=${duration}`)
      } else {
        res = await fetch(`/api/canvass/availability?closer_id=${closerOrTeamId}&date=${date}&duration=${duration}`)
      }
      
      if (res.ok) {
        const data = await res.json()
        setTimeSlots(data.slots || [])
        setCloserTimezone(data.timezone || 'America/New_York')
      }
    } catch (error) {
      console.error('Failed to load time slots:', error)
      setTimeSlots([])
    } finally {
      setLoadingSlots(false)
    }
  }

  // Load slots when date or closer changes
  useEffect(() => {
    if (formState.schedule_inspection && formState.closer_user_id && selectedDate) {
      loadTimeSlots(formState.closer_user_id, selectedDate, inspectionDuration)
    } else {
      setTimeSlots([])
    }
  }, [formState.closer_user_id, selectedDate, formState.schedule_inspection, inspectionDuration])

  // Reset date selection when closer changes
  useEffect(() => {
    setSelectedDate('')
    setTimeSlots([])
    setFormState(prev => ({ ...prev, inspection_scheduled_for: '' }))
  }, [formState.closer_user_id])

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
    
    // When scheduling an inspection (converting to opportunity), require name, phone, and address
    if (formState.schedule_inspection) {
      if (!formState.homeowner_name?.trim()) {
        setStatusMessage('Homeowner name is required to schedule an inspection.')
        return
      }
      if (!formState.phone?.trim()) {
        setStatusMessage('Phone number is required to schedule an inspection.')
        return
      }
      if (!formState.address_text?.trim()) {
        setStatusMessage('Address is required to schedule an inspection.')
        return
      }
      if (!formState.inspection_scheduled_for) {
        setStatusMessage('Select inspection date/time.')
        return
      }
    }
    // Note: closer_user_id is optional - if not set, round-robin will assign one

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
    let message = 'Lead saved'
    if (data?.opportunity_id) {
      message = 'Lead saved + Opportunity created!'
    }
    if (data?.calendar_synced && data?.setter_calendar_synced) {
      message += ' Added to both calendars.'
    } else if (data?.calendar_synced) {
      message += ' Added to closer calendar.'
    } else if (data?.setter_calendar_synced) {
      message += ' Added to your calendar.'
    } else if (formState.schedule_inspection) {
      // Calendar sync failed - show why
      if (data?.calendar_error) {
        message += ` (Closer calendar: ${data.calendar_error})`
      }
      if (data?.setter_calendar_error) {
        message += ` (Your calendar: ${data.setter_calendar_error})`
      }
    }
    setStatusMessage(message)
    setFormState(defaultForm)
    setShowForm(false)
    setAvailabilityStatus(null)
    await loadData()
    setTimeout(() => setStatusMessage(null), 3000)
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
    if (!file) {
      console.log('No file selected')
      return
    }

    console.log('Starting CSV import for file:', file.name)
    setImporting(true)
    setStatusMessage('Reading CSV file...')
    setShowImportExport(false)

    try {
      const text = await file.text()
      const lines = text.split('\n').filter(line => line.trim())
      
      console.log('CSV lines found:', lines.length)
      
      if (lines.length < 2) {
        setStatusMessage('CSV file is empty or has no data rows')
        setImporting(false)
        return
      }

      // Parse header
      const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''))
      
      // Support multiple column name formats (standard and SalesRabbit-style exports)
      const firstNameIdx = header.findIndex(h => h === 'contacts_first_name' || h === 'first_name' || h === 'firstname')
      const lastNameIdx = header.findIndex(h => h === 'contacts_last_name' || h === 'last_name' || h === 'lastname')
      const nameIdx = header.findIndex(h => h === 'name' || h === 'homeowner_name' || h === 'contact_name')
      
      // Address - try full address first, then street address
      const fullAddressIdx = header.findIndex(h => h === 'lead_address' || h === 'full_address' || h === 'address')
      const streetIdx = header.findIndex(h => h === 'address_street1' || h === 'street' || h === 'street_address')
      const street2Idx = header.findIndex(h => h === 'address_street2' || h === 'street2' || h === 'apt')
      const cityIdx = header.findIndex(h => h === 'address_city' || h === 'city')
      const stateIdx = header.findIndex(h => h === 'address_state' || h === 'state')
      const zipIdx = header.findIndex(h => h === 'address_postal_code' || h === 'zip' || h === 'postal_code' || h === 'zipcode')
      
      const phoneIdx = header.findIndex(h => h === 'contacts_phone_primary' || h === 'phone_primary' || h.includes('phone'))
      const emailIdx = header.findIndex(h => h === 'contacts_email' || h.includes('email'))
      const latIdx = header.findIndex(h => h === 'latitude' || h === 'lat' || h === 'y' || h === 'address_latitude' || h.includes('latitude'))
      const lngIdx = header.findIndex(h => h === 'longitude' || h === 'lng' || h === 'long' || h === 'x' || h === 'lon' || h === 'address_longitude' || h.includes('longitude'))
      const dispositionIdx = header.findIndex(h => h === 'status' || h === 'status_name' || h === 'lead_status' || h.includes('disposition') || h.includes('result'))
      const notesIdx = header.findIndex(h => h === 'notes' || h === 'note' || h === 'comments')
      
      console.log('CSV Import - Found columns:', { 
        firstNameIdx, lastNameIdx, nameIdx, fullAddressIdx, streetIdx, cityIdx, 
        stateIdx, zipIdx, phoneIdx, emailIdx, latIdx, lngIdx, dispositionIdx, notesIdx,
        headerRow: header.join(', ')
      })

      const leadsToImport = []
      const leadsNeedingGeocode = []
      
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
        
        let lat = latIdx >= 0 ? parseFloat(getValue(latIdx)) : null
        let lng = lngIdx >= 0 ? parseFloat(getValue(lngIdx)) : null
        
        // Build name from first/last or use full name field
        let homeownerName = getValue(nameIdx)
        if (!homeownerName && (firstNameIdx >= 0 || lastNameIdx >= 0)) {
          const firstName = getValue(firstNameIdx)
          const lastName = getValue(lastNameIdx)
          homeownerName = [firstName, lastName].filter(Boolean).join(' ')
        }
        
        // Build address from components or use full address
        let addressText = getValue(fullAddressIdx)
        if (!addressText && streetIdx >= 0) {
          const parts = [
            getValue(streetIdx),
            getValue(street2Idx),
            getValue(cityIdx),
            getValue(stateIdx),
            getValue(zipIdx)
          ].filter(Boolean)
          addressText = parts.join(', ')
        }
        
        const leadData = {
          homeowner_name: homeownerName,
          address_text: addressText,
          phone: getValue(phoneIdx),
          email: getValue(emailIdx),
          lat,
          lng,
          canvass_disposition: getValue(dispositionIdx) || '',
          canvass_notes: getValue(notesIdx),
        }

        // If we have valid coordinates, add directly
        if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
          leadsToImport.push(leadData)
        } else if (leadData.address_text) {
          // Otherwise, queue for geocoding if we have an address
          leadsNeedingGeocode.push(leadData)
        }
      }

      // Debug: show first few rows' values
      if (lines.length > 1) {
        const debugValues: string[] = []
        let current = ''
        let inQuotes = false
        for (const char of lines[1]) {
          if (char === '"') inQuotes = !inQuotes
          else if (char === ',' && !inQuotes) { debugValues.push(current.trim()); current = '' }
          else current += char
        }
        debugValues.push(current.trim())
        console.log('First row debug values:', {
          latIdx,
          lngIdx,
          dispositionIdx,
          latValue: latIdx >= 0 ? debugValues[latIdx] : 'N/A',
          lngValue: lngIdx >= 0 ? debugValues[lngIdx] : 'N/A',
          dispositionValue: dispositionIdx >= 0 ? debugValues[dispositionIdx] : 'N/A',
          parsedLat: latIdx >= 0 ? parseFloat(debugValues[latIdx]) : null,
          parsedLng: lngIdx >= 0 ? parseFloat(debugValues[lngIdx]) : null,
        })
      }
      
      console.log('Parsed leads with coords:', leadsToImport.length, 'Needs geocoding:', leadsNeedingGeocode.length)
      
      // Geocode addresses that don't have coordinates
      if (leadsNeedingGeocode.length > 0 && mapKey) {
        setStatusMessage(`Geocoding ${leadsNeedingGeocode.length} addresses...`)
        
        for (const lead of leadsNeedingGeocode) {
          try {
            const response = await fetch(
              `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(lead.address_text)}&key=${mapKey}`
            )
            const data = await response.json()
            
            if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
              lead.lat = data.results[0].geometry.location.lat
              lead.lng = data.results[0].geometry.location.lng
              leadsToImport.push(lead)
            }
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100))
          } catch (e) {
            console.error('Geocoding error for:', lead.address_text, e)
          }
        }
      }

      if (leadsToImport.length === 0) {
        console.log('No valid leads to import')
        setStatusMessage('No valid leads found. Make sure CSV has address or lat/lng columns.')
        setImporting(false)
        return
      }
      
      console.log('Sending', leadsToImport.length, 'leads to API')
      setStatusMessage(`Importing ${leadsToImport.length} leads...`)

      // Send to API
      const res = await fetch('/api/canvass/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: leadsToImport }),
      })

      console.log('API response status:', res.status)
      
      if (!res.ok) {
        const err = await res.json()
        console.error('Import API error:', err)
        setStatusMessage(err.error || 'Import failed')
      } else {
        const result = await res.json()
        console.log('Import success:', result)
        setStatusMessage(`Successfully imported ${result.count} leads!`)
        await loadData()
      }
    } catch (err) {
      console.error('CSV import error:', err)
      setStatusMessage('Failed to parse CSV file: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setImporting(false)
      setShowImportExport(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      // Keep message visible longer
      setTimeout(() => setStatusMessage(null), 5000)
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
            // Temporarily switch to roadmap for faster initial load, then switch back
            const currentType = mapRef.current.getMapTypeId()
            const useRoadmapFirst = currentType === 'satellite' || currentType === 'hybrid'
            
            if (useRoadmapFirst) {
              mapRef.current.setMapTypeId('roadmap')
            }
            
            // Set center directly (faster than panTo for large distances)
            mapRef.current.setCenter({ lat, lng })
            mapRef.current.setZoom(17)
            
            // Switch back to satellite/hybrid after a short delay for tile loading
            if (useRoadmapFirst) {
              setTimeout(() => {
                if (mapRef.current) {
                  mapRef.current.setMapTypeId(currentType)
                }
              }, 500)
            }
            
            // Drop a temporary marker at the searched location
            // Remove any existing search marker first
            if ((window as any).__searchMarker) {
              (window as any).__searchMarker.setMap(null)
            }
            
            const searchMarker = new google.maps.Marker({
              position: { lat, lng },
              map: mapRef.current,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillColor: '#4F46E5',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 3,
              },
              title: place.formatted_address || 'Searched location',
            })
            
            // Store reference to remove later
            ;(window as any).__searchMarker = searchMarker
            
            // Remove the search marker after 10 seconds
            setTimeout(() => {
              if ((window as any).__searchMarker === searchMarker) {
                searchMarker.setMap(null)
                ;(window as any).__searchMarker = null
              }
            }, 10000)
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
          {/* Import/Export - Admin/Owner only */}
          {(currentUserRole === 'admin' || currentUserRole === 'owner') && (
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
                      className="w-full px-4 py-3 text-left text-sm text-gray-900 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Export CSV
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={importing}
                      className="w-full px-4 py-3 text-left text-sm text-gray-900 hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                    >
                      <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

              {/* Map controls - all on right side */}
              {mapStatus === 'loaded' && (
                <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
                  {/* Address search button */}
                  <button
                    onClick={() => setShowAddressSearch(!showAddressSearch)}
                    className="w-11 h-11 bg-white rounded-lg shadow-lg flex items-center justify-center text-gray-700 active:bg-gray-100"
                    title="Search address"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </button>
                  
                  {/* Map type selector */}
                  <div className="relative">
                    <button
                      onClick={() => setShowMapTypeMenu(!showMapTypeMenu)}
                      className="w-11 h-11 bg-white rounded-lg shadow-lg flex items-center justify-center text-gray-700 active:bg-gray-100"
                      title="Map type"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  
                  {/* Compass button - resets map to north */}
                  <button
                    onClick={() => {
                      if (mapRef.current) {
                        mapRef.current.setHeading(0)
                        mapRef.current.setTilt(0)
                      }
                    }}
                    className="w-11 h-11 bg-white rounded-lg shadow-lg flex items-center justify-center text-gray-700 active:bg-gray-100"
                    title="Reset to North"
                  >
                    <svg 
                      className="w-5 h-5 transition-transform duration-200" 
                      style={{ transform: `rotate(${-mapHeading}deg)` }}
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor"
                    >
                      <path d="M12 2L12 12" strokeWidth={2.5} strokeLinecap="round" stroke="#ef4444" />
                      <path d="M12 12L12 22" strokeWidth={2.5} strokeLinecap="round" stroke="currentColor" />
                      <text x="12" y="6" textAnchor="middle" fontSize="6" fill="#ef4444" fontWeight="bold">N</text>
                    </svg>
                  </button>
                  
                  {/* My Location button */}
                  <button
                    onClick={centerOnUser}
                    className="w-11 h-11 bg-indigo-600 rounded-lg shadow-lg flex items-center justify-center text-white active:bg-indigo-700"
                    title="My location"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2z" />
                    </svg>
                  </button>
                  
                  {/* Cache/Settings button */}
                  <div className="relative">
                    <button
                      onClick={() => setShowCacheMenu(!showCacheMenu)}
                      className="w-11 h-11 bg-white rounded-lg shadow-lg flex items-center justify-center text-gray-500 active:bg-gray-100"
                      title="Settings"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>
                    {showCacheMenu && (
                      <div className="absolute top-0 right-full mr-2 bg-white rounded-lg shadow-xl border min-w-[200px] z-50">
                        <div className="p-3 border-b">
                          <p className="text-xs font-medium text-gray-500">Cache</p>
                          <p className="text-sm text-gray-900">
                            {cacheInfo.count > 0 ? `${cacheInfo.count} leads` : 'Empty'}
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            await loadData(true)
                            setShowCacheMenu(false)
                            setStatusMessage('Refreshed')
                            setTimeout(() => setStatusMessage(null), 2000)
                          }}
                          className="w-full px-4 py-2.5 text-left text-sm text-gray-900 hover:bg-gray-50"
                        >
                          Refresh Data
                        </button>
                        <button
                          onClick={async () => {
                            setClearingCache(true)
                            try {
                              await clearAllCache()
                              setCacheInfo({ cachedAt: null, count: 0 })
                              setStatusMessage('Cache cleared')
                              setShowCacheMenu(false)
                            } catch (e) {
                              setStatusMessage('Failed')
                            } finally {
                              setClearingCache(false)
                              setTimeout(() => setStatusMessage(null), 2000)
                            }
                          }}
                          disabled={clearingCache}
                          className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                        >
                          Clear Cache
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Address search input overlay */}
              {showAddressSearch && mapStatus === 'loaded' && (
                <div className="absolute top-4 left-4 right-20 z-20">
                  <div className="relative">
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search address..."
                      value={searchAddress}
                      onChange={(e) => setSearchAddress(e.target.value)}
                      className="w-full px-4 py-3 pr-10 bg-white rounded-lg shadow-lg border-0 text-base focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={() => {
                        setShowAddressSearch(false)
                        setSearchAddress('')
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}


              {/* Legend - desktop only */}
              {mapStatus === 'loaded' && (
                <div className="hidden lg:block absolute bottom-4 left-4 bg-white/95 backdrop-blur rounded-lg shadow-lg p-3 z-10">
                  <div className="text-xs font-medium text-gray-500 mb-2">Dispositions</div>
                  <div className="grid grid-cols-3 gap-x-3 gap-y-1">
                    {dispositionOptions.map((opt) => (
                      <div key={opt.id} className="flex items-center gap-1.5 text-xs">
                        <div 
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0" 
                          style={{ backgroundColor: opt.color }}
                        />
                        <span className="text-gray-600 truncate">{opt.label}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full bg-purple-500 flex-shrink-0" />
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
                        onChange={(e) => {
                          setFormState((prev) => ({ ...prev, schedule_inspection: e.target.checked }))
                          if (!e.target.checked) {
                            setSelectedDate('')
                            setTimeSlots([])
                          }
                        }}
                      />
                      <span className="font-medium text-gray-900">Schedule Inspection</span>
                    </label>
                    
                    {formState.schedule_inspection && (
                      <>
                        <p className="text-xs text-gray-500">
                          This will create an Opportunity assigned to the selected closer.
                        </p>
                        
                        {/* Step 1: Select Closer */}
                        <select
                          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base bg-white"
                          value={formState.closer_user_id}
                          onChange={(e) => setFormState((prev) => ({ ...prev, closer_user_id: e.target.value }))}
                        >
                          <option value="">1. Select closer / sales rep</option>
                          {teams.length > 0 && (
                            <optgroup label="Team Round-Robin">
                              {teams.map((team) => (
                                <option key={`team-${team.id}`} value={`team:${team.id}`}>
                                  🔄 {team.name} (Auto-assign)
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="Individual Users">
                            {closers.map((closer) => (
                              <option key={closer.id} value={closer.id}>
                                {closer.full_name || 'Unknown'} ({closer.role}){!closer.has_calendar ? ' ⚠️' : ''}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        
                        {/* Calendar warning - only show for individual users, not teams */}
                        {formState.closer_user_id && !formState.closer_user_id.startsWith('team:') && (() => {
                          const selectedCloser = closers.find(c => c.id === formState.closer_user_id)
                          if (selectedCloser && !selectedCloser.has_calendar) {
                            return (
                              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                                <p className="text-amber-800 font-medium">⚠️ Calendar Not Connected</p>
                                <p className="text-amber-700 text-xs mt-1">
                                  {selectedCloser.full_name || 'This closer'} hasn&apos;t connected their Google Calendar. 
                                  The appointment will be created but won&apos;t sync to their calendar automatically.
                                  They will receive a notification.
                                </p>
                              </div>
                            )
                          }
                          return null
                        })()}
                        
                        {/* Team round-robin info */}
                        {formState.closer_user_id && formState.closer_user_id.startsWith('team:') && (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                            <p className="text-blue-800 font-medium">🔄 Round-Robin Assignment</p>
                            <p className="text-blue-700 text-xs mt-1">
                              The system will automatically assign the next available closer from this team based on their calendar availability and queue position.
                            </p>
                          </div>
                        )}

                        {/* Step 2: Select Date */}
                        {formState.closer_user_id && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">2. Select Date</label>
                            <input
                              type="date"
                              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base bg-white text-gray-900"
                              value={selectedDate}
                              onChange={(e) => setSelectedDate(e.target.value)}
                              min={new Date().toISOString().split('T')[0]}
                            />
                          </div>
                        )}

                        {/* Step 3: Select Time Slot */}
                        {formState.closer_user_id && selectedDate && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              3. Select Time
                              <span className="text-xs text-gray-500 ml-1">({closerTimezone.replace('America/', '').replace('_', ' ')})</span>
                            </label>
                            
                            {loadingSlots ? (
                              <div className="flex items-center justify-center py-8">
                                <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                                <span className="ml-2 text-gray-600">Loading available times...</span>
                              </div>
                            ) : timeSlots.length > 0 ? (
                              <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                                {timeSlots.map((slot) => (
                                  <button
                                    key={slot.time}
                                    type="button"
                                    disabled={!slot.available}
                                    onClick={() => {
                                      setFormState((prev) => ({ ...prev, inspection_scheduled_for: slot.time }))
                                    }}
                                    className={`px-3 py-2 text-sm font-medium rounded-lg border-2 transition-all ${
                                      formState.inspection_scheduled_for === slot.time
                                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                                        : slot.available
                                        ? 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-700'
                                        : 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed line-through'
                                    }`}
                                  >
                                    {slot.display}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center py-4 text-gray-500 text-sm">
                                No available time slots for this date
                              </div>
                            )}
                          </div>
                        )}

                        {/* Selected time confirmation */}
                        {formState.inspection_scheduled_for && (
                          <div className="flex items-center gap-2 text-sm p-3 rounded-lg bg-green-50 text-green-700">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>
                              Scheduled for {new Date(formState.inspection_scheduled_for).toLocaleDateString('en-US', { 
                                weekday: 'short', 
                                month: 'short', 
                                day: 'numeric',
                                timeZone: 'America/New_York'
                              })} at {new Date(formState.inspection_scheduled_for).toLocaleTimeString('en-US', { 
                                hour: 'numeric', 
                                minute: '2-digit',
                                timeZone: 'America/New_York'
                              })}
                            </span>
                          </div>
                        )}
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
                          onChange={(e) => {
                            setFormState((prev) => ({ ...prev, schedule_inspection: e.target.checked }))
                            if (!e.target.checked) {
                              setSelectedDate('')
                              setTimeSlots([])
                            }
                          }}
                        />
                        <span className="font-medium text-gray-900">Schedule Inspection</span>
                      </label>
                      
                      {formState.schedule_inspection && (
                        <>
                          <p className="text-xs text-gray-500">
                            This will create an Opportunity assigned to the selected closer.
                          </p>
                          
                          {/* Step 1: Select Closer */}
                          <select
                            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base bg-white"
                            value={formState.closer_user_id}
                            onChange={(e) => setFormState((prev) => ({ ...prev, closer_user_id: e.target.value }))}
                          >
                            <option value="">1. Select closer / sales rep</option>
                            {teams.length > 0 && (
                              <optgroup label="Team Round-Robin">
                                {teams.map((team) => (
                                  <option key={`team-${team.id}`} value={`team:${team.id}`}>
                                    🔄 {team.name} (Auto-assign)
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label="Individual Users">
                              {closers.map((closer) => (
                                <option key={closer.id} value={closer.id}>
                                  {closer.full_name || 'Unknown'} ({closer.role}){!closer.has_calendar ? ' ⚠️' : ''}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                          
                          {/* Calendar warning - only show for individual users, not teams */}
                          {formState.closer_user_id && !formState.closer_user_id.startsWith('team:') && (() => {
                            const selectedCloser = closers.find(c => c.id === formState.closer_user_id)
                            if (selectedCloser && !selectedCloser.has_calendar) {
                              return (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                                  <p className="text-amber-800 font-medium">⚠️ Calendar Not Connected</p>
                                  <p className="text-amber-700 text-xs mt-1">
                                    {selectedCloser.full_name || 'This closer'} hasn&apos;t connected their Google Calendar. 
                                    The appointment will be created but won&apos;t sync to their calendar automatically.
                                    They will receive a notification.
                                  </p>
                                </div>
                              )
                            }
                            return null
                          })()}
                          
                          {/* Team round-robin info */}
                          {formState.closer_user_id && formState.closer_user_id.startsWith('team:') && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                              <p className="text-blue-800 font-medium">🔄 Round-Robin Assignment</p>
                              <p className="text-blue-700 text-xs mt-1">
                                The system will automatically assign the next available closer from this team based on their calendar availability and queue position.
                              </p>
                            </div>
                          )}

                          {/* Step 2: Select Date */}
                          {formState.closer_user_id && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">2. Select Date</label>
                              <input
                                type="date"
                                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base bg-white text-gray-900"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                min={new Date().toISOString().split('T')[0]}
                              />
                            </div>
                          )}

                          {/* Step 3: Select Time Slot */}
                          {formState.closer_user_id && selectedDate && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                3. Select Time
                                <span className="text-xs text-gray-500 ml-1">({closerTimezone.replace('America/', '').replace('_', ' ')})</span>
                              </label>
                              
                              {loadingSlots ? (
                                <div className="flex items-center justify-center py-6">
                                  <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                                  <span className="ml-2 text-gray-600 text-sm">Loading times...</span>
                                </div>
                              ) : timeSlots.length > 0 ? (
                                <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto">
                                  {timeSlots.map((slot) => (
                                    <button
                                      key={slot.time}
                                      type="button"
                                      disabled={!slot.available}
                                      onClick={() => {
                                        setFormState((prev) => ({ ...prev, inspection_scheduled_for: slot.time }))
                                      }}
                                      className={`px-2 py-2 text-sm font-medium rounded-lg border-2 transition-all ${
                                        formState.inspection_scheduled_for === slot.time
                                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                                          : slot.available
                                          ? 'border-gray-200 active:border-indigo-300 active:bg-indigo-50 text-gray-700'
                                          : 'border-gray-100 bg-gray-50 text-gray-400 line-through'
                                      }`}
                                    >
                                      {slot.display}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-center py-3 text-gray-500 text-sm">
                                  No available times
                                </div>
                              )}
                            </div>
                          )}

                          {/* Selected time confirmation */}
                          {formState.inspection_scheduled_for && (
                            <div className="flex items-center gap-2 text-sm p-2 rounded-lg bg-green-50 text-green-700">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              <span className="text-xs">
                                {new Date(formState.inspection_scheduled_for).toLocaleDateString('en-US', { 
                                  weekday: 'short', 
                                  month: 'short', 
                                  day: 'numeric',
                                  timeZone: 'America/New_York'
                                })} at {new Date(formState.inspection_scheduled_for).toLocaleTimeString('en-US', { 
                                  hour: 'numeric', 
                                  minute: '2-digit',
                                  timeZone: 'America/New_York' 
                                })}
                              </span>
                            </div>
                          )}
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

        {/* Tap hint - hidden on mobile to avoid overlap */}
        {!showForm && mapStatus === 'loaded' && (
          <div className="hidden lg:block absolute bottom-8 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <div className="bg-black/80 text-white px-5 py-2 rounded-full text-xs font-medium shadow-lg">
              Tap to drop pin
            </div>
          </div>
        )}

        {/* Mobile bottom nav - compact */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t z-30 pb-safe">
          <div className="flex items-center justify-around h-12">
            <a href="/dashboard" className="flex flex-col items-center justify-center flex-1 h-full text-gray-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span className="text-[9px]">Home</span>
            </a>
            <a href="/canvass/map" className="flex flex-col items-center justify-center flex-1 h-full text-indigo-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-[9px] font-medium">Canvass</span>
            </a>
            <a href="/calendar" className="flex flex-col items-center justify-center flex-1 h-full text-gray-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-[9px]">Calendar</span>
            </a>
            <a href="/reports" className="flex flex-col items-center justify-center flex-1 h-full text-gray-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-[9px]">Reports</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
