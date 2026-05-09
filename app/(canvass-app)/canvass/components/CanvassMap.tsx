'use client'

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { AssignedTerritoryMapPayload } from '@/lib/canvass-territories'
import type { CanvassPin } from '../page'
import type { ViewportPin } from '../lib/useViewportLeads'

// Declare google as a global variable for TypeScript
declare const google: any

// Union type for both pin formats
type AnyPin = CanvassPin | ViewportPin

// Bounds type for viewport mode (google.maps.LatLngBounds at runtime)
type MapBounds = any

// Disposition type from admin settings
interface DispositionConfig {
  id: string
  label: string
  color: string
  active?: boolean
}

interface Props {
  pins: AnyPin[]
  currentPosition: { lat: number; lng: number } | null
  onMapClick: (lat: number, lng: number) => void
  onPinClick: (pin: AnyPin) => void
  onAddressSelect?: (lat: number, lng: number, address: string) => void
  // Viewport mode props
  onBoundsChanged?: (bounds: MapBounds, zoom: number) => void
  isViewportMode?: boolean
  viewportLoading?: boolean
  totalPinsLoaded?: number
  onRefreshArea?: () => void
  refetchTrigger?: number  // When this changes, refetch bounds (e.g. when modal closes)
  // Disposition filter
  dispositionFilter?: string | null
  onDispositionFilterChange?: (d: string | null) => void
  // Disposition config from admin settings
  dispositions?: DispositionConfig[]
  /** Work areas assigned to this user (directly or via team) — shown as tinted polygons under pins */
  assignedTerritories?: AssignedTerritoryMapPayload[]
}

// Default pin colors (fallback if no admin settings)
const defaultPinColors: Record<string, string> = {
  hot_lead: '#EF4444',      // red
  go_back: '#F59E0B',       // yellow
  not_home: '#9CA3AF',      // gray
  not_interested: '#6B7280', // dark gray
  bad_roof: '#78716C',      // stone
  renter: '#A1A1AA',        // zinc
  scheduled: '#10B981',     // green (inspection scheduled)
  default: '#4F46E5',       // indigo
}

// Helper to get disposition from either pin format
// Also checks status for scheduled inspections
function getDisposition(pin: AnyPin): string | null {
  // Check if pin has inspection status - show as scheduled
  if ('status' in pin && pin.status === 'inspection') return 'scheduled'
  if ('s' in pin && pin.s === 'inspection') return 'scheduled'
  
  if ('disposition' in pin) return pin.disposition || null
  if ('d' in pin) return pin.d
  return null
}

// Helper to check if pin is synced (only for CanvassPin)
function isSynced(pin: AnyPin): boolean {
  if ('synced' in pin) return pin.synced
  return true // ViewportPins are always synced
}

// Helper to get pin title
function getPinTitle(pin: AnyPin): string {
  if ('homeowner_name' in pin && pin.homeowner_name) return pin.homeowner_name
  if ('address_text' in pin && pin.address_text) return pin.address_text
  return 'Pin'
}

function hasInstallationSalePin(pin: AnyPin): boolean {
  if ('ia' in pin && pin.ia) return true
  if (
    'installation_agreement_signed_at' in pin &&
    (pin as { installation_agreement_signed_at?: string | null }).installation_agreement_signed_at
  ) {
    return true
  }
  return false
}

function teardropIconAndLabel(pin: AnyPin, dispositionColor: string, synced: boolean) {
  const sale = hasInstallationSalePin(pin)
  const fillColor = sale ? '#16a34a' : dispositionColor
  const icon = {
    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z',
    fillColor,
    fillOpacity: synced ? 1 : 0.6,
    strokeColor: synced ? '#ffffff' : '#FCD34D',
    strokeWeight: synced ? 2 : 3,
    scale: 1.5,
    anchor: new google.maps.Point(12, 22),
  }
  const label = sale
    ? { text: '$', color: '#FFFFFF', fontSize: '12px', fontWeight: 'bold' as const }
    : null
  return { icon, label, sale }
}

function getMarkerVisualSignature(pin: AnyPin, dispositionColor: string, synced: boolean): string {
  const sale = hasInstallationSalePin(pin)
  const label = sale ? '$' : ''
  return [
    pin.lat,
    pin.lng,
    dispositionColor,
    synced ? '1' : '0',
    sale ? '1' : '0',
    label,
  ].join('|')
}

// Cluster styles for MarkerClusterer
const clusterStyles = [
  { textColor: 'white', textSize: 12, width: 30, height: 30, url: '' },
  { textColor: 'white', textSize: 14, width: 40, height: 40, url: '' },
  { textColor: 'white', textSize: 16, width: 50, height: 50, url: '' },
]

export default function CanvassMap({ 
  pins, 
  currentPosition, 
  onMapClick, 
  onPinClick, 
  onAddressSelect,
  onBoundsChanged,
  isViewportMode,
  viewportLoading,
  totalPinsLoaded,
  onRefreshArea,
  refetchTrigger,
  dispositionFilter,
  onDispositionFilterChange,
  dispositions = [],
  assignedTerritories,
}: Props) {
  // Keep latest handlers without re-running marker sync / re-binding map listeners every render.
  const onMapClickRef = useRef(onMapClick)
  const onPinClickRef = useRef(onPinClick)
  onMapClickRef.current = onMapClick
  onPinClickRef.current = onPinClick

  // Build pin colors map from admin dispositions (with fallback to defaults)
  const pinColors = React.useMemo(() => {
    const colors: Record<string, string> = { ...defaultPinColors }
    dispositions.forEach(d => {
      if (d.id && d.color) {
        colors[d.id] = d.color
      }
    })
    return colors
  }, [dispositions])
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const markerVisualsRef = useRef<Map<string, string>>(new Map())
  const markerClustererRef = useRef<any>(null)
  const clusteredPinIdsRef = useRef<Set<string>>(new Set()) // Track which pins are in clusterer
  const userMarkerRef = useRef<any>(null)
  const territoryPolygonsRef = useRef<any[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [clustererLoaded, setClustererLoaded] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [mapType, setMapType] = useState<'roadmap' | 'satellite' | 'hybrid'>('hybrid')
  const [mapHeading, setMapHeading] = useState(0) // Track map rotation for compass

  // Load Google Maps script with marker clusterer
  useEffect(() => {
    const loadScripts = async () => {
      // Load Google Maps
      if (typeof google === 'undefined' || !google.maps) {
        await new Promise<void>((resolve) => {
          const script = document.createElement('script')
          script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`
          script.async = true
          script.defer = true
          script.onload = () => resolve()
          document.head.appendChild(script)
        })
      }
      setMapLoaded(true)

      // Load MarkerClusterer for viewport mode
      if (isViewportMode && !(window as any).markerClusterer) {
        await new Promise<void>((resolve) => {
          const script = document.createElement('script')
          script.src = 'https://unpkg.com/@googlemaps/markerclusterer/dist/index.min.js'
          script.async = true
          script.onload = () => {
            // The library sets window.markerClusterer automatically
            console.log('MarkerClusterer loaded:', (window as any).markerClusterer)
            resolve()
          }
          script.onerror = () => {
            console.warn('Failed to load MarkerClusterer')
            resolve()
          }
          document.head.appendChild(script)
        })
      }
      setClustererLoaded(true)
    }

    loadScripts()
  }, [isViewportMode])

  // Initialize map
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || mapInstanceRef.current) return

    const defaultCenter = currentPosition || { lat: 39.8283, lng: -98.5795 }
    
    // Map ID enables vector maps with two-finger rotation/tilt gestures
    const googleMapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || 'f9f9a6138b2fd7e46c477374'

    mapInstanceRef.current = new google.maps.Map(mapRef.current, {
      center: defaultCenter,
      zoom: currentPosition ? 18 : 4,
      mapTypeId: 'hybrid', // Satellite with labels
      disableDefaultUI: true,
      zoomControl: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      rotateControl: false,
      scaleControl: false,
      gestureHandling: 'greedy', // Allow single finger pan
      heading: 0,
      tilt: 0,
      // Enable rotation and tilt gestures (requires vector map via mapId)
      ...(googleMapId && {
        mapId: googleMapId,
        headingInteractionEnabled: true,
        tiltInteractionEnabled: true,
      }),
      maxZoom: 20,
      minZoom: 10,
      clickableIcons: false,
    } as google.maps.MapOptions)

    // Click listener (ref so we don't recreate the map when the parent passes a new callback each render)
    mapInstanceRef.current.addListener('click', (e: any) => {
      if (e?.latLng) {
        onMapClickRef.current(e.latLng.lat(), e.latLng.lng())
      }
    })

    // Viewport mode: idle listener for bounds-based loading
    if (onBoundsChanged) {
      mapInstanceRef.current.addListener('idle', () => {
        const bounds = mapInstanceRef.current?.getBounds()
        const zoom = mapInstanceRef.current?.getZoom()
        if (bounds && zoom !== undefined) {
          onBoundsChanged(bounds, zoom)
        }
      })
    }

    // Track heading changes for compass
    mapInstanceRef.current.addListener('heading_changed', () => {
      const heading = mapInstanceRef.current?.getHeading() || 0
      setMapHeading(heading)
    })
  }, [mapLoaded, currentPosition, onBoundsChanged])

  // Refetch markers when user returns to app (fixes markers disappearing after app switch)
  useEffect(() => {
    if (!onBoundsChanged || !isViewportMode) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && mapInstanceRef.current) {
        const bounds = mapInstanceRef.current.getBounds()
        const zoom = mapInstanceRef.current.getZoom()
        if (bounds && zoom !== undefined) {
          // Signal that we need a fresh fetch (clears tile cache in useViewportLeads)
          if (onRefreshArea) {
            onRefreshArea()
          }
          onBoundsChanged(bounds, zoom)
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [onBoundsChanged, onRefreshArea, isViewportMode])

  // Refetch when modal closes (fixes pins disappearing after scheduling)
  useEffect(() => {
    if (!onBoundsChanged || !isViewportMode || !refetchTrigger) return
    if (!mapInstanceRef.current) return
    const bounds = mapInstanceRef.current.getBounds()
    const zoom = mapInstanceRef.current.getZoom()
    if (bounds && zoom !== undefined) {
      onBoundsChanged(bounds, zoom)
    }
  }, [refetchTrigger, onBoundsChanged, isViewportMode])

  // Refetch viewport when disposition filter changes (pin store is cleared in useViewportLeads)
  const prevDispositionFilterRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!onBoundsChanged || !isViewportMode) return
    if (!mapInstanceRef.current) return
    if (prevDispositionFilterRef.current === undefined) {
      prevDispositionFilterRef.current = dispositionFilter ?? null
      return
    }
    if (prevDispositionFilterRef.current === (dispositionFilter ?? null)) return
    prevDispositionFilterRef.current = dispositionFilter ?? null
    const bounds = mapInstanceRef.current.getBounds()
    const zoom = mapInstanceRef.current.getZoom()
    if (bounds && zoom !== undefined) {
      onBoundsChanged(bounds, zoom)
    }
  }, [dispositionFilter, onBoundsChanged, isViewportMode])

  // Reset map to north-facing
  const handleResetHeading = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setHeading(0)
      mapInstanceRef.current.setTilt(0)
      setMapHeading(0)
    }
  }

  // Update user position marker
  useEffect(() => {
    if (!mapInstanceRef.current || !currentPosition) return

    if (userMarkerRef.current) {
      userMarkerRef.current.setPosition(currentPosition)
    } else {
      userMarkerRef.current = new google.maps.Marker({
        position: currentPosition,
        map: mapInstanceRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#4F46E5',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
        zIndex: 1000,
      })

      mapInstanceRef.current.setCenter(currentPosition)
      mapInstanceRef.current.setZoom(17)
    }
  }, [currentPosition])

  // Update map type when changed
  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setMapTypeId(mapType)
    }
  }, [mapType])

  // Work-area boundaries (reps see assigned polygons; managers see their own assignments too)
  useEffect(() => {
    if (!mapInstanceRef.current || !mapLoaded) return

    territoryPolygonsRef.current.forEach((p) => p.setMap(null))
    territoryPolygonsRef.current = []

    const list = assignedTerritories ?? []
    for (const t of list) {
      for (const ring of t.rings) {
        if (!ring || ring.length < 3) continue
        const poly = new google.maps.Polygon({
          paths: ring.map(([lng, lat]) => ({ lat, lng })),
          strokeColor: t.color,
          strokeOpacity: 0.92,
          strokeWeight: 2,
          fillColor: t.color,
          fillOpacity: 0.13,
          map: mapInstanceRef.current,
          clickable: false,
          zIndex: 0,
        })
        territoryPolygonsRef.current.push(poly)
      }
    }

    return () => {
      territoryPolygonsRef.current.forEach((p) => p.setMap(null))
      territoryPolygonsRef.current = []
    }
  }, [mapLoaded, assignedTerritories])

  // Update pin markers - optimized for large datasets
  useEffect(() => {
    if (!mapInstanceRef.current || !mapLoaded) return

    const currentMarkers = markersRef.current
    const markerVisuals = markerVisualsRef.current
    const newPinIds = new Set(pins.map(p => p.id))
    const clusterer = markerClustererRef.current

    // Remove markers that are no longer in pins
    const markersToRemove: any[] = []
    currentMarkers.forEach((marker, id) => {
      if (!newPinIds.has(id)) {
        markersToRemove.push(marker)
        clusteredPinIdsRef.current.delete(id)
        markerVisuals.delete(id)
        marker.setMap(null)
        currentMarkers.delete(id)
      }
    })

    if (clusterer && markersToRemove.length > 0) {
      try {
        if (typeof clusterer.removeMarkers === 'function') {
          clusterer.removeMarkers(markersToRemove, true)
        } else if (typeof clusterer.removeMarker === 'function') {
          for (const marker of markersToRemove) {
            clusterer.removeMarker(marker, true)
          }
        }
      } catch {
        // fall back to marker.setMap(null) above
      }
    }

    // Add or update markers
    const markersForClusterer: any[] = []
    const newMarkersToAdd: any[] = []
    
    for (const pin of pins) {
      const disposition = getDisposition(pin)
      const color = pinColors[disposition || ''] || pinColors.default
      const synced = isSynced(pin)
      const { icon, label, sale } = teardropIconAndLabel(pin, color, synced)
      const visualSignature = getMarkerVisualSignature(pin, color, synced)

      if (currentMarkers.has(pin.id)) {
        const marker = currentMarkers.get(pin.id)
        if (marker) {
          const prevSignature = markerVisuals.get(pin.id)
          if (prevSignature !== visualSignature) {
            marker.setPosition({ lat: pin.lat, lng: pin.lng })
            marker.setIcon(icon)
            if (label) marker.setLabel(label)
            else marker.setLabel(null)
            marker.setZIndex(sale ? 700 : 0)
            markerVisuals.set(pin.id, visualSignature)
          }
          markersForClusterer.push(marker)
        }
      } else {
        const marker = new google.maps.Marker({
          position: { lat: pin.lat, lng: pin.lng },
          map: isViewportMode && markerClustererRef.current ? null : mapInstanceRef.current,
          icon,
          label: label ?? undefined,
          zIndex: sale ? 700 : undefined,
          title: hasInstallationSalePin(pin)
            ? `${getPinTitle(pin)} - Sold (signed agreement)`
            : getPinTitle(pin),
          optimized: true, // Important for performance with many markers
        })

        marker.addListener('click', () => {
          onPinClickRef.current(pin)
        })

        currentMarkers.set(pin.id, marker)
        markerVisuals.set(pin.id, visualSignature)
        markersForClusterer.push(marker)
        newMarkersToAdd.push(marker)
      }
    }

    // Update clusterer if in viewport mode
    if (isViewportMode && clustererLoaded && (window as any).markerClusterer) {
      if (markerClustererRef.current) {
        for (const pin of pins) {
          if (!clusteredPinIdsRef.current.has(pin.id) && currentMarkers.has(pin.id)) {
            clusteredPinIdsRef.current.add(pin.id)
          }
        }

        if (newMarkersToAdd.length > 0) {
          try {
            markerClustererRef.current.addMarkers(newMarkersToAdd, true)
          } catch {
            markerClustererRef.current.addMarkers(newMarkersToAdd)
          }
        }

        if (
          newMarkersToAdd.length > 0 ||
          markersToRemove.length > 0
        ) {
          try {
            markerClustererRef.current.render()
          } catch {
            // no-op if this build redraws automatically
          }
        }
      } else if (markersForClusterer.length > 0) {
        // Initialize clusterer
        try {
          // The UMD build exposes markerClusterer on window
          const windowAny = window as any
          const MarkerClustererClass = windowAny.markerClusterer?.MarkerClusterer || windowAny.MarkerClusterer
          
          if (MarkerClustererClass) {
            markerClustererRef.current = new MarkerClustererClass({
              map: mapInstanceRef.current,
              markers: markersForClusterer,
              renderer: {
                render: ({ count, position }: any) => {
                  const size = count < 10 ? 30 : count < 100 ? 40 : 50
                  const color = count < 10 ? '#4F46E5' : count < 100 ? '#7C3AED' : '#DC2626'
                  
                  return new google.maps.Marker({
                    position,
                    icon: {
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: size / 2,
                      fillColor: color,
                      fillOpacity: 0.9,
                      strokeColor: '#ffffff',
                      strokeWeight: 2,
                    },
                    label: {
                      text: String(count),
                      color: 'white',
                      fontSize: count < 100 ? '12px' : '10px',
                      fontWeight: 'bold',
                    },
                    zIndex: 100 + count,
                  })
                },
              },
            })
            // Track which pins are now in the clusterer
            pins.forEach(p => clusteredPinIdsRef.current.add(p.id))
            console.log('MarkerClusterer initialized with', markersForClusterer.length, 'markers')
          } else {
            console.warn('MarkerClusterer class not found on window')
          }
        } catch (e) {
          console.warn('MarkerClusterer not available, using individual markers', e)
          // Fall back to individual markers
          markersForClusterer.forEach(m => m.setMap(mapInstanceRef.current))
        }
      }
    }
  }, [pins, mapLoaded, clustererLoaded, isViewportMode])

  const handleCenterOnUser = () => {
    if (mapInstanceRef.current && currentPosition) {
      mapInstanceRef.current.panTo(currentPosition)
      mapInstanceRef.current.setZoom(17)
    }
  }

  // Initialize Places Autocomplete
  useEffect(() => {
    if (!mapLoaded || !searchExpanded || !searchInputRef.current || autocompleteRef.current) return

    autocompleteRef.current = new google.maps.places.Autocomplete(searchInputRef.current, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
    })

    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current?.getPlace()
      if (place?.geometry?.location) {
        const lat = place.geometry.location.lat()
        const lng = place.geometry.location.lng()
        const address = place.formatted_address || ''

        if (mapInstanceRef.current) {
          mapInstanceRef.current.panTo({ lat, lng })
          mapInstanceRef.current.setZoom(18)
        }

        if (onAddressSelect) {
          onAddressSelect(lat, lng, address)
        }

        setSearchValue('')
        setSearchExpanded(false)
      }
    })
  }, [mapLoaded, searchExpanded, onAddressSelect])

  useEffect(() => {
    if (searchExpanded && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
    if (!searchExpanded) {
      autocompleteRef.current = null
    }
  }, [searchExpanded])

  // Build filter options from admin dispositions
  const filterOptions = useMemo(() => {
    const options: Array<{ value: string | null; label: string; color: string }> = [
      { value: null, label: 'All Pins', color: '#6B7280' },
    ]
    
    // Add dispositions from admin settings
    if (dispositions.length > 0) {
      dispositions.forEach(d => {
        if (d.active !== false) {
          options.push({
            value: d.id,
            label: d.label,
            color: d.color,
          })
        }
      })
    } else {
      // Fallback to defaults if no admin dispositions
      options.push(
        { value: 'hot_lead', label: 'Hot Lead', color: '#EF4444' },
        { value: 'go_back', label: 'Go Back', color: '#F59E0B' },
        { value: 'not_home', label: 'Not Home', color: '#9CA3AF' },
        { value: 'not_interested', label: 'Not Interested', color: '#6B7280' },
      )
    }
    
    // Always add scheduled option
    options.push({ value: 'scheduled', label: 'Scheduled', color: '#10B981' })
    
    return options
  }, [dispositions])

  return (
    <div className="relative h-full w-full">
      <div ref={mapRef} className="h-full w-full" />
      
      {/* Map controls - left side */}
      <div className="absolute bottom-24 left-4 flex flex-col gap-2 z-10">
        {/* Refresh button (viewport mode) */}
        {isViewportMode && onRefreshArea && (
          <button
            onClick={onRefreshArea}
            className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center"
            title="Refresh area"
          >
            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
        
        {/* Map type toggle */}
        <button
          onClick={() => setMapType(mapType === 'hybrid' ? 'roadmap' : 'hybrid')}
          className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center"
          title={mapType === 'hybrid' ? 'Switch to Road Map' : 'Switch to Satellite'}
        >
          {mapType === 'hybrid' ? (
            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </button>
        
        {/* Center on user button */}
        {currentPosition && (
          <button
            onClick={handleCenterOnUser}
            className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center"
          >
            <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
        
        {/* Compass - tap to reset north */}
        <button
          onClick={handleResetHeading}
          className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center"
          title="Reset to North"
        >
          <svg 
            className="w-6 h-6" 
            viewBox="0 0 24 24" 
            fill="currentColor"
            style={{ transform: `rotate(${-mapHeading}deg)`, transition: 'transform 0.3s ease' }}
          >
            <path d="M12 2L8 10h8L12 2z" fill="#EF4444" />
            <path d="M12 22l4-8H8l4 8z" fill="#9CA3AF" />
          </svg>
        </button>
      </div>

      {/* Address Search */}
      <div className="absolute top-4 left-4 z-10">
        <div 
          className={`bg-white rounded-full shadow-lg flex items-center transition-all duration-300 ease-in-out overflow-hidden ${
            searchExpanded ? 'w-72 rounded-lg' : 'w-11 h-11'
          }`}
        >
          <button
            onClick={() => setSearchExpanded(!searchExpanded)}
            className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-gray-600 hover:text-indigo-600"
          >
            {searchExpanded ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          </button>
          {searchExpanded && (
            <input
              ref={searchInputRef}
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search address..."
              className="flex-1 pr-3 py-2 text-sm outline-none bg-transparent"
            />
          )}
        </div>
      </div>

      {/* Legend / Filter (viewport mode gets filter dropdown) */}
      <div className="absolute top-4 right-4 z-10">
        {isViewportMode && onDispositionFilterChange ? (
          <div className="relative">
            <button
              onClick={() => setShowFilterMenu(!showFilterMenu)}
              className="bg-white rounded-lg shadow-lg p-3 flex items-center gap-2"
            >
              <span 
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: filterOptions.find(d => d.value === dispositionFilter)?.color || '#6B7280' }}
              ></span>
              <span className="text-sm font-medium text-gray-900">
                {filterOptions.find(d => d.value === dispositionFilter)?.label || 'All Pins'}
              </span>
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {showFilterMenu && (
              <div className="absolute top-full right-0 mt-2 bg-white rounded-lg shadow-xl border py-1 min-w-[160px]">
                {filterOptions.map((d) => (
                  <button
                    key={d.value || 'all'}
                    onClick={() => {
                      onDispositionFilterChange(d.value)
                      setShowFilterMenu(false)
                    }}
                    className={`w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-gray-50 ${
                      dispositionFilter === d.value ? 'bg-indigo-50' : ''
                    }`}
                  >
                    <span 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: d.color }}
                    ></span>
                    <span className="text-sm text-gray-900">{d.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-lg p-3 text-xs">
            <div className="space-y-1.5">
              {filterOptions.slice(1).map((d) => (
                <div key={d.value} className="flex items-center gap-2">
                  <span 
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: d.color }}
                  ></span>
                  <span className="text-gray-900">{d.label}</span>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-indigo-600"></span>
                <span className="text-gray-900">New</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Loading overlay */}
      {!mapLoaded && (
        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
            <p className="text-gray-500 text-sm">Loading map...</p>
          </div>
        </div>
      )}

      {/* Loading indicator for viewport mode */}
      {isViewportMode && viewportLoading && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
          <div className="bg-white rounded-full shadow-lg px-4 py-2 flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-sm text-gray-600">Loading...</span>
          </div>
        </div>
      )}
    </div>
  )
}
