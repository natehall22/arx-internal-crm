'use client'

import { useEffect, useRef, useState } from 'react'

declare const google: any

interface Props {
  lat: number
  lng: number
  address?: string | null
}

export default function LocationMap({ lat, lng, address }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    
    if (!apiKey) {
      setError('Google Maps API key not configured')
      return
    }

    // Check if Google Maps is already loaded
    if (typeof google !== 'undefined' && google.maps) {
      initMap()
      return
    }

    // Check if script is already being loaded
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]')
    if (existingScript) {
      existingScript.addEventListener('load', initMap)
      return
    }

    // Load Google Maps script
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
    script.async = true
    script.defer = true
    script.onload = initMap
    script.onerror = () => setError('Failed to load Google Maps')
    document.head.appendChild(script)

    function initMap() {
      if (!mapRef.current) return
      
      try {
        const map = new google.maps.Map(mapRef.current, {
          center: { lat, lng },
          zoom: 17,
          mapTypeId: 'hybrid',
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: true,
          streetViewControl: true,
          fullscreenControl: true,
        })

        new google.maps.Marker({
          position: { lat, lng },
          map,
          title: address || 'Property Location',
        })

        setMapLoaded(true)
      } catch (err) {
        console.error('Error initializing map:', err)
        setError('Failed to initialize map')
      }
    }
  }, [lat, lng, address])

  if (error) {
    return (
      <div className="h-48 bg-gray-100 rounded flex flex-col items-center justify-center text-gray-500">
        <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p className="text-sm">{error}</p>
        <p className="text-xs mt-1">Coordinates: {lat.toFixed(6)}, {lng.toFixed(6)}</p>
      </div>
    )
  }

  return (
    <div className="relative">
      <div 
        ref={mapRef} 
        className="h-48 rounded"
        style={{ minHeight: '192px' }}
      />
      {!mapLoaded && (
        <div className="absolute inset-0 bg-gray-100 rounded flex items-center justify-center">
          <div className="flex items-center gap-2 text-gray-500">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-sm">Loading map...</span>
          </div>
        </div>
      )}
    </div>
  )
}
