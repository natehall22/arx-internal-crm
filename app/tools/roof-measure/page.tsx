'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

declare const google: any

interface Point {
  lat: number
  lng: number
}

interface RoofFacet {
  id: string
  points: Point[]
  area_sqft: number
  pitch: string
  pitch_degrees: number
  orientation: string
  color: string
}

interface MeasurementData {
  address: string
  lat: number
  lng: number
  total_area_sqft: number
  total_squares: number
  facets: RoofFacet[]
  ridges_lf: number
  hips_lf: number
  valleys_lf: number
  eaves_lf: number
  rakes_lf: number
  predominant_pitch: string
  suggested_waste: number
}

const PITCH_OPTIONS = [
  { label: 'Flat (0/12)', value: '0/12', degrees: 0 },
  { label: '1/12', value: '1/12', degrees: 4.76 },
  { label: '2/12', value: '2/12', degrees: 9.46 },
  { label: '3/12', value: '3/12', degrees: 14.04 },
  { label: '4/12', value: '4/12', degrees: 18.43 },
  { label: '5/12', value: '5/12', degrees: 22.62 },
  { label: '6/12', value: '6/12', degrees: 26.57 },
  { label: '7/12', value: '7/12', degrees: 30.26 },
  { label: '8/12', value: '8/12', degrees: 33.69 },
  { label: '9/12', value: '9/12', degrees: 36.87 },
  { label: '10/12', value: '10/12', degrees: 39.81 },
  { label: '11/12', value: '11/12', degrees: 42.51 },
  { label: '12/12', value: '12/12', degrees: 45 },
  { label: '14/12', value: '14/12', degrees: 49.4 },
  { label: '16/12', value: '16/12', degrees: 53.13 },
]

const FACET_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
]

export default function RoofMeasurePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const mapRef = useRef<HTMLDivElement>(null)
  const addressInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const googleMapRef = useRef<any>(null)
  const drawingManagerRef = useRef<any>(null)
  const polygonsRef = useRef<Map<string, any>>(new Map())
  
  const [loading, setLoading] = useState(true)
  const [address, setAddress] = useState('')
  const [searchedAddress, setSearchedAddress] = useState('')
  // Default to Dallas, TX area with a reasonable zoom
  const [mapCenter, setMapCenter] = useState({ lat: 32.7767, lng: -96.7970 })
  const [facets, setFacets] = useState<RoofFacet[]>([])
  const [selectedFacet, setSelectedFacet] = useState<string | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [showPitchModal, setShowPitchModal] = useState(false)
  const [pendingFacet, setPendingFacet] = useState<Partial<RoofFacet> | null>(null)
  const [measurements, setMeasurements] = useState<MeasurementData | null>(null)
  const [saving, setSaving] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [opportunityId, setOpportunityId] = useState<string | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapsLoaded, setMapsLoaded] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [googleLoaded, setGoogleLoaded] = useState(false)

  useEffect(() => {
    const oppId = searchParams.get('opportunity_id') || searchParams.get('opportunity')
    const urlAddress = searchParams.get('address')
    
    if (oppId) {
      setOpportunityId(oppId)
      loadOpportunityAddress(oppId)
    } else if (urlAddress) {
      setAddress(urlAddress)
    }
    loadGoogleMaps()
  }, [searchParams])

  // Initialize map when Google is loaded
  useEffect(() => {
    if (!googleLoaded || mapReady) return
    
    console.log('Google loaded, waiting for map ref...')
    
    // Poll for the map ref to be available
    let attempts = 0
    const maxAttempts = 100 // 10 seconds max
    
    const checkAndInit = () => {
      attempts++
      
      if (mapRef.current) {
        console.log('Map ref available, initializing map...')
        try {
          initializeMap()
          setMapReady(true)
          setMapsLoaded(true)
          setLoading(false)
        } catch (error) {
          console.error('Error initializing map:', error)
          setMapError('Failed to initialize map. Please refresh the page.')
          setLoading(false)
        }
        return true // Success
      }
      
      if (attempts >= maxAttempts) {
        console.error('Map ref never became available after', attempts, 'attempts')
        setMapError('Failed to initialize map container. Please refresh the page.')
        setLoading(false)
        return true // Stop polling
      }
      
      return false // Keep polling
    }
    
    // Try immediately first
    if (checkAndInit()) return
    
    // Then poll
    const pollInterval = setInterval(() => {
      if (checkAndInit()) {
        clearInterval(pollInterval)
      }
    }, 100)
    
    return () => clearInterval(pollInterval)
  }, [googleLoaded, mapReady])

  // Auto-search when maps are loaded and we have an address from URL
  useEffect(() => {
    if (mapsLoaded && address && !searchedAddress) {
      searchAddress(address)
    }
  }, [mapsLoaded, address])

  const loadOpportunityAddress = async (oppId: string) => {
    try {
      const response = await fetch(`/api/measurements?opportunity_id=${oppId}`)
      if (response.ok) {
        const { opportunity } = await response.json()
        if (opportunity?.address_text) {
          setAddress(opportunity.address_text)
          // Auto-search will happen via the mapsLoaded effect
        }
      }
    } catch (error) {
      console.error('Error loading opportunity address:', error)
    }
  }

  const loadGoogleMaps = () => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    
    if (!apiKey) {
      setMapError('Google Maps API key is not configured. Please add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to your environment variables.')
      setLoading(false)
      return
    }

    // Check if Google Maps is already loaded WITH the required libraries
    const hasRequiredLibraries = window.google?.maps?.drawing && 
                                  window.google?.maps?.geometry && 
                                  window.google?.maps?.places

    if (window.google && window.google.maps && hasRequiredLibraries) {
      console.log('Google Maps already loaded with required libraries')
      setGoogleLoaded(true)
      return
    }

    // Check if script already exists but may not have our required libraries
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]')
    
    if (existingScript) {
      // Remove the existing script if it doesn't have our libraries
      const scriptSrc = existingScript.getAttribute('src') || ''
      if (!scriptSrc.includes('libraries=') || 
          !scriptSrc.includes('drawing') || 
          !scriptSrc.includes('geometry') || 
          !scriptSrc.includes('places')) {
        console.log('Existing script missing required libraries, reloading...')
        existingScript.remove()
        // Clear any existing google object
        if (window.google) {
          delete (window as any).google
        }
      } else if (window.google && window.google.maps) {
        // Script has libraries and is loaded
        console.log('Google Maps script already loaded with libraries')
        setGoogleLoaded(true)
        return
      } else {
        // Script exists with libraries but not loaded yet, wait for it
        existingScript.addEventListener('load', () => {
          console.log('Existing Google Maps script loaded')
          setTimeout(() => setGoogleLoaded(true), 100)
        })
        return
      }
    }

    // Create new script with all required libraries
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=drawing,geometry,places`
    script.async = true
    script.defer = true
    script.onload = () => {
      console.log('Google Maps script loaded successfully with libraries')
      setTimeout(() => setGoogleLoaded(true), 100)
    }
    script.onerror = (error) => {
      console.error('Failed to load Google Maps:', error)
      setMapError('Failed to load Google Maps. Please check your API key and ensure the Maps JavaScript API is enabled.')
      setLoading(false)
    }
    document.head.appendChild(script)
  }

  const initializeMap = () => {
    if (!mapRef.current) {
      console.error('Map container ref not available')
      return
    }
    
    if (!window.google || !window.google.maps) {
      console.error('Google Maps not available on window')
      return
    }

    console.log('Initializing Google Map...')

    try {
      const map = new google.maps.Map(mapRef.current, {
        center: mapCenter,
        zoom: 20,
        maxZoom: 23,           // Allow max zoom (Google will cap based on available imagery)
        minZoom: 3,
        mapTypeId: 'satellite',
        tilt: 0,
        isFractionalZoomEnabled: true,  // Allows smoother zoom between levels
        mapTypeControl: true,
        mapTypeControlOptions: {
          position: google.maps.ControlPosition.TOP_RIGHT,
          mapTypeIds: ['satellite', 'hybrid', 'roadmap'],
        },
        fullscreenControl: true,
        streetViewControl: false,
        gestureHandling: 'greedy',
        scrollwheel: true,
        zoomControl: true,
        zoomControlOptions: {
          position: google.maps.ControlPosition.RIGHT_CENTER,
        },
      })

      googleMapRef.current = map
      console.log('Map created successfully')
      
      // Add listener for when tiles load
      google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
        console.log('Map tiles loaded successfully')
      })
      
      // Add idle listener to confirm map is ready
      google.maps.event.addListenerOnce(map, 'idle', () => {
        console.log('Map is idle and ready')
      })

      // Initialize drawing manager
      const drawingManager = new google.maps.drawing.DrawingManager({
        drawingMode: null,
        drawingControl: false,
        polygonOptions: {
          fillColor: '#3B82F6',
          fillOpacity: 0.35,
          strokeColor: '#3B82F6',
          strokeWeight: 2,
          editable: true,
          draggable: false,
        },
      })

      drawingManager.setMap(map)
      drawingManagerRef.current = drawingManager
      console.log('Drawing manager initialized')

      // Listen for polygon complete
      google.maps.event.addListener(drawingManager, 'polygoncomplete', (polygon: any) => {
        handlePolygonComplete(polygon)
      })

      // Initialize Places Autocomplete
      initializeAutocomplete()
    } catch (error) {
      console.error('Error initializing map:', error)
      setMapError('Failed to initialize the map. Please check the console for details.')
    }
  }

  const initializeAutocomplete = () => {
    if (!addressInputRef.current || !window.google?.maps?.places) {
      console.log('Autocomplete not ready, will retry...')
      // Retry after a short delay
      setTimeout(initializeAutocomplete, 500)
      return
    }

    if (autocompleteRef.current) return // Already initialized

    try {
      const autocomplete = new google.maps.places.Autocomplete(addressInputRef.current, {
        types: ['address'],
        componentRestrictions: { country: 'us' },
        fields: ['formatted_address', 'geometry', 'address_components'],
      })

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        
        if (place.geometry?.location) {
          const lat = place.geometry.location.lat()
          const lng = place.geometry.location.lng()
          
          setAddress(place.formatted_address || '')
          setSearchedAddress(place.formatted_address || '')
          setMapCenter({ lat, lng })
          
          if (googleMapRef.current) {
            googleMapRef.current.setCenter({ lat, lng })
            googleMapRef.current.setZoom(20)
          }
          
          console.log('Place selected:', place.formatted_address, 'at', lat, lng)
        }
      })

      autocompleteRef.current = autocomplete
      console.log('Autocomplete initialized successfully')
    } catch (error) {
      console.error('Error initializing autocomplete:', error)
    }
  }

  const searchAddress = async (searchAddr?: string) => {
    const addrToSearch = searchAddr || address
    if (!addrToSearch) {
      alert('Please enter an address')
      return
    }
    
    if (!window.google || !window.google.maps) {
      console.error('Google Maps not loaded')
      setMapError('Google Maps failed to load. Please refresh the page.')
      return
    }

    const geocoder = new google.maps.Geocoder()
    
    console.log('Searching for address:', addrToSearch)
    
    // Use callback style instead of promise style for better error handling
    geocoder.geocode({ address: addrToSearch }, (results: any, status: any) => {
      console.log('Geocode response - Status:', status, 'Results:', results)
      
      if (status === google.maps.GeocoderStatus.OK && results && results[0]) {
        const location = results[0].geometry.location
        const lat = location.lat()
        const lng = location.lng()
        
        console.log('Geocoded address:', results[0].formatted_address, 'at', lat, lng)
        
        setMapCenter({ lat, lng })
        setSearchedAddress(results[0].formatted_address)
        
        if (googleMapRef.current) {
          googleMapRef.current.setCenter({ lat, lng })
          googleMapRef.current.setZoom(20)
        }
      } else if (status === google.maps.GeocoderStatus.ZERO_RESULTS) {
        alert('Address not found. Please try a more specific address.')
      } else if (status === google.maps.GeocoderStatus.REQUEST_DENIED) {
        console.error('Geocoding request denied')
        setMapError('Geocoding API access denied. Please ensure the Geocoding API is enabled in your Google Cloud Console and billing is set up.')
      } else if (status === google.maps.GeocoderStatus.OVER_QUERY_LIMIT) {
        alert('Too many requests. Please wait a moment and try again.')
      } else {
        console.error('Geocoding failed with status:', status)
        alert('Could not find address. Status: ' + status)
      }
    })
  }

  const startDrawing = () => {
    if (!drawingManagerRef.current) return
    
    const colorIndex = facets.length % FACET_COLORS.length
    const color = FACET_COLORS[colorIndex]
    
    drawingManagerRef.current.setOptions({
      drawingMode: google.maps.drawing.OverlayType.POLYGON,
      polygonOptions: {
        fillColor: color,
        fillOpacity: 0.35,
        strokeColor: color,
        strokeWeight: 2,
        editable: true,
      },
    })
    
    setIsDrawing(true)
  }

  const stopDrawing = () => {
    if (!drawingManagerRef.current) return
    drawingManagerRef.current.setDrawingMode(null)
    setIsDrawing(false)
  }

  const handlePolygonComplete = (polygon: any) => {
    stopDrawing()
    
    const path = polygon.getPath()
    const points: Point[] = []
    
    for (let i = 0; i < path.getLength(); i++) {
      const point = path.getAt(i)
      points.push({ lat: point.lat(), lng: point.lng() })
    }
    
    // Calculate area
    const areaMeters = google.maps.geometry.spherical.computeArea(path)
    const areaSqft = areaMeters * 10.7639 // Convert to sqft
    
    // Calculate orientation based on centroid
    const orientation = calculateOrientation(points)
    
    const colorIndex = facets.length % FACET_COLORS.length
    
    setPendingFacet({
      id: `facet-${Date.now()}`,
      points,
      area_sqft: Math.round(areaSqft),
      orientation,
      color: FACET_COLORS[colorIndex],
    })
    
    // Store polygon reference temporarily
    polygonsRef.current.set(`pending`, polygon)
    
    setShowPitchModal(true)
  }

  const calculateOrientation = (points: Point[]): string => {
    // Calculate centroid
    const centroid = points.reduce(
      (acc, p) => ({ lat: acc.lat + p.lat / points.length, lng: acc.lng + p.lng / points.length }),
      { lat: 0, lng: 0 }
    )
    
    // For simplicity, use the first edge to determine orientation
    if (points.length >= 2) {
      const dx = points[1].lng - points[0].lng
      const dy = points[1].lat - points[0].lat
      const angle = Math.atan2(dy, dx) * (180 / Math.PI)
      
      if (angle >= -22.5 && angle < 22.5) return 'E'
      if (angle >= 22.5 && angle < 67.5) return 'NE'
      if (angle >= 67.5 && angle < 112.5) return 'N'
      if (angle >= 112.5 && angle < 157.5) return 'NW'
      if (angle >= 157.5 || angle < -157.5) return 'W'
      if (angle >= -157.5 && angle < -112.5) return 'SW'
      if (angle >= -112.5 && angle < -67.5) return 'S'
      if (angle >= -67.5 && angle < -22.5) return 'SE'
    }
    
    return 'N'
  }

  const confirmFacetPitch = (pitch: string, pitchDegrees: number) => {
    if (!pendingFacet) return
    
    const polygon = polygonsRef.current.get('pending')
    
    // Adjust area for pitch
    const pitchMultiplier = 1 / Math.cos(pitchDegrees * (Math.PI / 180))
    const adjustedArea = Math.round((pendingFacet.area_sqft || 0) * pitchMultiplier)
    
    const newFacet: RoofFacet = {
      id: pendingFacet.id!,
      points: pendingFacet.points!,
      area_sqft: adjustedArea,
      pitch,
      pitch_degrees: pitchDegrees,
      orientation: pendingFacet.orientation!,
      color: pendingFacet.color!,
    }
    
    // Move polygon to permanent storage
    if (polygon) {
      polygonsRef.current.delete('pending')
      polygonsRef.current.set(newFacet.id, polygon)
      
      // Add click listener
      polygon.addListener('click', () => {
        setSelectedFacet(newFacet.id)
      })
    }
    
    setFacets(prev => [...prev, newFacet])
    setPendingFacet(null)
    setShowPitchModal(false)
    
    // Update measurements
    updateMeasurements([...facets, newFacet])
  }

  const cancelFacet = () => {
    const polygon = polygonsRef.current.get('pending')
    if (polygon) {
      polygon.setMap(null)
      polygonsRef.current.delete('pending')
    }
    setPendingFacet(null)
    setShowPitchModal(false)
  }

  const deleteFacet = (facetId: string) => {
    const polygon = polygonsRef.current.get(facetId)
    if (polygon) {
      polygon.setMap(null)
      polygonsRef.current.delete(facetId)
    }
    
    const newFacets = facets.filter(f => f.id !== facetId)
    setFacets(newFacets)
    setSelectedFacet(null)
    updateMeasurements(newFacets)
  }

  const updateMeasurements = (currentFacets: RoofFacet[]) => {
    if (currentFacets.length === 0) {
      setMeasurements(null)
      return
    }
    
    const totalArea = currentFacets.reduce((sum, f) => sum + f.area_sqft, 0)
    
    // Calculate perimeter estimates (simplified)
    const avgPerimeter = currentFacets.reduce((sum, f) => {
      const perim = calculatePerimeter(f.points)
      return sum + perim
    }, 0)
    
    // Estimate linear footage (rough estimates based on typical roof proportions)
    const ridges = Math.round(avgPerimeter * 0.15)
    const hips = Math.round(avgPerimeter * 0.1)
    const valleys = Math.round(avgPerimeter * 0.08)
    const eaves = Math.round(avgPerimeter * 0.35)
    const rakes = Math.round(avgPerimeter * 0.32)
    
    // Find predominant pitch
    const pitchCounts: Record<string, number> = {}
    currentFacets.forEach(f => {
      pitchCounts[f.pitch] = (pitchCounts[f.pitch] || 0) + f.area_sqft
    })
    const predominantPitch = Object.entries(pitchCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '6/12'
    
    // Calculate waste factor based on complexity
    const wastePercent = calculateWasteFactor(currentFacets)
    
    setMeasurements({
      address: searchedAddress,
      lat: mapCenter.lat,
      lng: mapCenter.lng,
      total_area_sqft: totalArea,
      total_squares: Math.round(totalArea / 100 * 100) / 100,
      facets: currentFacets,
      ridges_lf: ridges,
      hips_lf: hips,
      valleys_lf: valleys,
      eaves_lf: eaves,
      rakes_lf: rakes,
      predominant_pitch: predominantPitch,
      suggested_waste: wastePercent,
    })
  }

  const calculatePerimeter = (points: Point[]): number => {
    if (!window.google || points.length < 2) return 0
    
    let perimeter = 0
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i]
      const p2 = points[(i + 1) % points.length]
      const distance = google.maps.geometry.spherical.computeDistanceBetween(
        new google.maps.LatLng(p1.lat, p1.lng),
        new google.maps.LatLng(p2.lat, p2.lng)
      )
      perimeter += distance * 3.28084 // Convert to feet
    }
    return perimeter
  }

  const calculateWasteFactor = (currentFacets: RoofFacet[]): number => {
    // Base waste
    let waste = 10
    
    // Add for complexity
    if (currentFacets.length > 4) waste += 2
    if (currentFacets.length > 8) waste += 3
    
    // Add for steep pitches
    const avgPitch = currentFacets.reduce((sum, f) => sum + f.pitch_degrees, 0) / currentFacets.length
    if (avgPitch > 30) waste += 2
    if (avgPitch > 40) waste += 3
    
    return Math.min(waste, 20)
  }

  const saveMeasurement = async () => {
    if (!measurements) return

    setSaving(true)

    try {
      const response = await fetch('/api/measurements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          measurements,
          opportunityId,
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save measurement')
      }

      const { measurement } = await response.json()

      setShowSaveModal(false)
      
      // Redirect to proposal builder with measurement data
      const params = new URLSearchParams()
      if (opportunityId) {
        params.set('opportunity_id', opportunityId)
      }
      params.set('measurement_id', measurement.id)
      params.set('squares', measurements.total_squares.toFixed(1))
      params.set('customer_address', measurements.address)
      
      router.push(`/proposals/builder?${params.toString()}`)
    } catch (error: any) {
      console.error('Error saving measurement:', error)
      const errorMessage = error?.message || 'Unknown error'
      alert(`Failed to save measurement: ${errorMessage}`)
    } finally {
      setSaving(false)
    }
  }

  const clearAll = () => {
    if (!confirm('Clear all measurements?')) return
    
    polygonsRef.current.forEach(polygon => polygon.setMap(null))
    polygonsRef.current.clear()
    setFacets([])
    setMeasurements(null)
    setSelectedFacet(null)
  }

  // Show error page only for configuration errors (like missing API key)
  if (mapError && mapError.includes('API key')) {
    return (
      <div className="min-h-screen bg-gray-900">
        <Nav />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Map Configuration Error</h2>
            <p className="text-gray-400 mb-6">{mapError}</p>
            <div className="bg-gray-800 rounded-lg p-4 text-left text-sm">
              <p className="text-gray-300 font-medium mb-2">To fix this:</p>
              <ol className="list-decimal list-inside text-gray-400 space-y-2">
                <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">Google Cloud Console</a></li>
                <li>Create or select a project</li>
                <li>Enable the Maps JavaScript API, Geocoding API</li>
                <li>Create an API key under Credentials</li>
                <li>Add <code className="bg-gray-700 px-1 rounded">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_key</code> to your <code className="bg-gray-700 px-1 rounded">.env.local</code> file</li>
                <li>Restart the development server</li>
              </ol>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }
  
  // For other errors or loading state, render the full UI with overlays

  return (
    <div className="min-h-screen bg-gray-900">
      <Nav />
      
      <div className="flex h-[calc(100vh-64px)]">
        {/* Sidebar */}
        <div className="w-80 bg-gray-800 border-r border-gray-700 flex flex-col">
          {/* Address Search */}
          <div className="p-4 border-b border-gray-700">
            <label className="block text-sm font-medium text-gray-300 mb-2">Property Address</label>
            <div className="flex gap-2">
              <input
                ref={addressInputRef}
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchAddress()}
                placeholder="Start typing an address..."
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 text-sm"
                autoComplete="off"
              />
              <button
                onClick={() => searchAddress()}
                className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            </div>
            {searchedAddress && (
              <p className="mt-2 text-xs text-gray-400 truncate">{searchedAddress}</p>
            )}
          </div>

          {/* Drawing Tools */}
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-sm font-medium text-gray-300 mb-3">Drawing Tools</h3>
            <div className="flex gap-2">
              <button
                onClick={isDrawing ? stopDrawing : startDrawing}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition ${
                  isDrawing 
                    ? 'bg-red-600 text-white hover:bg-red-700' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                {isDrawing ? (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Draw Facet
                  </>
                )}
              </button>
              {facets.length > 0 && (
                <button
                  onClick={clearAll}
                  className="px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600"
                  title="Clear all"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Click to add points, close the shape to complete
            </p>
          </div>

          {/* Facets List */}
          <div className="flex-1 overflow-y-auto p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3">
              Roof Sections ({facets.length})
            </h3>
            {facets.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                </div>
                <p className="text-gray-500 text-sm">No sections drawn yet</p>
                <p className="text-gray-600 text-xs mt-1">Click "Draw Facet" to start</p>
              </div>
            ) : (
              <div className="space-y-2">
                {facets.map((facet, idx) => (
                  <div
                    key={facet.id}
                    onClick={() => setSelectedFacet(facet.id)}
                    className={`p-3 rounded-lg cursor-pointer transition ${
                      selectedFacet === facet.id 
                        ? 'bg-indigo-600/20 border border-indigo-500' 
                        : 'bg-gray-700/50 hover:bg-gray-700 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: facet.color }}
                        />
                        <span className="text-white font-medium text-sm">Section {idx + 1}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteFacet(facet.id)
                        }}
                        className="text-gray-500 hover:text-red-400"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500">Area:</span>
                        <span className="text-gray-300 ml-1">{(facet.area_sqft || 0).toLocaleString()} sqft</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Pitch:</span>
                        <span className="text-gray-300 ml-1">{facet.pitch}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Direction:</span>
                        <span className="text-gray-300 ml-1">{facet.orientation}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Squares:</span>
                        <span className="text-gray-300 ml-1">{(facet.area_sqft / 100).toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals */}
          {measurements && (
            <div className="p-4 border-t border-gray-700 bg-gray-800/50">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Total Measurements</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-white">
                    {measurements.total_squares.toFixed(1)}
                  </div>
                  <div className="text-xs text-gray-400">Squares</div>
                </div>
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-white">
                    {(measurements.total_area_sqft || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400">Sq Ft</div>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-xs text-gray-400">
                <div className="flex justify-between">
                  <span>Predominant Pitch:</span>
                  <span className="text-gray-300">{measurements.predominant_pitch}</span>
                </div>
                <div className="flex justify-between">
                  <span>Suggested Waste:</span>
                  <span className="text-gray-300">{measurements.suggested_waste}%</span>
                </div>
              </div>
              <button
                onClick={() => setShowSaveModal(true)}
                className="w-full mt-4 px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
              >
                Save Measurement
              </button>
            </div>
          )}
        </div>

        {/* Map */}
        <div className="flex-1 relative min-h-[400px]">
          {/* Map container - Google Maps will render here */}
          <div 
            ref={mapRef} 
            id="roof-measure-map"
            className="absolute inset-0 bg-gray-600"
            style={{ minHeight: '400px' }}
          />
          
          {/* Status overlay for debugging */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800/90">
              <div className="text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500 mx-auto mb-4" />
                <p className="text-white">Loading Google Maps...</p>
                <p className="text-gray-400 text-sm mt-2">If this takes too long, check the browser console</p>
              </div>
            </div>
          )}
          
          {/* Error overlay */}
          {mapError && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800/90 z-10">
              <div className="text-center max-w-md p-6">
                <div className="text-red-500 text-4xl mb-4">⚠️</div>
                <p className="text-white font-medium mb-2">Map Error</p>
                <p className="text-gray-400 text-sm mb-4">{mapError}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
          
          {/* Map Instructions Overlay */}
          {isDrawing && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded-lg text-sm">
              Click to add points. Click first point to close shape.
            </div>
          )}

          {/* Quick Actions */}
          <div className="absolute bottom-4 right-4 flex flex-col gap-2">
            <button
              onClick={() => googleMapRef.current?.setMapTypeId('satellite')}
              className="p-3 bg-gray-800 text-white rounded-lg shadow-lg hover:bg-gray-700"
              title="Satellite View"
            >
              🛰️
            </button>
            <button
              onClick={() => googleMapRef.current?.setMapTypeId('hybrid')}
              className="p-3 bg-gray-800 text-white rounded-lg shadow-lg hover:bg-gray-700"
              title="Hybrid View"
            >
              🗺️
            </button>
          </div>
        </div>
      </div>

      {/* Pitch Selection Modal */}
      {showPitchModal && pendingFacet && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl shadow-xl max-w-md w-full">
            <div className="p-6 border-b border-gray-700">
              <h2 className="text-xl font-bold text-white">Select Roof Pitch</h2>
              <p className="text-gray-400 text-sm mt-1">
                Base area: {pendingFacet.area_sqft?.toLocaleString()} sqft
              </p>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                {PITCH_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => confirmFacetPitch(option.value, option.degrees)}
                    className="p-3 bg-gray-700 hover:bg-indigo-600 rounded-lg text-center transition"
                  >
                    <div className="text-white font-medium">{option.value}</div>
                    <div className="text-xs text-gray-400">{option.degrees}°</div>
                  </button>
                ))}
              </div>
              <div className="mt-4 p-3 bg-blue-900/30 rounded-lg">
                <p className="text-xs text-blue-300">
                  <strong>Tip:</strong> The pitch affects the actual roof area. A 6/12 pitch adds ~12% to the flat area.
                </p>
              </div>
            </div>
            <div className="p-6 border-t border-gray-700 flex justify-end gap-3">
              <button
                onClick={cancelFacet}
                className="px-4 py-2 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Modal */}
      {showSaveModal && measurements && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">Measurement Summary</h2>
              <p className="text-gray-500 text-sm mt-1">{measurements.address}</p>
              <p className="text-indigo-600 text-sm mt-2 font-medium">Save to continue to proposal builder →</p>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-indigo-600">
                    {measurements.total_squares.toFixed(1)}
                  </div>
                  <div className="text-sm text-gray-500">Total Squares</div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-indigo-600">
                    {measurements.facets.length}
                  </div>
                  <div className="text-sm text-gray-500">Roof Sections</div>
                </div>
              </div>
              
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-500">Total Area</span>
                  <span className="font-medium text-gray-900">{(measurements.total_area_sqft || 0).toLocaleString()} sqft</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-500">Predominant Pitch</span>
                  <span className="font-medium text-gray-900">{measurements.predominant_pitch}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-500">Ridges</span>
                  <span className="font-medium text-gray-900">{measurements.ridges_lf} LF</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-500">Eaves</span>
                  <span className="font-medium text-gray-900">{measurements.eaves_lf} LF</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-gray-500">Suggested Waste</span>
                  <span className="font-medium text-gray-900">{measurements.suggested_waste}%</span>
                </div>
              </div>
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveMeasurement}
                disabled={saving}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save & Create Proposal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
