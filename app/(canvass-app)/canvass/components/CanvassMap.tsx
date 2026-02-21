'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { CanvassPin } from '../page'
import type { ViewportPin } from '../lib/useViewportLeads'

// Declare google as a global variable for TypeScript
declare const google: any

// Union type for both pin formats
type AnyPin = CanvassPin | ViewportPin

interface Props {
  pins: AnyPin[]
  currentPosition: { lat: number; lng: number } | null
  onMapClick: (lat: number, lng: number) => void
  onPinClick: (pin: AnyPin) => void
  onAddressSelect?: (lat: number, lng: number, address: string) => void
  // Viewport mode props
  onBoundsChanged?: (bounds: google.maps.LatLngBounds, zoom: number) => void
  isViewportMode?: boolean
  viewportLoading?: boolean
  totalPinsLoaded?: number
  // Disposition filter
  dispositionFilter?: string | null
  onDispositionFilterChange?: (d: string | null) => void
}

// Pin colors based on disposition
const pinColors: Record<string, string> = {
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
function getDisposition(pin: AnyPin): string | null {
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
  dispositionFilter,
  onDispositionFilterChange,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const markerClustererRef = useRef<any>(null)
  const userMarkerRef = useRef<any>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [clustererLoaded, setClustererLoaded] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [currentZoom, setCurrentZoom] = useState(17)

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
      if (isViewportMode && !window.markerClusterer) {
        await new Promise<void>((resolve) => {
          const script = document.createElement('script')
          script.src = 'https://unpkg.com/@googlemaps/markerclusterer/dist/index.min.js'
          script.async = true
          script.onload = () => {
            window.markerClusterer = true
            resolve()
          }
          script.onerror = () => resolve() // Continue without clustering if it fails
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

    mapInstanceRef.current = new google.maps.Map(mapRef.current, {
      center: defaultCenter,
      zoom: currentPosition ? 17 : 4,
      disableDefaultUI: true,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      styles: [
        {
          featureType: 'poi',
          elementType: 'labels',
          stylers: [{ visibility: 'off' }],
        },
      ],
    })

    // Click listener
    mapInstanceRef.current.addListener('click', (e: any) => {
      if (e?.latLng) {
        onMapClick(e.latLng.lat(), e.latLng.lng())
      }
    })

    // Zoom change listener
    mapInstanceRef.current.addListener('zoom_changed', () => {
      const zoom = mapInstanceRef.current?.getZoom()
      if (zoom !== undefined) {
        setCurrentZoom(zoom)
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
  }, [mapLoaded, currentPosition, onBoundsChanged])

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

  // Update pin markers - optimized for large datasets
  useEffect(() => {
    if (!mapInstanceRef.current || !mapLoaded) return

    const currentMarkers = markersRef.current
    const newPinIds = new Set(pins.map(p => p.id))
    const existingIds = new Set(currentMarkers.keys())

    // Remove markers that are no longer in pins
    for (const [id, marker] of currentMarkers) {
      if (!newPinIds.has(id)) {
        marker.setMap(null)
        currentMarkers.delete(id)
      }
    }

    // Add or update markers
    const markersForClusterer: any[] = []
    
    for (const pin of pins) {
      const disposition = getDisposition(pin)
      const color = pinColors[disposition || ''] || pinColors.default
      const synced = isSynced(pin)

      if (currentMarkers.has(pin.id)) {
        // Marker exists - update if needed
        const marker = currentMarkers.get(pin.id)
        markersForClusterer.push(marker)
      } else {
        // Create new marker
        const marker = new google.maps.Marker({
          position: { lat: pin.lat, lng: pin.lng },
          map: isViewportMode && markerClustererRef.current ? null : mapInstanceRef.current,
          icon: {
            path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z',
            fillColor: color,
            fillOpacity: synced ? 1 : 0.6,
            strokeColor: synced ? '#ffffff' : '#FCD34D',
            strokeWeight: synced ? 2 : 3,
            scale: 1.5,
            anchor: new google.maps.Point(12, 22),
          },
          title: getPinTitle(pin),
          optimized: true, // Important for performance with many markers
        })

        marker.addListener('click', () => {
          onPinClick(pin)
        })

        currentMarkers.set(pin.id, marker)
        markersForClusterer.push(marker)
      }
    }

    // Update clusterer if in viewport mode
    if (isViewportMode && clustererLoaded && window.markerClusterer) {
      if (markerClustererRef.current) {
        markerClustererRef.current.clearMarkers()
        markerClustererRef.current.addMarkers(markersForClusterer)
      } else if (markersForClusterer.length > 0) {
        // Initialize clusterer
        try {
          const { MarkerClusterer } = window as any
          if (MarkerClusterer) {
            markerClustererRef.current = new MarkerClusterer({
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
          }
        } catch (e) {
          console.warn('MarkerClusterer not available, using individual markers')
          // Fall back to individual markers
          markersForClusterer.forEach(m => m.setMap(mapInstanceRef.current))
        }
      }
    }
  }, [pins, onPinClick, mapLoaded, clustererLoaded, isViewportMode])

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

  const dispositions = [
    { value: null, label: 'All Pins', color: 'bg-gray-500' },
    { value: 'hot_lead', label: 'Hot Lead', color: 'bg-red-500' },
    { value: 'go_back', label: 'Go Back', color: 'bg-yellow-500' },
    { value: 'not_home', label: 'Not Home', color: 'bg-gray-400' },
    { value: 'not_interested', label: 'Not Interested', color: 'bg-gray-600' },
    { value: 'scheduled', label: 'Scheduled', color: 'bg-green-500' },
  ]

  return (
    <div className="relative h-full w-full">
      <div ref={mapRef} className="h-full w-full" />
      
      {/* Center on user button */}
      {currentPosition && (
        <button
          onClick={handleCenterOnUser}
          className="absolute bottom-24 left-4 w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center"
        >
          <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      )}

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
              <span className={`w-3 h-3 rounded-full ${
                dispositions.find(d => d.value === dispositionFilter)?.color || 'bg-gray-500'
              }`}></span>
              <span className="text-sm font-medium">
                {dispositions.find(d => d.value === dispositionFilter)?.label || 'Filter'}
              </span>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {showFilterMenu && (
              <div className="absolute top-full right-0 mt-2 bg-white rounded-lg shadow-xl border py-1 min-w-[160px]">
                {dispositions.map((d) => (
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
                    <span className={`w-3 h-3 rounded-full ${d.color}`}></span>
                    <span className="text-sm">{d.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-lg p-3 text-xs">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500"></span>
                <span>Hot Lead</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
                <span>Go Back</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-indigo-600"></span>
                <span>New</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-gray-400"></span>
                <span>Not Home</span>
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

      {/* Viewport mode status bar */}
      {isViewportMode && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
          {viewportLoading ? (
            <div className="bg-white rounded-full shadow-lg px-4 py-2 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm text-gray-600">Loading pins...</span>
            </div>
          ) : (
            <div className="bg-indigo-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              </svg>
              <span>{totalPinsLoaded?.toLocaleString() || pins.length.toLocaleString()} pins</span>
              {currentZoom < 10 && <span className="opacity-75">• Zoom in for more</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Extend window for markerClusterer flag
declare global {
  interface Window {
    markerClusterer?: boolean
  }
}
