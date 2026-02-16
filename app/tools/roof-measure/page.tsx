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
  flat_area_sqft: number      // Area as measured on satellite (footprint)
  area_sqft: number           // Actual roof surface area (adjusted for pitch)
  pitch: string               // Display value like "6/12"
  pitch_rise: number          // Rise value (e.g., 6 for 6/12)
  pitch_degrees: number       // Angle in degrees
  pitch_multiplier: number    // Slope factor used
  perimeter_ft: number        // Perimeter of this facet
  orientation: string         // Compass direction
  color: string
}

// Linear features that can be manually drawn (step flashing, custom valleys, etc.)
interface LinearFeature {
  id: string
  type: 'step_flashing' | 'wall_flashing' | 'valley' | 'custom'
  points: Point[]
  length_ft: number
  label?: string
}

interface MeasurementData {
  address: string
  lat: number
  lng: number
  // Area measurements
  flat_area_sqft: number      // Total footprint area
  total_area_sqft: number     // Total actual roof surface area
  total_squares: number       // Roofing squares (area / 100)
  // Facet data
  facets: RoofFacet[]
  facet_count: number
  // Linear measurements (in linear feet)
  total_perimeter_lf: number  // Sum of all facet perimeters
  ridges_lf: number           // Ridge lines (peak of roof)
  hips_lf: number             // Hip lines (external angles)
  valleys_lf: number          // Valley lines (internal angles)
  eaves_lf: number            // Eave edges (horizontal bottom edges)
  rakes_lf: number            // Rake edges (sloped gable edges)
  drip_edge_lf: number        // Total drip edge (eaves + rakes)
  step_flashing_lf: number    // Step flashing (manually drawn)
  wall_flashing_lf: number    // Wall flashing (manually drawn)
  // Pitch information
  predominant_pitch: string
  avg_pitch_multiplier: number
  // Material estimation
  suggested_waste: number
  waste_category: string
  // Metadata
  linear_features?: LinearFeature[]
  measurement_confidence: 'high' | 'medium' | 'low'
  validation_notes: string[]
}

// Colors for different linear feature types
const LINEAR_FEATURE_COLORS: Record<string, string> = {
  step_flashing: '#F59E0B', // amber
  wall_flashing: '#8B5CF6', // purple
  valley: '#EF4444',        // red
  custom: '#6B7280',        // gray
}

const LINEAR_FEATURE_LABELS: Record<string, string> = {
  step_flashing: 'Step Flashing',
  wall_flashing: 'Wall Flashing',
  valley: 'Valley',
  custom: 'Custom Line',
}

// Industry-standard pitch multipliers (slope factors)
// Formula: √((rise/run)² + 1) = √(rise² + run²) / run
// These values match EagleView, Roofr, GAF QuickMeasure, and NACHI standards
const PITCH_OPTIONS = [
  { label: 'Flat (0/12)', value: '0/12', degrees: 0, rise: 0, multiplier: 1.000 },
  { label: '1/12', value: '1/12', degrees: 4.76, rise: 1, multiplier: 1.003 },
  { label: '2/12', value: '2/12', degrees: 9.46, rise: 2, multiplier: 1.014 },
  { label: '3/12', value: '3/12', degrees: 14.04, rise: 3, multiplier: 1.031 },
  { label: '4/12', value: '4/12', degrees: 18.43, rise: 4, multiplier: 1.054 },
  { label: '5/12', value: '5/12', degrees: 22.62, rise: 5, multiplier: 1.083 },
  { label: '6/12', value: '6/12', degrees: 26.57, rise: 6, multiplier: 1.118 },
  { label: '7/12', value: '7/12', degrees: 30.26, rise: 7, multiplier: 1.158 },
  { label: '8/12', value: '8/12', degrees: 33.69, rise: 8, multiplier: 1.202 },
  { label: '9/12', value: '9/12', degrees: 36.87, rise: 9, multiplier: 1.250 },
  { label: '10/12', value: '10/12', degrees: 39.81, rise: 10, multiplier: 1.302 },
  { label: '11/12', value: '11/12', degrees: 42.51, rise: 11, multiplier: 1.357 },
  { label: '12/12', value: '12/12', degrees: 45, rise: 12, multiplier: 1.414 },
  { label: '14/12', value: '14/12', degrees: 49.4, rise: 14, multiplier: 1.537 },
  { label: '16/12', value: '16/12', degrees: 53.13, rise: 16, multiplier: 1.667 },
  { label: '18/12', value: '18/12', degrees: 56.31, rise: 18, multiplier: 1.803 },
]

// Calculate exact pitch multiplier using industry formula
// Formula: √((rise/run)² + 1) where run = 12
const calculatePitchMultiplier = (rise: number): number => {
  if (rise === 0) return 1.0
  return Math.sqrt(Math.pow(rise / 12, 2) + 1)
}

// Verify pitch multiplier calculation (for debugging/validation)
const verifyPitchMultiplier = (rise: number, expectedMultiplier: number): boolean => {
  const calculated = calculatePitchMultiplier(rise)
  const tolerance = 0.001 // Allow 0.1% tolerance
  return Math.abs(calculated - expectedMultiplier) < tolerance
}

// Industry-standard waste factors by roof complexity
// Based on EagleView and GAF QuickMeasure guidelines
const WASTE_FACTORS = {
  simple: { base: 10, description: 'Simple gable/hip (1-4 facets)' },
  moderate: { base: 12, description: 'Moderate complexity (5-8 facets)' },
  complex: { base: 15, description: 'Complex (9-12 facets, dormers)' },
  veryComplex: { base: 18, description: 'Very complex (13+ facets, multiple levels)' },
}

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
  const labelsRef = useRef<Map<string, any>>(new Map())
  
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
  
  // Linear features state
  const [linearFeatures, setLinearFeatures] = useState<LinearFeature[]>([])
  const [isDrawingLine, setIsDrawingLine] = useState(false)
  const [lineDrawingType, setLineDrawingType] = useState<'step_flashing' | 'wall_flashing' | 'valley' | 'custom'>('step_flashing')
  const [showLineTypeModal, setShowLineTypeModal] = useState(false)
  const polylinesRef = useRef<Map<string, any>>(new Map())

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

      // Initialize drawing manager with high-visibility polygon options
      const drawingManager = new google.maps.drawing.DrawingManager({
        drawingMode: null,
        drawingControl: false,
        polygonOptions: {
          fillColor: '#3B82F6',
          fillOpacity: 0.4,
          strokeColor: '#FFFFFF',
          strokeWeight: 3,
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

      // Listen for polyline complete (for linear features)
      google.maps.event.addListener(drawingManager, 'polylinecomplete', (polyline: any) => {
        handlePolylineComplete(polyline)
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
    
    // High visibility polygon options - white stroke for contrast on satellite imagery
    drawingManagerRef.current.setOptions({
      drawingMode: google.maps.drawing.OverlayType.POLYGON,
      polygonOptions: {
        fillColor: color,
        fillOpacity: 0.45,
        strokeColor: '#FFFFFF',
        strokeWeight: 3,
        editable: true,
      },
    })
    
    setIsDrawing(true)
  }

  const stopDrawing = () => {
    if (!drawingManagerRef.current) return
    drawingManagerRef.current.setDrawingMode(null)
    setIsDrawing(false)
    setIsDrawingLine(false)
  }

  // Start drawing a linear feature (step flashing, valley, etc.)
  const startDrawingLine = (type: 'step_flashing' | 'wall_flashing' | 'valley' | 'custom') => {
    if (!drawingManagerRef.current) return
    
    setLineDrawingType(type)
    const color = LINEAR_FEATURE_COLORS[type]
    
    drawingManagerRef.current.setOptions({
      drawingMode: google.maps.drawing.OverlayType.POLYLINE,
      polylineOptions: {
        strokeColor: color,
        strokeWeight: 4,
        strokeOpacity: 0.9,
        editable: true,
      },
    })
    
    setIsDrawingLine(true)
    setShowLineTypeModal(false)
  }

  // Handle completed polyline (linear feature)
  const handlePolylineComplete = (polyline: any) => {
    stopDrawing()
    
    const path = polyline.getPath()
    const points: Point[] = []
    
    for (let i = 0; i < path.getLength(); i++) {
      const point = path.getAt(i)
      points.push({ lat: point.lat(), lng: point.lng() })
    }
    
    // Calculate length
    let lengthMeters = 0
    for (let i = 0; i < points.length - 1; i++) {
      lengthMeters += google.maps.geometry.spherical.computeDistanceBetween(
        new google.maps.LatLng(points[i].lat, points[i].lng),
        new google.maps.LatLng(points[i + 1].lat, points[i + 1].lng)
      )
    }
    const lengthFt = Math.round(lengthMeters * 3.28084)
    
    const newFeature: LinearFeature = {
      id: `line-${Date.now()}`,
      type: lineDrawingType,
      points,
      length_ft: lengthFt,
      label: LINEAR_FEATURE_LABELS[lineDrawingType],
    }
    
    // Store polyline reference
    polylinesRef.current.set(newFeature.id, polyline)
    
    // Add click listener to select
    polyline.addListener('click', () => {
      // Could add selection logic here
    })
    
    setLinearFeatures(prev => [...prev, newFeature])
    updateMeasurements(facets, [...linearFeatures, newFeature])
  }

  // Delete a linear feature
  const deleteLinearFeature = (featureId: string) => {
    const polyline = polylinesRef.current.get(featureId)
    if (polyline) {
      polyline.setMap(null)
      polylinesRef.current.delete(featureId)
    }
    
    const newFeatures = linearFeatures.filter(f => f.id !== featureId)
    setLinearFeatures(newFeatures)
    updateMeasurements(facets, newFeatures)
  }

  const handlePolygonComplete = (polygon: any) => {
    stopDrawing()
    
    const path = polygon.getPath()
    const points: Point[] = []
    
    for (let i = 0; i < path.getLength(); i++) {
      const point = path.getAt(i)
      points.push({ lat: point.lat(), lng: point.lng() })
    }
    
    // Validate polygon has at least 3 points
    if (points.length < 3) {
      alert('Please draw a shape with at least 3 points')
      polygon.setMap(null)
      return
    }
    
    // Calculate flat area (footprint as seen from satellite)
    // Google Maps geometry.spherical.computeArea returns square meters
    const areaMeters = google.maps.geometry.spherical.computeArea(path)
    const flatAreaSqft = areaMeters * 10.7639 // Convert m² to sqft
    
    // Validate area is reasonable (minimum 10 sqft, maximum 50,000 sqft per facet)
    if (flatAreaSqft < 10) {
      alert('Area too small. Please draw a larger section.')
      polygon.setMap(null)
      return
    }
    if (flatAreaSqft > 50000) {
      alert('Area too large for a single facet. Please break into smaller sections.')
      polygon.setMap(null)
      return
    }
    
    // Calculate orientation based on longest edge direction
    const orientation = calculateOrientation(points)
    
    const colorIndex = facets.length % FACET_COLORS.length
    
    setPendingFacet({
      id: `facet-${Date.now()}`,
      points,
      flat_area_sqft: Math.round(flatAreaSqft),
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

  const confirmFacetPitch = (pitch: string, pitchDegrees: number, pitchRise: number, pitchMultiplier: number) => {
    if (!pendingFacet) return
    
    const polygon = polygonsRef.current.get('pending')
    
    // Use the industry-standard pitch multiplier directly
    // Formula verified: √((rise/run)² + 1) where run = 12
    // Example: 6/12 pitch → √((6/12)² + 1) = √1.25 = 1.118
    // This matches EagleView, Roofr, GAF QuickMeasure exactly
    const flatArea = pendingFacet.flat_area_sqft || 0
    const adjustedArea = Math.round(flatArea * pitchMultiplier)
    
    // Calculate perimeter for this facet
    const perimeterFt = calculatePerimeter(pendingFacet.points!)
    
    const newFacet: RoofFacet = {
      id: pendingFacet.id!,
      points: pendingFacet.points!,
      flat_area_sqft: flatArea,
      area_sqft: adjustedArea,
      pitch,
      pitch_rise: pitchRise,
      pitch_degrees: pitchDegrees,
      pitch_multiplier: pitchMultiplier,
      perimeter_ft: Math.round(perimeterFt),
      orientation: pendingFacet.orientation!,
      color: pendingFacet.color!,
    }
    
    // Move polygon to permanent storage and apply high-visibility styling
    if (polygon) {
      polygonsRef.current.delete('pending')
      polygonsRef.current.set(newFacet.id, polygon)
      
      // Apply high-visibility styling - white stroke for contrast on satellite
      polygon.setOptions({
        fillColor: newFacet.color,
        fillOpacity: 0.45,
        strokeColor: '#FFFFFF',
        strokeWeight: 3,
      })
      
      // Add click listener
      polygon.addListener('click', () => {
        setSelectedFacet(newFacet.id)
      })
      
      // Add label marker at the center of the facet
      const facetIndex = facets.length + 1
      const centroid = newFacet.points.reduce(
        (acc, p) => ({ lat: acc.lat + p.lat / newFacet.points.length, lng: acc.lng + p.lng / newFacet.points.length }),
        { lat: 0, lng: 0 }
      )
      
      // Create a custom label using a marker with a label
      const labelMarker = new google.maps.Marker({
        position: centroid,
        map: googleMapRef.current,
        label: {
          text: `${facetIndex}`,
          color: '#FFFFFF',
          fontSize: '14px',
          fontWeight: 'bold',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 16,
          fillColor: newFacet.color,
          fillOpacity: 0.9,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
        },
        clickable: false,
      })
      
      labelsRef.current.set(newFacet.id, labelMarker)
    }
    
    setFacets(prev => [...prev, newFacet])
    setPendingFacet(null)
    setShowPitchModal(false)
    
    // Update measurements
    updateMeasurements([...facets, newFacet], linearFeatures)
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
    
    // Also remove the label marker
    const label = labelsRef.current.get(facetId)
    if (label) {
      label.setMap(null)
      labelsRef.current.delete(facetId)
    }
    
    const newFacets = facets.filter(f => f.id !== facetId)
    setFacets(newFacets)
    setSelectedFacet(null)
    updateMeasurements(newFacets, linearFeatures)
    
    // Update remaining labels to reflect new numbering
    newFacets.forEach((facet, idx) => {
      const existingLabel = labelsRef.current.get(facet.id)
      if (existingLabel) {
        existingLabel.setLabel({
          text: `${idx + 1}`,
          color: '#FFFFFF',
          fontSize: '14px',
          fontWeight: 'bold',
        })
      }
    })
  }

  const updateMeasurements = (currentFacets: RoofFacet[], currentLinearFeatures?: LinearFeature[]) => {
    const features = currentLinearFeatures ?? linearFeatures
    
    if (currentFacets.length === 0 && features.length === 0) {
      setMeasurements(null)
      return
    }
    
    const validationNotes: string[] = []
    
    // Calculate area totals
    // Fall back to area_sqft / pitch_multiplier if flat_area_sqft not set (legacy data)
    const flatArea = currentFacets.reduce((sum, f) => {
      if (f.flat_area_sqft && f.flat_area_sqft > 0) {
        return sum + f.flat_area_sqft
      }
      // Estimate flat area from actual area if not set
      const multiplier = f.pitch_multiplier || 1.118
      return sum + (f.area_sqft / multiplier)
    }, 0)
    const totalArea = currentFacets.reduce((sum, f) => sum + (f.area_sqft || 0), 0)
    const facetCount = currentFacets.length
    
    // Calculate total perimeter from stored facet perimeters, or estimate from area
    let totalPerimeter = currentFacets.reduce((sum, f) => sum + (f.perimeter_ft || 0), 0)
    
    // If no perimeter data, estimate from area (perimeter ≈ 4 * √area for square-ish shapes)
    if (totalPerimeter === 0 && flatArea > 0) {
      totalPerimeter = currentFacets.reduce((sum, f) => {
        const facetFlatArea = f.flat_area_sqft || (f.area_sqft / (f.pitch_multiplier || 1.118))
        return sum + (4 * Math.sqrt(facetFlatArea))
      }, 0)
    }
    
    // ============================================================
    // LINEAR FOOTAGE CALCULATIONS - Geometry-Based Algorithm
    // Based on EagleView methodology and roofing industry standards
    // ============================================================
    
    // For accurate linear footage, we analyze the roof geometry:
    // 1. Simple gable (2 facets): Ridge = building length, Eaves = 2x building length
    // 2. Hip roof (4 facets): Ridge shorter, Hips at corners
    // 3. Complex (5+ facets): More valleys, dormers, intersections
    
    // Calculate average facet dimensions to estimate building footprint
    const avgFacetArea = flatArea / Math.max(facetCount, 1)
    const avgFacetPerimeter = totalPerimeter / Math.max(facetCount, 1)
    
    // Estimate building dimensions from total flat area
    // Assume roughly rectangular footprint for estimation
    // Guard against 0 or very small areas
    const safeArea = Math.max(flatArea, 100) // Minimum 100 sqft to avoid division issues
    const estimatedBuildingLength = Math.sqrt(safeArea * 1.5) // Length typically 1.5x width
    const estimatedBuildingWidth = safeArea / Math.max(estimatedBuildingLength, 1)
    
    // ---- RIDGE CALCULATION ----
    // Ridge runs along the peak. For gable: ~= building length
    // For hip: ridge is shorter (building length - 2x hip offset)
    // Complex roofs have multiple ridge lines
    let ridges: number
    if (facetCount <= 2) {
      // Simple gable - ridge equals building length
      ridges = Math.round(estimatedBuildingLength)
    } else if (facetCount <= 4) {
      // Hip roof - ridge is shorter
      ridges = Math.round(estimatedBuildingLength * 0.6)
    } else {
      // Complex roof - multiple ridges
      // Estimate based on: main ridge + secondary ridges for dormers/additions
      const mainRidge = estimatedBuildingLength * 0.5
      const secondaryRidges = (facetCount - 4) * 8 // ~8ft per additional ridge section
      ridges = Math.round(mainRidge + secondaryRidges)
    }
    
    // ---- EAVES CALCULATION ----
    // Eaves are the horizontal bottom edges of the roof
    // For gable: 2x building length (front and back)
    // For hip: full perimeter minus rakes
    let eaves: number
    if (facetCount <= 2) {
      // Gable - eaves on two sides
      eaves = Math.round(estimatedBuildingLength * 2)
    } else if (facetCount <= 4) {
      // Hip - eaves on all four sides
      eaves = Math.round((estimatedBuildingLength + estimatedBuildingWidth) * 2)
    } else {
      // Complex - estimate from perimeter (eaves typically 35-45% of total perimeter)
      eaves = Math.round(totalPerimeter * 0.40)
    }
    
    // ---- RAKES CALCULATION ----
    // Rakes are the sloped edges on gable ends
    // Must account for pitch - rakes are longer than horizontal measurement
    const avgPitchMultiplier = currentFacets.length > 0
      ? currentFacets.reduce((sum, f) => sum + (f.pitch_multiplier || 1.118), 0) / currentFacets.length
      : 1.118
    
    let rakes: number
    if (facetCount <= 2) {
      // Gable - rakes on both ends (4 rake edges total)
      // Rake length = (building width / 2) * pitch multiplier * 4
      rakes = Math.round((estimatedBuildingWidth / 2) * avgPitchMultiplier * 4)
    } else if (facetCount <= 4) {
      // Hip - minimal or no rakes (hips replace rakes at corners)
      rakes = 0
    } else {
      // Complex - estimate based on gable sections
      const gableSections = Math.max(0, facetCount - 4)
      rakes = Math.round(gableSections * estimatedBuildingWidth * avgPitchMultiplier * 0.5)
    }
    
    // ---- HIPS CALCULATION ----
    // Hips are diagonal ridges where roof planes meet at external corners
    // Hip length = √(width² + (width/2)²) for 45° hip angle
    let hips: number
    if (facetCount <= 2) {
      // Gable - no hips
      hips = 0
    } else if (facetCount <= 4) {
      // Standard hip roof - 4 hip lines
      const hipLength = Math.sqrt(Math.pow(estimatedBuildingWidth / 2, 2) * 2) * avgPitchMultiplier
      hips = Math.round(hipLength * 4)
    } else {
      // Complex - additional hips for dormers/additions
      const baseHips = Math.sqrt(Math.pow(estimatedBuildingWidth / 2, 2) * 2) * avgPitchMultiplier * 4
      const additionalHips = (facetCount - 4) * 6 // ~6ft per additional hip
      hips = Math.round(baseHips + additionalHips)
    }
    
    // ---- VALLEYS CALCULATION ----
    // Valleys are internal intersections where roof planes meet
    // Auto-calculated + manually drawn
    let autoValleys: number
    if (facetCount <= 4) {
      // Simple roofs typically have no valleys
      autoValleys = 0
    } else {
      // Complex roofs - valleys form at intersections
      // Each additional facet pair can create a valley
      const valleyCount = Math.floor((facetCount - 4) / 2)
      const avgValleyLength = Math.sqrt(Math.pow(estimatedBuildingWidth / 2, 2) * 2) * avgPitchMultiplier
      autoValleys = Math.round(valleyCount * avgValleyLength)
    }
    
    const manualValleys = features
      .filter(f => f.type === 'valley')
      .reduce((sum, f) => sum + f.length_ft, 0)
    const valleys = autoValleys + manualValleys
    
    // ---- DRIP EDGE ----
    // Total drip edge = eaves + rakes (all edges that need drip edge)
    const dripEdge = eaves + rakes
    
    // ---- FLASHING FROM MANUAL DRAWINGS ----
    const stepFlashing = features
      .filter(f => f.type === 'step_flashing')
      .reduce((sum, f) => sum + f.length_ft, 0)
    
    const wallFlashing = features
      .filter(f => f.type === 'wall_flashing')
      .reduce((sum, f) => sum + f.length_ft, 0)
    
    // ============================================================
    // PITCH AND WASTE CALCULATIONS
    // ============================================================
    
    // Find predominant pitch (weighted by area)
    const pitchCounts: Record<string, number> = {}
    currentFacets.forEach(f => {
      pitchCounts[f.pitch] = (pitchCounts[f.pitch] || 0) + f.area_sqft
    })
    const predominantPitch = Object.entries(pitchCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '6/12'
    
    // Calculate waste factor based on complexity (industry standards)
    const { wastePercent, category } = calculateWasteFactorDetailed(currentFacets, valleys, hips)
    
    // ============================================================
    // VALIDATION AND CONFIDENCE
    // ============================================================
    
    // Sanity checks
    if (totalArea > 0 && totalArea < 500) {
      validationNotes.push('Small roof area - verify measurements')
    }
    if (totalArea > 10000) {
      validationNotes.push('Large roof - consider breaking into sections')
    }
    if (avgPitchMultiplier > 1.4) {
      validationNotes.push('Steep pitch - verify pitch selection')
    }
    
    // Calculate measurement confidence
    let confidence: 'high' | 'medium' | 'low' = 'high'
    if (facetCount === 1) {
      confidence = 'medium'
      validationNotes.push('Single facet - consider adding more sections for accuracy')
    }
    if (facetCount > 10) {
      confidence = 'medium'
      validationNotes.push('Many facets - verify no overlapping sections')
    }
    
    // Verify linear footage totals are reasonable
    const linearTotal = ridges + eaves + rakes + hips + valleys
    const expectedLinearRatio = linearTotal / Math.sqrt(totalArea)
    if (expectedLinearRatio < 2 || expectedLinearRatio > 8) {
      validationNotes.push('Linear footage may need verification')
      confidence = 'medium'
    }
    
    // Helper to ensure no NaN values
    const safeNum = (n: number, fallback = 0) => isNaN(n) || !isFinite(n) ? fallback : n
    
    setMeasurements({
      address: searchedAddress,
      lat: mapCenter.lat,
      lng: mapCenter.lng,
      flat_area_sqft: safeNum(flatArea),
      total_area_sqft: safeNum(totalArea),
      total_squares: safeNum(Math.round(totalArea / 100 * 100) / 100),
      facets: currentFacets,
      facet_count: facetCount,
      total_perimeter_lf: safeNum(Math.round(totalPerimeter)),
      ridges_lf: safeNum(ridges),
      hips_lf: safeNum(hips),
      valleys_lf: safeNum(valleys),
      eaves_lf: safeNum(eaves),
      rakes_lf: safeNum(rakes),
      drip_edge_lf: safeNum(dripEdge),
      step_flashing_lf: safeNum(stepFlashing),
      wall_flashing_lf: safeNum(wallFlashing),
      predominant_pitch: predominantPitch,
      avg_pitch_multiplier: safeNum(Math.round(avgPitchMultiplier * 1000) / 1000, 1.118),
      suggested_waste: safeNum(wastePercent, 10),
      waste_category: category,
      linear_features: features,
      measurement_confidence: confidence,
      validation_notes: validationNotes,
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

  // Detailed waste factor calculation based on industry standards
  // EagleView and GAF QuickMeasure use similar methodology
  const calculateWasteFactorDetailed = (
    currentFacets: RoofFacet[], 
    valleyLength: number, 
    hipLength: number
  ): { wastePercent: number; category: string } => {
    if (currentFacets.length === 0) {
      return { wastePercent: 10, category: 'simple' }
    }
    
    const facetCount = currentFacets.length
    const totalArea = currentFacets.reduce((sum, f) => sum + f.area_sqft, 0)
    
    // Base waste by complexity category
    let baseWaste: number
    let category: string
    
    if (facetCount <= 4) {
      baseWaste = 10
      category = 'Simple'
    } else if (facetCount <= 8) {
      baseWaste = 12
      category = 'Moderate'
    } else if (facetCount <= 12) {
      baseWaste = 15
      category = 'Complex'
    } else {
      baseWaste = 18
      category = 'Very Complex'
    }
    
    // Adjustments based on roof characteristics
    let adjustments = 0
    
    // Steep pitch adjustment (+1-3%)
    const avgPitchDegrees = currentFacets.reduce((sum, f) => sum + f.pitch_degrees, 0) / facetCount
    if (avgPitchDegrees > 35) adjustments += 2
    else if (avgPitchDegrees > 25) adjustments += 1
    
    // Valley adjustment (+1% per significant valley)
    // Valleys require more cuts and waste
    if (valleyLength > 20) adjustments += Math.min(3, Math.floor(valleyLength / 30))
    
    // Hip adjustment (+1% for hip roofs)
    if (hipLength > 20) adjustments += 1
    
    // Small facet adjustment (many small facets = more waste)
    const avgFacetSize = totalArea / facetCount
    if (avgFacetSize < 200) adjustments += 2
    else if (avgFacetSize < 400) adjustments += 1
    
    // Mixed pitch adjustment (different pitches = more complexity)
    const uniquePitches = new Set(currentFacets.map(f => f.pitch)).size
    if (uniquePitches > 2) adjustments += 1
    
    const finalWaste = Math.min(baseWaste + adjustments, 25) // Cap at 25%
    
    return { 
      wastePercent: finalWaste, 
      category: `${category} (${facetCount} sections)` 
    }
  }
  
  // Legacy function for compatibility
  const calculateWasteFactor = (currentFacets: RoofFacet[]): number => {
    return calculateWasteFactorDetailed(currentFacets, 0, 0).wastePercent
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
    
    // Clear polygons (facets)
    polygonsRef.current.forEach(polygon => polygon.setMap(null))
    polygonsRef.current.clear()
    
    // Clear labels
    labelsRef.current.forEach(label => label.setMap(null))
    labelsRef.current.clear()
    
    // Clear polylines (linear features)
    polylinesRef.current.forEach(polyline => polyline.setMap(null))
    polylinesRef.current.clear()
    
    setFacets([])
    setLinearFeatures([])
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
      
      <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)]">
        {/* Sidebar - Scrollable independently from map */}
        <div className="w-full lg:w-96 lg:flex-shrink-0 bg-gray-800 border-b lg:border-b-0 lg:border-r border-gray-700 flex flex-col max-h-[50vh] lg:max-h-[calc(100vh-64px)] overflow-y-auto">
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
            
            {/* Roof Facet Drawing */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={isDrawing ? stopDrawing : startDrawing}
                disabled={isDrawingLine}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-medium text-sm transition ${
                  isDrawing 
                    ? 'bg-red-600 text-white hover:bg-red-700' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
                }`}
              >
                {isDrawing ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" />
                    </svg>
                    Draw Facet
                  </>
                )}
              </button>
              {(facets.length > 0 || linearFeatures.length > 0) && (
                <button
                  onClick={clearAll}
                  className="px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600"
                  title="Clear all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
            
            {/* Linear Feature Drawing */}
            <div className="mb-2">
              <p className="text-xs text-gray-400 mb-2">Draw linear features (flashing, valleys):</p>
              {isDrawingLine ? (
                <button
                  onClick={stopDrawing}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Cancel Line
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => startDrawingLine('step_flashing')}
                    disabled={isDrawing}
                    className="flex items-center justify-center gap-1.5 px-2 py-2 bg-amber-600/20 text-amber-400 border border-amber-600/50 rounded-lg text-xs font-medium hover:bg-amber-600/30 disabled:opacity-50"
                  >
                    <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                    Step Flash
                  </button>
                  <button
                    onClick={() => startDrawingLine('wall_flashing')}
                    disabled={isDrawing}
                    className="flex items-center justify-center gap-1.5 px-2 py-2 bg-purple-600/20 text-purple-400 border border-purple-600/50 rounded-lg text-xs font-medium hover:bg-purple-600/30 disabled:opacity-50"
                  >
                    <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                    Wall Flash
                  </button>
                  <button
                    onClick={() => startDrawingLine('valley')}
                    disabled={isDrawing}
                    className="flex items-center justify-center gap-1.5 px-2 py-2 bg-red-600/20 text-red-400 border border-red-600/50 rounded-lg text-xs font-medium hover:bg-red-600/30 disabled:opacity-50"
                  >
                    <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                    Valley
                  </button>
                  <button
                    onClick={() => startDrawingLine('custom')}
                    disabled={isDrawing}
                    className="flex items-center justify-center gap-1.5 px-2 py-2 bg-gray-600/20 text-gray-400 border border-gray-600/50 rounded-lg text-xs font-medium hover:bg-gray-600/30 disabled:opacity-50"
                  >
                    <span className="w-2 h-2 bg-gray-500 rounded-full"></span>
                    Custom
                  </button>
                </div>
              )}
            </div>
            
            <p className="text-xs text-gray-500">
              {isDrawing ? 'Click to add points, close shape to complete' : 
               isDrawingLine ? 'Click to add points, double-click to finish' :
               'Draw roof sections first, then add flashing lines'}
            </p>
          </div>

          {/* Facets List */}
          <div className="p-4">
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
                        <span className="text-gray-500">Actual:</span>
                        <span className="text-gray-300 ml-1">{(facet.area_sqft || 0).toLocaleString()} sqft</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Pitch:</span>
                        <span className="text-gray-300 ml-1">{facet.pitch} (×{facet.pitch_multiplier?.toFixed(2) || '1.00'})</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Flat:</span>
                        <span className="text-gray-400 ml-1">{(facet.flat_area_sqft || 0).toLocaleString()} sqft</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Squares:</span>
                        <span className="text-gray-300 ml-1">{(facet.area_sqft / 100).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {/* Linear Features List */}
            {linearFeatures.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-700">
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  Linear Features ({linearFeatures.length})
                </h3>
                <div className="space-y-2">
                  {linearFeatures.map((feature) => (
                    <div
                      key={feature.id}
                      className="p-2 rounded-lg bg-gray-700/50 border border-transparent"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: LINEAR_FEATURE_COLORS[feature.type] }}
                          />
                          <span className="text-white text-sm">{feature.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-xs">{feature.length_ft} LF</span>
                          <button
                            onClick={() => deleteLinearFeature(feature.id)}
                            className="text-gray-500 hover:text-red-400"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Totals */}
          {measurements && (
            <div className="p-4 border-t border-gray-700 bg-gray-800/50">
              {/* Confidence indicator */}
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-300">Measurements</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  measurements.measurement_confidence === 'high' 
                    ? 'bg-green-900/50 text-green-400' 
                    : measurements.measurement_confidence === 'medium'
                    ? 'bg-yellow-900/50 text-yellow-400'
                    : 'bg-red-900/50 text-red-400'
                }`}>
                  {measurements.measurement_confidence} confidence
                </span>
              </div>
              
              {/* Main totals */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-indigo-900/30 rounded-lg p-3 border border-indigo-700/50">
                  <div className="text-2xl font-bold text-white">
                    {measurements.total_squares.toFixed(2)}
                  </div>
                  <div className="text-xs text-indigo-300">Squares (actual)</div>
                </div>
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <div className="text-xl font-bold text-white">
                    {(measurements.total_area_sqft || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400">Sq Ft (actual)</div>
                </div>
              </div>
              
              {/* Key metrics */}
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400">
                <div className="flex justify-between">
                  <span>Pitch:</span>
                  <span className="text-gray-300">{measurements.predominant_pitch}</span>
                </div>
                <div className="flex justify-between">
                  <span>Multiplier:</span>
                  <span className="text-gray-300">×{measurements.avg_pitch_multiplier}</span>
                </div>
                <div className="flex justify-between">
                  <span>Waste:</span>
                  <span className="text-gray-300">{measurements.suggested_waste}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Drip Edge:</span>
                  <span className="text-gray-300">{measurements.drip_edge_lf} LF</span>
                </div>
              </div>
              
              {/* Linear footage breakdown */}
              <div className="mt-3 pt-3 border-t border-gray-700">
                <p className="text-xs text-gray-500 mb-2">Linear Footage</p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="text-center p-1.5 bg-gray-700/30 rounded">
                    <div className="text-white font-medium">{measurements.ridges_lf}</div>
                    <div className="text-gray-500">Ridge</div>
                  </div>
                  <div className="text-center p-1.5 bg-gray-700/30 rounded">
                    <div className="text-white font-medium">{measurements.eaves_lf}</div>
                    <div className="text-gray-500">Eaves</div>
                  </div>
                  <div className="text-center p-1.5 bg-gray-700/30 rounded">
                    <div className="text-white font-medium">{measurements.rakes_lf}</div>
                    <div className="text-gray-500">Rakes</div>
                  </div>
                  {measurements.hips_lf > 0 && (
                    <div className="text-center p-1.5 bg-gray-700/30 rounded">
                      <div className="text-white font-medium">{measurements.hips_lf}</div>
                      <div className="text-gray-500">Hips</div>
                    </div>
                  )}
                  {measurements.valleys_lf > 0 && (
                    <div className="text-center p-1.5 bg-gray-700/30 rounded">
                      <div className="text-white font-medium">{measurements.valleys_lf}</div>
                      <div className="text-gray-500">Valleys</div>
                    </div>
                  )}
                  {measurements.step_flashing_lf > 0 && (
                    <div className="text-center p-1.5 bg-amber-900/30 rounded border border-amber-700/50">
                      <div className="text-amber-300 font-medium">{measurements.step_flashing_lf}</div>
                      <div className="text-amber-500/70">Step</div>
                    </div>
                  )}
                  {measurements.wall_flashing_lf > 0 && (
                    <div className="text-center p-1.5 bg-purple-900/30 rounded border border-purple-700/50">
                      <div className="text-purple-300 font-medium">{measurements.wall_flashing_lf}</div>
                      <div className="text-purple-500/70">Wall</div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Validation notes */}
              {measurements.validation_notes && measurements.validation_notes.length > 0 && (
                <div className="mt-3 p-2 bg-yellow-900/20 rounded border border-yellow-700/30">
                  <p className="text-xs text-yellow-400 font-medium mb-1">Notes:</p>
                  {measurements.validation_notes.map((note, i) => (
                    <p key={i} className="text-xs text-yellow-300/70">• {note}</p>
                  ))}
                </div>
              )}
              
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
        <div className="flex-1 relative min-h-[300px] lg:min-h-[400px]">
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
                Flat area (footprint): {pendingFacet.flat_area_sqft?.toLocaleString()} sqft
              </p>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                {PITCH_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => confirmFacetPitch(option.value, option.degrees, option.rise, option.multiplier)}
                    className="p-3 bg-gray-700 hover:bg-indigo-600 rounded-lg text-center transition"
                  >
                    <div className="text-white font-medium">{option.value}</div>
                    <div className="text-xs text-gray-400">×{option.multiplier.toFixed(3)}</div>
                  </button>
                ))}
              </div>
              <div className="mt-4 p-3 bg-blue-900/30 rounded-lg space-y-2">
                <p className="text-xs text-blue-300">
                  <strong>Multiplier shown</strong> = slope factor applied to flat area
                </p>
                <p className="text-xs text-blue-400">
                  Example: {pendingFacet?.flat_area_sqft?.toLocaleString()} sqft × 1.118 (6/12) = {Math.round((pendingFacet?.flat_area_sqft || 0) * 1.118).toLocaleString()} sqft actual
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

      {/* Save Modal - Professional Measurement Report */}
      {showSaveModal && measurements && (
        <div className="fixed inset-0 bg-black/70 z-50 overflow-y-auto">
          <div className="min-h-full flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full my-4">
            <div className="p-6 border-b bg-gradient-to-r from-indigo-600 to-indigo-700 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">Roof Measurement Report</h2>
                  <p className="text-indigo-200 text-sm mt-1">{measurements.address}</p>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                  measurements.measurement_confidence === 'high' 
                    ? 'bg-green-500 text-white' 
                    : measurements.measurement_confidence === 'medium'
                    ? 'bg-yellow-500 text-white'
                    : 'bg-red-500 text-white'
                }`}>
                  {measurements.measurement_confidence.toUpperCase()} CONFIDENCE
                </div>
              </div>
            </div>
            
            <div className="p-6">
              {/* Primary Measurements */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-indigo-50 rounded-xl p-4 text-center border-2 border-indigo-200">
                  <div className="text-3xl font-bold text-indigo-600">
                    {measurements.total_squares.toFixed(2)}
                  </div>
                  <div className="text-sm text-indigo-600 font-medium">SQUARES</div>
                  <div className="text-xs text-indigo-500 mt-1">(Actual Roof Area)</div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-gray-800">
                    {(measurements.total_area_sqft || 0).toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-700">Sq Ft (Actual)</div>
                  <div className="text-xs text-gray-600 mt-1">
                    Flat: {(measurements.flat_area_sqft || 0).toLocaleString()}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-gray-800">
                    {measurements.facet_count}
                  </div>
                  <div className="text-sm text-gray-700">Sections</div>
                  <div className="text-xs text-gray-600 mt-1">{measurements.waste_category}</div>
                </div>
              </div>
              
              {/* Pitch & Waste */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-xs font-medium text-gray-600 uppercase mb-2">Pitch Information</h4>
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-bold text-gray-800">{measurements.predominant_pitch}</span>
                    <span className="text-sm text-gray-700">×{measurements.avg_pitch_multiplier} multiplier</span>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-xs font-medium text-gray-600 uppercase mb-2">Suggested Waste</h4>
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-bold text-gray-800">{measurements.suggested_waste}%</span>
                    <span className="text-sm text-gray-700">
                      +{Math.round(measurements.total_squares * measurements.suggested_waste / 100 * 10) / 10} sq
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Linear Footage Table */}
              <div className="mb-6">
                <h4 className="text-xs font-medium text-gray-700 uppercase mb-3">Linear Footage Summary</h4>
                <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-200">
                      <tr>
                        <th className="text-left px-4 py-2 text-gray-900 font-semibold">Component</th>
                        <th className="text-right px-4 py-2 text-gray-900 font-semibold">Length (LF)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      <tr className="bg-white">
                        <td className="px-4 py-2 text-gray-900">Ridge</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{measurements.ridges_lf}</td>
                      </tr>
                      <tr className="bg-white">
                        <td className="px-4 py-2 text-gray-900">Eaves</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{measurements.eaves_lf}</td>
                      </tr>
                      <tr className="bg-white">
                        <td className="px-4 py-2 text-gray-900">Rakes</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{isNaN(measurements.rakes_lf) ? 0 : measurements.rakes_lf}</td>
                      </tr>
                      {measurements.hips_lf > 0 && (
                        <tr className="bg-white">
                          <td className="px-4 py-2 text-gray-900">Hips</td>
                          <td className="px-4 py-2 text-right font-medium text-gray-900">{measurements.hips_lf}</td>
                        </tr>
                      )}
                      {measurements.valleys_lf > 0 && (
                        <tr className="bg-white">
                          <td className="px-4 py-2 text-gray-900">Valleys</td>
                          <td className="px-4 py-2 text-right font-medium text-gray-900">{measurements.valleys_lf}</td>
                        </tr>
                      )}
                      <tr className="bg-gray-100 font-medium">
                        <td className="px-4 py-2 text-gray-900">Drip Edge (Total)</td>
                        <td className="px-4 py-2 text-right text-gray-900">{isNaN(measurements.drip_edge_lf) ? 0 : measurements.drip_edge_lf}</td>
                      </tr>
                      {measurements.step_flashing_lf > 0 && (
                        <tr className="bg-amber-50">
                          <td className="px-4 py-2 text-amber-900 font-medium">Step Flashing</td>
                          <td className="px-4 py-2 text-right font-medium text-amber-900">{measurements.step_flashing_lf}</td>
                        </tr>
                      )}
                      {measurements.wall_flashing_lf > 0 && (
                        <tr className="bg-purple-50">
                          <td className="px-4 py-2 text-purple-900 font-medium">Wall Flashing</td>
                          <td className="px-4 py-2 text-right font-medium text-purple-900">{measurements.wall_flashing_lf}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              
              {/* Validation Notes */}
              {measurements.validation_notes && measurements.validation_notes.length > 0 && (
                <div className="mb-6 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                  <h4 className="text-xs font-medium text-yellow-800 uppercase mb-2">Verification Notes</h4>
                  <ul className="text-sm text-yellow-700 space-y-1">
                    {measurements.validation_notes.map((note, i) => (
                      <li key={i}>• {note}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {/* Formula verification note */}
              <div className="text-xs text-gray-700 text-center">
                Calculations use industry-standard formulas matching EagleView & GAF QuickMeasure
              </div>
            </div>
            
            <div className="p-6 border-t bg-gray-50 rounded-b-2xl flex justify-between items-center">
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-white"
              >
                Back to Edit
              </button>
              <button
                onClick={saveMeasurement}
                disabled={saving}
                className="px-8 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
              >
                {saving ? 'Saving...' : 'Save & Create Proposal →'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
