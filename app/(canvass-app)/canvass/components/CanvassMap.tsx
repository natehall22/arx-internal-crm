'use client'

import { useEffect, useRef, useState } from 'react'
import type { CanvassPin } from '../page'

// Declare google as a global variable for TypeScript
declare const google: any

interface Props {
  pins: CanvassPin[]
  currentPosition: { lat: number; lng: number } | null
  onMapClick: (lat: number, lng: number) => void
  onPinClick: (pin: CanvassPin) => void
  onAddressSelect?: (lat: number, lng: number, address: string) => void
}

// Pin colors based on disposition
const pinColors: Record<string, string> = {
  hot_lead: '#EF4444',      // red
  go_back: '#F59E0B',       // yellow
  not_home: '#9CA3AF',      // gray
  not_interested: '#6B7280', // dark gray
  bad_roof: '#78716C',      // stone
  renter: '#A1A1AA',        // zinc
  default: '#4F46E5',       // indigo
}

export default function CanvassMap({ pins, currentPosition, onMapClick, onPinClick, onAddressSelect }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const userMarkerRef = useRef<any>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [searchValue, setSearchValue] = useState('')

  // Load Google Maps script
  useEffect(() => {
    if (typeof google !== 'undefined' && google.maps) {
      setMapLoaded(true)
      return
    }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`
    script.async = true
    script.defer = true
    script.onload = () => setMapLoaded(true)
    document.head.appendChild(script)

    return () => {
      // Cleanup if needed
    }
  }, [])

  // Initialize map
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || mapInstanceRef.current) return

    const defaultCenter = currentPosition || { lat: 39.8283, lng: -98.5795 } // US center

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

    // Add click listener
    mapInstanceRef.current.addListener('click', (e) => {
      if (e?.latLng) {
        onMapClick(e.latLng.lat(), e.latLng.lng())
      }
    })
  }, [mapLoaded, currentPosition])

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

      // Center map on first position
      mapInstanceRef.current.setCenter(currentPosition)
      mapInstanceRef.current.setZoom(17)
    }
  }, [currentPosition])

  // Update pin markers
  useEffect(() => {
    if (!mapInstanceRef.current) return

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.setMap(null))
    markersRef.current = []

    // Add new markers
    pins.forEach((pin) => {
      const color = pinColors[pin.disposition || ''] || pinColors.default
      const isSynced = pin.synced

      const marker = new google.maps.Marker({
        position: { lat: pin.lat, lng: pin.lng },
        map: mapInstanceRef.current!,
        icon: {
          path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z',
          fillColor: color,
          fillOpacity: isSynced ? 1 : 0.6,
          strokeColor: isSynced ? '#ffffff' : '#FCD34D',
          strokeWeight: isSynced ? 2 : 3,
          scale: 1.5,
          anchor: new google.maps.Point(12, 22),
        },
        title: pin.homeowner_name || pin.address_text || 'Pin',
      })

      marker.addListener('click', () => {
        onPinClick(pin)
      })

      markersRef.current.push(marker)
    })
  }, [pins, onPinClick])

  const handleCenterOnUser = () => {
    if (mapInstanceRef.current && currentPosition) {
      mapInstanceRef.current.panTo(currentPosition)
      mapInstanceRef.current.setZoom(17)
    }
  }

  // Initialize Places Autocomplete when search expands
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

        // Pan map to selected location
        if (mapInstanceRef.current) {
          mapInstanceRef.current.panTo({ lat, lng })
          mapInstanceRef.current.setZoom(18)
        }

        // Notify parent component
        if (onAddressSelect) {
          onAddressSelect(lat, lng, address)
        }

        // Close search and clear input
        setSearchValue('')
        setSearchExpanded(false)
      }
    })
  }, [mapLoaded, searchExpanded, onAddressSelect])

  // Focus input when search expands
  useEffect(() => {
    if (searchExpanded && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
    // Reset autocomplete ref when closing
    if (!searchExpanded) {
      autocompleteRef.current = null
    }
  }, [searchExpanded])

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

      {/* Legend */}
      <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg p-3 text-xs">
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

      {/* Loading overlay */}
      {!mapLoaded && (
        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
            <p className="text-gray-500 text-sm">Loading map...</p>
          </div>
        </div>
      )}
    </div>
  )
}
