'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { shouldShowRoofMeasureDrawingHintsForUser } from '@/lib/permissions'
import { ROOF_MEASURE_VISION_TRACE_ENABLED } from '@/lib/roof-measure-flags'
import { clampVisionAlignStaticZoom } from '@/lib/static-satellite-map'

declare const google: any

interface Point {
  lat: number
  lng: number
}

type SectionType =
  | 'main_roof'
  | 'upper_roof'
  | 'lower_roof'
  | 'porch_roof'
  | 'dormer'
  | 'garage_roof'

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
  section_type?: SectionType  // Optional classification for multi-level roofs
  suggested_pitch?: string | null
  suggested_pitch_degrees?: number | null
  pitch_source?: 'manual' | 'unknown'
  geometry_source?: string | null
  geometry_reviewed?: boolean
  color: string
  /** Accepted from AI draft vs drawn with “Draw Facet”. */
  origin?: 'ai_draft' | 'manual_draw'
}

// Linear features that can be manually drawn (step flashing, custom valleys, etc.)
interface LinearFeature {
  id: string
  type: 'ridge' | 'step_flashing' | 'wall_flashing' | 'valley' | 'custom'
  points: Point[]
  length_ft: number
  label?: string
  origin?: 'ai_draft' | 'manual_draw'
}

interface MeasurementData {
  address: string
  lat: number
  lng: number
  // Area measurements
  flat_area_sqft: number      // Total footprint area
  total_area_sqft: number     // Total actual roof surface area
  total_squares: number       // Roofing squares (area / 100)
  /** Kept in saved raw data for older measurements; current totals use drawn/loaded section geometry. */
  footprint_scale: number
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
  quote_ready?: boolean
  linear_review_status?: 'measured' | 'missing'
  measurement_confidence: 'high' | 'medium' | 'low'
  validation_notes: string[]
}

interface AIDraftSection {
  id: string
  type: 'facet' | 'ridge' | 'valley' | 'step_flash' | 'wall_flash'
  vertices?: [number, number][]
  points?: [number, number][]
  confidence: number
  estimated_sq_ft?: number
  suggested_pitch?: string | null
  suggested_pitch_degrees?: number | null
  solar_segment_index?: number | null
  facet_source?: string | null
  status: 'pending' | 'accepted' | 'rejected'
}

interface EstimateConfig {
  roofType: string
  wasteFactor: number
  layers: number
  manufacturer: string
  productLine: string
  preferredColor?: string
  replaceDecking: 'always' | 'if_needed' | 'never'
}

interface GeneratedEstimateLine {
  id: string
  category: string | null
  description: string
  quantity: number
  unit: string
  unit_price: number
  total_price: number
  notes: string | null
}

interface GeneratedEstimateResult {
  estimate: {
    id: string
    status: string
    subtotal: number
    overhead_pct: number
    overhead_amount: number
    total: number
  }
  line_items: GeneratedEstimateLine[]
  ai_flags: string[]
  scope_summary: string
}

// Colors for different linear feature types
const LINEAR_FEATURE_COLORS: Record<string, string> = {
  ridge: '#0EA5E9',         // sky
  step_flashing: '#F59E0B', // amber
  wall_flashing: '#8B5CF6', // purple
  valley: '#EF4444',        // red
  custom: '#6B7280',        // gray
}

const LINEAR_FEATURE_LABELS: Record<string, string> = {
  ridge: 'Ridge',
  step_flashing: 'Step Flashing',
  wall_flashing: 'Wall Flashing',
  valley: 'Valley',
  custom: 'Custom Line',
}

const SECTION_TYPE_OPTIONS: Array<{ value: SectionType; label: string }> = [
  { value: 'main_roof', label: 'Main Roof' },
  { value: 'upper_roof', label: 'Upper Roof' },
  { value: 'lower_roof', label: 'Lower Roof' },
  { value: 'porch_roof', label: 'Porch Roof' },
  { value: 'dormer', label: 'Dormer' },
  { value: 'garage_roof', label: 'Garage Roof' },
]

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

const getClosestPitchOption = (degrees: number | null | undefined) => {
  if (typeof degrees !== 'number' || Number.isNaN(degrees)) return null

  return PITCH_OPTIONS.reduce((closest, option) => {
    if (!closest) return option
    return Math.abs(option.degrees - degrees) < Math.abs(closest.degrees - degrees) ? option : closest
  }, null as (typeof PITCH_OPTIONS)[number] | null)
}

/**
 * Same satellite frame as `/api/ai/detect-roof` when `mapBounds` is set — request it here first so vision
 * sees the exact bitmap we georeference with the live map viewport (avoids a second Static Maps fetch skew).
 */
async function fetchVisionAlignedStaticSnapshotBase64(params: {
  lat: number
  lng: number
  zoom: number
  mapWidthPx: number
  mapHeightPx: number
}): Promise<string | null> {
  const qs = new URLSearchParams({
    lat: String(params.lat),
    lng: String(params.lng),
    zoom: String(params.zoom),
    mapWidthPx: String(params.mapWidthPx),
    mapHeightPx: String(params.mapHeightPx),
  })
  try {
    const res = await fetch(`/api/maps/static-satellite?${qs.toString()}`)
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.base64 === 'string' ? data.base64 : null
  } catch {
    return null
  }
}

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
  const aiDraftPolygonsRef = useRef<Map<string, any>>(new Map())
  const aiDraftBoundaryRef = useRef<Map<string, any>>(new Map())
  const aiDraftLinesRef = useRef<Map<string, any>>(new Map())
  const autoDetectRequestKeyRef = useRef<string | null>(null)
  /** After auto-detect fails, skip effect-driven retries until the user searches again or runs manual AI Detect (avoids infinite loops). */
  const skipAutoDetectAfterFailureRef = useRef(false)
  const isDetectingRef = useRef(false)
  
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
  const [isDetecting, setIsDetecting] = useState(false)

  useEffect(() => {
    isDetectingRef.current = isDetecting
  }, [isDetecting])
  const [aiDraftSections, setAiDraftSections] = useState<AIDraftSection[]>([])
  const [aiNotes, setAiNotes] = useState('')
  /** Last /api/ai/detect-roof `facet_source` (solar_mask | solar_bbox | vision | …). */
  const [aiGeometrySource, setAiGeometrySource] = useState<string | null>(null)
  const [showEstimateConfigModal, setShowEstimateConfigModal] = useState(false)
  const [isGeneratingEstimate, setIsGeneratingEstimate] = useState(false)
  const [generatedEstimate, setGeneratedEstimate] = useState<GeneratedEstimateResult | null>(null)
  const [estimateConfig, setEstimateConfig] = useState<EstimateConfig>({
    roofType: 'asphalt_shingle',
    wasteFactor: 12,
    layers: 1,
    manufacturer: '',
    productLine: '',
    preferredColor: '',
    replaceDecking: 'if_needed',
  })
  
  // Linear features state
  const [linearFeatures, setLinearFeatures] = useState<LinearFeature[]>([])
  const [isDrawingLine, setIsDrawingLine] = useState(false)
  const [lineDrawingType, setLineDrawingType] = useState<'ridge' | 'step_flashing' | 'wall_flashing' | 'valley' | 'custom'>('step_flashing')
  const [showLineTypeModal, setShowLineTypeModal] = useState(false)
  /** Fetched from `/api/calendar/profile`; default true so sales users see hints if the request fails. */
  const [showDrawingToolHints, setShowDrawingToolHints] = useState(true)
  const lineDrawingTypeRef = useRef<'ridge' | 'step_flashing' | 'wall_flashing' | 'valley' | 'custom'>('step_flashing')
  const facetsRef = useRef<RoofFacet[]>([])
  const linearFeaturesRef = useRef<LinearFeature[]>([])
  const polylinesRef = useRef<Map<string, any>>(new Map())
  const pendingOpportunityMapFocusRef = useRef<{ lat: number; lng: number } | null>(null)
  /** Summed Solar `ground_area` (sq ft). Overlapping segment quads sum above this — we scale totals to match. */
  const solarGroundFootprintReferenceRef = useRef<number | null>(null)
  /**
   * Last `/api/ai/detect-roof` `facet_source` (updated synchronously). React `aiGeometrySource` can lag one
   * tick behind `setState`, so auto-accept + `updateMeasurements` was applying Solar scaling to vision traces.
   */
  const facetGeometrySourceRef = useRef<string | null>(null)

  useEffect(() => {
    facetsRef.current = facets
  }, [facets])

  useEffect(() => {
    linearFeaturesRef.current = linearFeatures
  }, [linearFeatures])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/calendar/profile')
        if (!res.ok) return
        const p = await res.json()
        if (cancelled) return
        setShowDrawingToolHints(
          shouldShowRoofMeasureDrawingHintsForUser({
            role: p.role,
            customRoleName: p.custom_role?.name ?? null,
            customRoleDisplayName: p.custom_role?.display_name ?? null,
          }),
        )
      } catch {
        /* keep default true */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const commitFacets = (nextFacets: RoofFacet[]) => {
    facetsRef.current = nextFacets
    setFacets(nextFacets)
  }

  const commitLinearFeatures = (nextFeatures: LinearFeature[]) => {
    linearFeaturesRef.current = nextFeatures
    setLinearFeatures(nextFeatures)
  }

  useEffect(() => {
    const oppId = searchParams.get('opportunity_id') || searchParams.get('opportunity')
    const urlAddress = searchParams.get('address')
    
    if (oppId) {
      setOpportunityId(oppId)
      if (urlAddress) {
        setAddress(urlAddress)
      }
      loadOpportunityAddress(oppId, urlAddress || undefined)
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

  useEffect(() => {
    if (!mapsLoaded || !googleMapRef.current || !pendingOpportunityMapFocusRef.current) return
    const { lat, lng } = pendingOpportunityMapFocusRef.current
    pendingOpportunityMapFocusRef.current = null
    focusMapOnProperty(googleMapRef.current, lat, lng)
  }, [mapsLoaded])

  // New search → allow auto-detect to run again
  useEffect(() => {
    if (!searchedAddress) return
    skipAutoDetectAfterFailureRef.current = false
  }, [searchedAddress])

  useEffect(() => {
    if (!searchedAddress || !googleMapRef.current || isDetecting) return
    if (facets.length > 0 || linearFeatures.length > 0 || aiDraftSections.length > 0) return
    if (skipAutoDetectAfterFailureRef.current) return

    const map = googleMapRef.current
    // Defer so fitBounds / idle can finish (viewport framing) before we read center+zoom for the API.
    const timeoutId = window.setTimeout(() => {
      if (!googleMapRef.current || isDetectingRef.current) return
      if (facets.length > 0 || linearFeatures.length > 0 || aiDraftSections.length > 0) return
      if (skipAutoDetectAfterFailureRef.current) return

      const center = googleMapRef.current.getCenter()
      const zoom = googleMapRef.current.getZoom()
      if (!center || typeof zoom !== 'number') return

      const requestKey = `${searchedAddress}:${center.lat().toFixed(6)}:${center.lng().toFixed(6)}:${zoom}`
      if (autoDetectRequestKeyRef.current === requestKey) return

      autoDetectRequestKeyRef.current = requestKey
      detectRoofWithAI(false)
    }, 550)

    return () => window.clearTimeout(timeoutId)
  }, [searchedAddress, facets.length, linearFeatures.length, aiDraftSections.length, isDetecting])

  const loadOpportunityAddress = async (oppId: string, preferredAddress?: string) => {
    try {
      const response = await fetch(`/api/measurements?opportunity_id=${oppId}`)
      if (response.ok) {
        const { opportunity } = await response.json()
        const oppLat = Number(opportunity?.lat)
        const oppLng = Number(opportunity?.lng)
        const hasStoredLocation = Number.isFinite(oppLat) && Number.isFinite(oppLng)
        const addressToUse = preferredAddress || opportunity?.address_text

        if (addressToUse) {
          setAddress(addressToUse)
          if (hasStoredLocation) {
            setSearchedAddress(addressToUse)
          }
        }

        if (hasStoredLocation) {
          const target = { lat: oppLat, lng: oppLng }
          setMapCenter(target)
          pendingOpportunityMapFocusRef.current = target
          if (googleMapRef.current) {
            pendingOpportunityMapFocusRef.current = null
            focusMapOnProperty(googleMapRef.current, target.lat, target.lng)
          }
        } else if (preferredAddress) {
          if (window.google?.maps && googleMapRef.current) {
            searchAddress(preferredAddress)
          }
        } else if (addressToUse && window.google?.maps && googleMapRef.current) {
          searchAddress(addressToUse)
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

          resetMeasurementSession()
          setAddress(place.formatted_address || '')
          setSearchedAddress(place.formatted_address || '')
          setMapCenter({ lat, lng })

          if (googleMapRef.current) {
            focusMapOnProperty(googleMapRef.current, lat, lng)
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
        const geometry = results[0].geometry
        const location = geometry.location
        const lat = location.lat()
        const lng = location.lng()

        console.log('Geocoded address:', results[0].formatted_address, 'at', lat, lng)

        resetMeasurementSession()
        setMapCenter({ lat, lng })
        setSearchedAddress(results[0].formatted_address)

        if (googleMapRef.current) {
          focusMapOnProperty(googleMapRef.current, lat, lng)
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

  const clearAIDraftOverlays = () => {
    aiDraftPolygonsRef.current.forEach((polygon) => polygon.setMap(null))
    aiDraftBoundaryRef.current.forEach((line) => line.setMap(null))
    aiDraftLinesRef.current.forEach((line) => line.setMap(null))
    aiDraftPolygonsRef.current.clear()
    aiDraftBoundaryRef.current.clear()
    aiDraftLinesRef.current.clear()
  }

  const resetMeasurementSession = () => {
    polygonsRef.current.forEach((polygon) => polygon.setMap(null))
    labelsRef.current.forEach((label) => label.setMap(null))
    polylinesRef.current.forEach((polyline) => polyline.setMap(null))
    polygonsRef.current.clear()
    labelsRef.current.clear()
    polylinesRef.current.clear()
    clearAIDraftOverlays()

    commitFacets([])
    commitLinearFeatures([])
    setMeasurements(null)
    setSelectedFacet(null)
    setAiDraftSections([])
    setAiNotes('')
    facetGeometrySourceRef.current = null
    setAiGeometrySource(null)
    solarGroundFootprintReferenceRef.current = null
    autoDetectRequestKeyRef.current = null
    skipAutoDetectAfterFailureRef.current = false
  }

  const focusMapOnProperty = (map: any, lat: number, lng: number) => {
    map.setCenter({ lat, lng })
    map.setZoom(Math.max(21, Math.round(map.getZoom?.() ?? 21)))

    google.maps.event.addListenerOnce(map, 'idle', () => {
      const center = map.getCenter()
      const zoom = map.getZoom()

      if (center) {
        setMapCenter({ lat: center.lat(), lng: center.lng() })
      }

      if (typeof zoom === 'number' && zoom < 21) {
        map.setCenter({ lat, lng })
        map.setZoom(21)
      }
    })
  }

  const pointsFromPolygon = (polygon: any): Point[] => {
    const path = polygon.getPath()
    const points: Point[] = []

    for (let i = 0; i < path.getLength(); i++) {
      const point = path.getAt(i)
      points.push({ lat: point.lat(), lng: point.lng() })
    }

    return points
  }

  const pointsFromPolyline = (polyline: any): Point[] => {
    const path = polyline.getPath()
    const points: Point[] = []

    for (let i = 0; i < path.getLength(); i++) {
      const point = path.getAt(i)
      points.push({ lat: point.lat(), lng: point.lng() })
    }

    return points
  }

  const waitForMapToSettle = async (map: any) => {
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }

      const timeoutId = window.setTimeout(finish, 500)
      google.maps.event.addListenerOnce(map, 'idle', () => {
        window.clearTimeout(timeoutId)
        finish()
      })
    })
  }

  const updateLabelMarkerPosition = (facetId: string, points: Point[]) => {
    const label = labelsRef.current.get(facetId)
    if (!label || points.length === 0) return
    label.setPosition(
      points.reduce(
        (acc, p) => ({ lat: acc.lat + p.lat / points.length, lng: acc.lng + p.lng / points.length }),
        { lat: 0, lng: 0 }
      )
    )
  }

  const recalculateFacetFromPoints = (facet: RoofFacet, points: Point[]): RoofFacet => {
    const areaMeters = google.maps.geometry.spherical.computeArea(
      points.map((point) => new google.maps.LatLng(point.lat, point.lng))
    )
    const flatAreaSqft = Math.max(0, Math.round(areaMeters * 10.7639))
    const perimeterFt = calculatePerimeter(points)

    return {
      ...facet,
      points,
      flat_area_sqft: flatAreaSqft,
      area_sqft: Math.round(flatAreaSqft * (facet.pitch_multiplier || 1)),
      perimeter_ft: Math.round(perimeterFt),
      orientation: calculateOrientation(points),
    }
  }

  const recalculateLinearFeature = (feature: LinearFeature, points: Point[]): LinearFeature => {
    let lengthMeters = 0
    for (let i = 0; i < points.length - 1; i++) {
      lengthMeters += google.maps.geometry.spherical.computeDistanceBetween(
        new google.maps.LatLng(points[i].lat, points[i].lng),
        new google.maps.LatLng(points[i + 1].lat, points[i + 1].lng)
      )
    }

    return {
      ...feature,
      points,
      length_ft: Math.round(lengthMeters * 3.28084),
    }
  }

  const syncFacetFromOverlay = (facetId: string, polygon: any) => {
    const currentFacet = facetsRef.current.find((facet) => facet.id === facetId)
    if (!currentFacet) return

    const points = pointsFromPolygon(polygon)
    if (points.length < 3) return

    const nextFacet = recalculateFacetFromPoints(currentFacet, points)
    const nextFacets = facetsRef.current.map((facet) =>
      facet.id === facetId
        ? { ...nextFacet, geometry_reviewed: true, geometry_source: 'manual_corrected' }
        : facet
    )
    commitFacets(nextFacets)
    updateLabelMarkerPosition(facetId, points)
    updateMeasurements(nextFacets, linearFeaturesRef.current)
  }

  const syncLinearFeatureFromOverlay = (featureId: string, polyline: any) => {
    const currentFeature = linearFeaturesRef.current.find((feature) => feature.id === featureId)
    if (!currentFeature) return

    const points = pointsFromPolyline(polyline)
    if (points.length < 2) return

    const nextFeature = recalculateLinearFeature(currentFeature, points)
    const nextFeatures = linearFeaturesRef.current.map((feature) => (feature.id === featureId ? nextFeature : feature))
    commitLinearFeatures(nextFeatures)
    updateMeasurements(facetsRef.current, nextFeatures)
  }

  const attachPolygonEditListeners = (facetId: string, polygon: any) => {
    const path = polygon.getPath()
    const sync = () => syncFacetFromOverlay(facetId, polygon)

    google.maps.event.addListener(path, 'set_at', sync)
    google.maps.event.addListener(path, 'insert_at', sync)
    google.maps.event.addListener(path, 'remove_at', sync)
  }

  const attachPolylineEditListeners = (featureId: string, polyline: any) => {
    const path = polyline.getPath()
    const sync = () => syncLinearFeatureFromOverlay(featureId, polyline)

    google.maps.event.addListener(path, 'set_at', sync)
    google.maps.event.addListener(path, 'insert_at', sync)
    google.maps.event.addListener(path, 'remove_at', sync)
  }

  /**
   * @param detectionMode `solar` (default): Google Solar segment boxes, no OpenAI. `vision`: GPT-4o on satellite (token cost).
   */
  const detectRoofWithAI = async (autoAcceptFacets = false, detectionMode: 'solar' | 'vision' = 'solar') => {
    if (!googleMapRef.current) return

    if (detectionMode === 'vision' && !ROOF_MEASURE_VISION_TRACE_ENABLED) {
      alert(
        'AI roof trace is turned off for now (accuracy work in progress). Use “Load roof (Google Solar)” or Draw Facet.'
      )
      return
    }

    if (!autoAcceptFacets) {
      skipAutoDetectAfterFailureRef.current = false
    }

    try {
      setIsDetecting(true)
      setAiDraftSections([])
      setAiNotes('')
      facetGeometrySourceRef.current = null
      setAiGeometrySource(null)
      clearAIDraftOverlays()

      const map = googleMapRef.current
      await waitForMapToSettle(map)

      /**
       * Static Maps + vision pipeline use integer zoom (see clampVisionAlignStaticZoom). The JS map often
       * sits on a fractional zoom (e.g. 19.7); Mercator pixel→lat/lng for the snapshot then disagrees with
       * what’s on screen → overlays look shifted. Snap before snapshot + detect.
       */
      if (detectionMode === 'vision') {
        const z0 = map.getZoom()
        if (typeof z0 === 'number') {
          const zAligned = clampVisionAlignStaticZoom(Math.round(z0))
          if (Math.abs(z0 - zAligned) > 0.02) {
            map.setZoom(zAligned)
            await waitForMapToSettle(map)
          }
        }
      }

      const center = map.getCenter()
      const zoom = map.getZoom()
      if (!center || typeof zoom !== 'number') {
        throw new Error('Map not ready')
      }

      const lat = center.lat()
      const lng = center.lng()
      const normalizedZoom = Math.round(zoom)

      const bounds = map.getBounds()
      const mapDiv = map.getDiv?.() as HTMLElement | undefined
      const mapWidthPx = mapDiv?.clientWidth || 640
      const mapHeightPx = mapDiv?.clientHeight || 640
      const mapBounds = bounds
        ? {
            north: bounds.getNorthEast().lat(),
            east: bounds.getNorthEast().lng(),
            south: bounds.getSouthWest().lat(),
            west: bounds.getSouthWest().lng(),
          }
        : undefined

      let visionSnapshotBase64: string | undefined
      if (detectionMode === 'vision' && mapBounds) {
        const snap = await fetchVisionAlignedStaticSnapshotBase64({
          lat,
          lng,
          zoom: normalizedZoom,
          mapWidthPx,
          mapHeightPx,
        })
        if (snap) visionSnapshotBase64 = snap
      }

      const response = await fetch('/api/ai/detect-roof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat,
          lng,
          zoom: normalizedZoom,
          opportunityId: opportunityId || '',
          mapBounds,
          mapWidthPx,
          mapHeightPx,
          detectionMode,
          ...(visionSnapshotBase64 ? { imageBase64: visionSnapshotBase64 } : {}),
        }),
      })

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}))
        throw new Error(errorPayload?.error || 'Roof load failed')
      }

      const data = await response.json()

      if (
        typeof data.solar_ground_footprint_sqft === 'number' &&
        Number.isFinite(data.solar_ground_footprint_sqft) &&
        data.solar_ground_footprint_sqft > 0
      ) {
        solarGroundFootprintReferenceRef.current = data.solar_ground_footprint_sqft
      }

      const draftFacets: AIDraftSection[] = (data.facets || []).map((facet: any, idx: number) => ({
        suggested_pitch: getClosestPitchOption(facet.suggested_pitch_degrees)?.value || null,
        suggested_pitch_degrees:
          typeof facet.suggested_pitch_degrees === 'number' ? Number(facet.suggested_pitch_degrees) : null,
        solar_segment_index: typeof facet.solar_segment_index === 'number' ? facet.solar_segment_index : null,
        facet_source: typeof facet.facet_source === 'string' ? facet.facet_source : null,
        id: facet.id || `ai_facet_${idx + 1}`,
        type: 'facet',
        points: (facet.lat_lng_vertices || []).map((p: any) => [Number(p.lat), Number(p.lng)] as [number, number]),
        confidence: Number(facet.confidence) || 0,
        estimated_sq_ft: typeof facet.estimated_sq_ft === 'number' ? facet.estimated_sq_ft : undefined,
        status: 'pending',
      }))

      const mapLines = (items: any[], type: AIDraftSection['type'], prefix: string): AIDraftSection[] =>
        (items || []).map((item: any, idx: number) => ({
          id: item.id || `${prefix}_${idx + 1}`,
          type,
          points: (item.lat_lng_points || []).map((p: any) => [Number(p.lat), Number(p.lng)] as [number, number]),
          confidence: Number(item.confidence) || 0,
          status: 'pending',
        }))

      const allDrafts = [
        ...draftFacets,
        ...mapLines(data.ridges, 'ridge', 'ai_ridge'),
        ...mapLines(data.valleys, 'valley', 'ai_valley'),
        ...mapLines(data.step_flashing, 'step_flash', 'ai_step'),
        ...mapLines(data.wall_flashing, 'wall_flash', 'ai_wall'),
      ]

      setAiDraftSections(autoAcceptFacets ? allDrafts.filter((item) => item.type !== 'facet') : allDrafts)
      setAiNotes(data.notes || '')
      const facetSrc = typeof data.facet_source === 'string' ? data.facet_source : null
      facetGeometrySourceRef.current = facetSrc
      setAiGeometrySource(facetSrc)

      if (autoAcceptFacets) {
        draftFacets.forEach((facet) => acceptDraftItem(facet.id, facet))
      }
    } catch (error) {
      console.error('AI detect error:', error)
      autoDetectRequestKeyRef.current = null
      skipAutoDetectAfterFailureRef.current = true
      const message = error instanceof Error ? error.message : 'AI roof detection failed. Please try again.'
      alert(message)
    } finally {
      setIsDetecting(false)
    }
  }

  useEffect(() => {
    if (!googleMapRef.current || !window.google?.maps) return

    clearAIDraftOverlays()
    const map = googleMapRef.current
    const dashSymbol = {
      path: 'M 0,-1 0,1',
      strokeOpacity: 1,
      scale: 3,
    }

    aiDraftSections
      .filter((item) => item.status === 'pending')
      .forEach((item) => {
        if (item.type === 'facet' && item.points && item.points.length >= 3) {
          const path = item.points.map(([lat, lng]) => ({ lat, lng }))
          const polygon = new google.maps.Polygon({
            paths: path,
            fillColor: '#60A5FA',
            fillOpacity: 0.15,
            strokeOpacity: 0,
            map,
          })

          const closedPath = [...path, path[0]]
          const boundary = new google.maps.Polyline({
            path: closedPath,
            strokeOpacity: 0,
            icons: [{ icon: dashSymbol, offset: '0', repeat: '14px' }],
            strokeColor: item.confidence < 0.75 ? '#F59E0B' : '#2563EB',
            strokeWeight: 2,
            map,
          })

          aiDraftPolygonsRef.current.set(item.id, polygon)
          aiDraftBoundaryRef.current.set(item.id, boundary)
          return
        }

        if (item.points && item.points.length >= 2) {
          const line = new google.maps.Polyline({
            path: item.points.map(([lat, lng]) => ({ lat, lng })),
            strokeOpacity: 0,
            icons: [{ icon: dashSymbol, offset: '0', repeat: '14px' }],
            strokeColor: item.confidence < 0.75 ? '#F59E0B' : '#2563EB',
            strokeWeight: 3,
            map,
          })
          aiDraftLinesRef.current.set(item.id, line)
        }
      })

    return () => {
      clearAIDraftOverlays()
    }
  }, [aiDraftSections])

  const acceptDraftItem = (itemId: string, draftOverride?: AIDraftSection) => {
    const draft = draftOverride || aiDraftSections.find((item) => item.id === itemId)
    if (!draft || draft.status !== 'pending') return

    if (draft.type === 'facet' && draft.points && draft.points.length >= 3) {
      const validPoints = draft.points.filter(
        ([lat, lng]) =>
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lng) <= 180
      )
      if (validPoints.length < 3) {
        console.warn('acceptDraftItem: skipped facet with invalid coordinates', itemId)
        return
      }

      const areaMeters = google.maps.geometry.spherical.computeArea(
        validPoints.map(([lat, lng]) => new google.maps.LatLng(lat, lng))
      )
      const computedFlatAreaSqft = Math.round(areaMeters * 10.7639)
      const estimatedFlatAreaSqft = typeof draft.estimated_sq_ft === 'number' ? Math.round(draft.estimated_sq_ft) : 0
      const flatAreaSqft = computedFlatAreaSqft > 0 ? computedFlatAreaSqft : estimatedFlatAreaSqft
      if (!flatAreaSqft || flatAreaSqft < 10) {
        console.warn('acceptDraftItem: skipped facet with invalid area', { itemId, computedFlatAreaSqft, estimatedFlatAreaSqft })
        return
      }
      const perimeterFt = calculatePerimeter(validPoints.map(([lat, lng]) => ({ lat, lng })))
      const colorIndex = facetsRef.current.length % FACET_COLORS.length

      const newFacet: RoofFacet = {
        id: `facet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        points: validPoints.map(([lat, lng]) => ({ lat, lng })),
        flat_area_sqft: flatAreaSqft,
        area_sqft: flatAreaSqft,
        pitch: 'Unset',
        pitch_rise: 0,
        pitch_degrees: 0,
        pitch_multiplier: 1,
        perimeter_ft: Math.round(perimeterFt),
        orientation: calculateOrientation(validPoints.map(([lat, lng]) => ({ lat, lng }))),
        section_type: 'main_roof',
        suggested_pitch: draft.suggested_pitch || null,
        suggested_pitch_degrees: draft.suggested_pitch_degrees ?? null,
        pitch_source: 'unknown',
        geometry_source: draft.facet_source || facetGeometrySourceRef.current || 'ai_draft',
        geometry_reviewed: false,
        color: FACET_COLORS[colorIndex],
        origin: 'ai_draft',
      }

      const polygon = new google.maps.Polygon({
        paths: newFacet.points.map((p) => ({ lat: p.lat, lng: p.lng })),
        fillColor: newFacet.color,
        fillOpacity: 0.45,
        strokeColor: '#FFFFFF',
        strokeWeight: 3,
        editable: true,
        map: googleMapRef.current,
      })

      polygonsRef.current.set(newFacet.id, polygon)
      polygon.addListener('click', () => setSelectedFacet(newFacet.id))
      attachPolygonEditListeners(newFacet.id, polygon)

      const facetIndex = facetsRef.current.length + 1
      const centroid = newFacet.points.reduce(
        (acc, p) => ({ lat: acc.lat + p.lat / newFacet.points.length, lng: acc.lng + p.lng / newFacet.points.length }),
        { lat: 0, lng: 0 }
      )
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

      const nextFacets = [...facetsRef.current, newFacet]
      commitFacets(nextFacets)
      updateMeasurements(nextFacets, linearFeaturesRef.current)
    } else if (draft.points && draft.points.length >= 2) {
      const points: Point[] = draft.points.map(([lat, lng]) => ({ lat, lng }))
      let lengthMeters = 0
      for (let i = 0; i < points.length - 1; i++) {
        lengthMeters += google.maps.geometry.spherical.computeDistanceBetween(
          new google.maps.LatLng(points[i].lat, points[i].lng),
          new google.maps.LatLng(points[i + 1].lat, points[i + 1].lng)
        )
      }

      const typeMap: Record<AIDraftSection['type'], LinearFeature['type']> = {
        facet: 'custom',
        ridge: 'ridge',
        valley: 'valley',
        step_flash: 'step_flashing',
        wall_flash: 'wall_flashing',
      }
      const mappedType = typeMap[draft.type]
      const newFeature: LinearFeature = {
        id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: mappedType,
        points,
        length_ft: Math.round(lengthMeters * 3.28084),
        label: LINEAR_FEATURE_LABELS[mappedType],
        origin: 'ai_draft',
      }

      const polyline = new google.maps.Polyline({
        path: points,
        strokeColor: LINEAR_FEATURE_COLORS[mappedType],
        strokeWeight: 4,
        strokeOpacity: 0.9,
        editable: true,
        map: googleMapRef.current,
      })
      polylinesRef.current.set(newFeature.id, polyline)
      attachPolylineEditListeners(newFeature.id, polyline)

      const nextFeatures = [...linearFeaturesRef.current, newFeature]
      commitLinearFeatures(nextFeatures)
      updateMeasurements(facetsRef.current, nextFeatures)
    }

    setAiDraftSections((prev) => prev.map((item) => (item.id === itemId ? { ...item, status: 'accepted' } : item)))
  }

  const rejectDraftItem = (itemId: string) => {
    setAiDraftSections((prev) => prev.map((item) => (item.id === itemId ? { ...item, status: 'rejected' } : item)))
  }

  const acceptAllAIDrafts = () => {
    aiDraftSections
      .filter((item) => item.status === 'pending')
      .forEach((item) => acceptDraftItem(item.id))
  }

  const discardAIDrafts = () => {
    setAiDraftSections([])
    setAiNotes('')
    facetGeometrySourceRef.current = null
    setAiGeometrySource(null)
    clearAIDraftOverlays()
  }

  const generateSmartEstimate = async () => {
    if (!opportunityId) {
      alert('Opportunity is required to generate an estimate.')
      return
    }
    if (unresolvedPitchCount > 0) {
      alert(`Confirm slope on all roof sections before generating an estimate. ${unresolvedPitchCount} section${unresolvedPitchCount === 1 ? '' : 's'} still need pitch.`)
      return
    }

    const roofSections = [
      ...facets.map((facet) => ({
        id: facet.id,
        type: 'facet',
        area_sqft: facet.area_sqft,
      })),
      ...linearFeatures.map((feature) => ({
        id: feature.id,
        type:
          feature.type === 'step_flashing'
            ? 'step_flash'
            : feature.type === 'wall_flashing'
              ? 'wall_flash'
              : feature.type,
        length_ft: feature.length_ft,
      })),
    ]

    if (roofSections.length === 0) {
      alert('Add roof sections first.')
      return
    }

    try {
      setIsGeneratingEstimate(true)
      const response = await fetch('/api/ai/generate-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opportunityId,
          roofSections,
          config: estimateConfig,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to generate estimate')
      }

      setGeneratedEstimate(data)
      setShowEstimateConfigModal(false)
    } catch (error: any) {
      alert(error?.message || 'Failed to generate estimate')
    } finally {
      setIsGeneratingEstimate(false)
    }
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
  const startDrawingLine = (type: 'ridge' | 'step_flashing' | 'wall_flashing' | 'valley' | 'custom') => {
    if (!drawingManagerRef.current) return
    
    setLineDrawingType(type)
    lineDrawingTypeRef.current = type
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
    
    const points = pointsFromPolyline(polyline)
    
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
      // Use ref so map event listener always gets latest selected type.
      type: lineDrawingTypeRef.current,
      points,
      length_ft: lengthFt,
      label: LINEAR_FEATURE_LABELS[lineDrawingTypeRef.current],
      origin: 'manual_draw',
    }
    
    // Store polyline reference
    polylinesRef.current.set(newFeature.id, polyline)
    attachPolylineEditListeners(newFeature.id, polyline)
    
    // Add click listener to select
    polyline.addListener('click', () => {
      // Could add selection logic here
    })
    
    const currentFacets = facetsRef.current
    const updatedFeatures = [...linearFeaturesRef.current, newFeature]

    commitLinearFeatures(updatedFeatures)
    updateMeasurements(currentFacets, updatedFeatures)
  }

  // Delete a linear feature
  const deleteLinearFeature = (featureId: string) => {
    const polyline = polylinesRef.current.get(featureId)
    if (polyline) {
      polyline.setMap(null)
      polylinesRef.current.delete(featureId)
    }
    
    const newFeatures = linearFeatures.filter(f => f.id !== featureId)
    commitLinearFeatures(newFeatures)
    updateMeasurements(facetsRef.current, newFeatures)
  }

  const handlePolygonComplete = (polygon: any) => {
    stopDrawing()
    
    const path = polygon.getPath()
    const points = pointsFromPolygon(polygon)
    
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
      section_type: 'main_roof',
      color: pendingFacet.color!,
      pitch_source: 'manual',
      geometry_source: 'manual_draw',
      geometry_reviewed: true,
      origin: 'manual_draw',
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
      attachPolygonEditListeners(newFacet.id, polygon)
      
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
    
    const nextFacets = [...facetsRef.current, newFacet]
    commitFacets(nextFacets)
    setPendingFacet(null)
    setShowPitchModal(false)
    
    // Update measurements
    updateMeasurements(nextFacets, linearFeaturesRef.current)
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
    commitFacets(newFacets)
    setSelectedFacet(null)
    updateMeasurements(newFacets, linearFeaturesRef.current)
    
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

  const updateFacetSectionType = (facetId: string, sectionType: SectionType) => {
    const newFacets = facets.map((facet) =>
      facet.id === facetId ? { ...facet, section_type: sectionType } : facet
    )
    commitFacets(newFacets)
    updateMeasurements(newFacets, linearFeaturesRef.current)
  }

  const updateFacetPitch = (facetId: string, pitchValue: string) => {
    const option = PITCH_OPTIONS.find((item) => item.value === pitchValue)
    if (!option) return

    const nextFacets = facets.map((facet) => {
      if (facet.id !== facetId) return facet
      const areaSqft = Math.round((facet.flat_area_sqft || 0) * option.multiplier)
      return {
        ...facet,
        pitch: option.value,
        pitch_rise: option.rise,
        pitch_degrees: option.degrees,
        pitch_multiplier: option.multiplier,
        area_sqft: areaSqft,
        pitch_source: 'manual' as const,
        suggested_pitch: facet.suggested_pitch,
        suggested_pitch_degrees: facet.suggested_pitch_degrees,
      }
    })

    commitFacets(nextFacets)
    updateMeasurements(nextFacets, linearFeaturesRef.current)
  }

  const confirmFacetGeometry = (facetId: string) => {
    const nextFacets = facets.map((facet) =>
      facet.id === facetId ? { ...facet, geometry_reviewed: true } : facet
    )
    commitFacets(nextFacets)
    updateMeasurements(nextFacets, linearFeaturesRef.current)
  }

  const getFacetCentroid = (points: Point[]): Point => {
    if (points.length === 0) return { lat: 0, lng: 0 }
    return points.reduce(
      (acc, p) => ({ lat: acc.lat + p.lat / points.length, lng: acc.lng + p.lng / points.length }),
      { lat: 0, lng: 0 }
    )
  }

  const getDistanceFeet = (a: Point, b: Point): number => {
    if (window.google?.maps?.geometry?.spherical) {
      const meters = google.maps.geometry.spherical.computeDistanceBetween(
        new google.maps.LatLng(a.lat, a.lng),
        new google.maps.LatLng(b.lat, b.lng)
      )
      return meters * 3.28084
    }

    // Fallback approximation if geometry library is unavailable.
    const latDiff = (a.lat - b.lat) * 364000
    const lngScale = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
    const lngDiff = (a.lng - b.lng) * 364000 * lngScale
    return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff)
  }

  const estimateBoundingBoxAreaSqft = (points: Point[]): number | null => {
    if (points.length < 2 || !window.google?.maps?.geometry?.spherical) return null

    let minLat = Number.POSITIVE_INFINITY
    let maxLat = Number.NEGATIVE_INFINITY
    let minLng = Number.POSITIVE_INFINITY
    let maxLng = Number.NEGATIVE_INFINITY

    for (const p of points) {
      minLat = Math.min(minLat, p.lat)
      maxLat = Math.max(maxLat, p.lat)
      minLng = Math.min(minLng, p.lng)
      maxLng = Math.max(maxLng, p.lng)
    }

    if (!isFinite(minLat) || !isFinite(maxLat) || !isFinite(minLng) || !isFinite(maxLng)) return null

    const midLat = (minLat + maxLat) / 2
    const widthMeters = google.maps.geometry.spherical.computeDistanceBetween(
      new google.maps.LatLng(midLat, minLng),
      new google.maps.LatLng(midLat, maxLng)
    )
    const heightMeters = google.maps.geometry.spherical.computeDistanceBetween(
      new google.maps.LatLng(minLat, minLng),
      new google.maps.LatLng(maxLat, minLng)
    )

    return widthMeters * heightMeters * 10.7639
  }

  const updateMeasurements = (currentFacets: RoofFacet[], currentLinearFeatures?: LinearFeature[]) => {
    const features = currentLinearFeatures ?? linearFeatures
    
    if (currentFacets.length === 0 && features.length === 0) {
      solarGroundFootprintReferenceRef.current = null
      facetGeometrySourceRef.current = null
      setMeasurements(null)
      return
    }
    
    const validationNotes: string[] = []
    const unsetPitchFacets = currentFacets.filter((facet) => !facet.pitch || facet.pitch === 'Unset')

    const facetFlatSqft = (f: RoofFacet) => {
      if (f.flat_area_sqft && f.flat_area_sqft > 0) return f.flat_area_sqft
      const multiplier = f.pitch_multiplier || 1.118
      return (f.area_sqft || 0) / multiplier
    }

    const flatAreaRaw = currentFacets.reduce((sum, f) => sum + facetFlatSqft(f), 0)
    const src = facetGeometrySourceRef.current
    const fromOpenAiVision = src === 'vision' || src === 'vision_solar_guided'
    const flatScale = 1
    const solarRef = solarGroundFootprintReferenceRef.current
    const SOLAR_OVERLAP_THRESHOLD = 1.08
    if (
      !fromOpenAiVision &&
      solarRef != null &&
      solarRef >= 350 &&
      flatAreaRaw > solarRef * SOLAR_OVERLAP_THRESHOLD
    ) {
      validationNotes.push(
        `Google Solar reports a smaller reference footprint (~${Math.round(solarRef).toLocaleString()} sq ft). Totals are using the visible roof section geometry; check for duplicate or overlapping sections if this looks high.`
      )
    }

    if (
      !fromOpenAiVision &&
      (src === 'solar_bbox' || src === 'solar_mask_plane' || src === 'solar_mask_whole') &&
      currentFacets.length > 0
    ) {
      validationNotes.push(
        'Shapes are from Google Solar (segment boxes or mask split)—approximate, often rectangular. Use “AI trace roof” for outlines that follow eaves, ridges, and rakes; then drag vertices.',
      )
    }

    const flatArea = flatAreaRaw * flatScale
    const totalArea = currentFacets.reduce((sum, f) => {
      const scaledFlat = facetFlatSqft(f) * flatScale
      const mult = f.pitch_multiplier || 1
      return sum + Math.round(scaledFlat * mult)
    }, 0)
    const facetCount = currentFacets.length
    
    // Calculate total perimeter from stored facet perimeters, or estimate from area
    let totalPerimeter = currentFacets.reduce((sum, f) => sum + (f.perimeter_ft || 0), 0)
    
    // If no perimeter data, estimate from area (perimeter ≈ 4 * √area for square-ish shapes)
    if (totalPerimeter === 0 && flatArea > 0) {
      totalPerimeter = currentFacets.reduce((sum, f) => {
        const facetFlatArea = Math.max(1, facetFlatSqft(f) * flatScale)
        return sum + 4 * Math.sqrt(facetFlatArea)
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
    
    // If ridge lines are manually drawn, use those as source of truth.
    // Otherwise, fall back to geometry estimate.
    const manualRidges = features
      .filter(f => f.type === 'ridge')
      .reduce((sum, f) => sum + f.length_ft, 0)
    if (manualRidges > 0) {
      ridges = Math.round(manualRidges)
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
    // Until a section has confirmed pitch, use 1× (horizontal projection) so auto linear
    // estimates stay consistent with footprint-based area_sqft for Unset facets — not Solar "suggestions".
    const estimatedPitchMultipliers = currentFacets
      .map((facet) => {
        if (facet.pitch && facet.pitch !== 'Unset') return facet.pitch_multiplier || 1.118
        return 1
      })
      .filter((value) => typeof value === 'number' && isFinite(value))

    const avgPitchMultiplier = estimatedPitchMultipliers.length > 0
      ? estimatedPitchMultipliers.reduce((sum, value) => sum + value, 0) / estimatedPitchMultipliers.length
      : 1
    
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
    currentFacets
      .filter((facet) => facet.pitch && facet.pitch !== 'Unset')
      .forEach((f) => {
        pitchCounts[f.pitch] = (pitchCounts[f.pitch] || 0) + f.area_sqft
      })
    const predominantPitch = Object.entries(pitchCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unset'
    
    // Calculate waste factor based on complexity (industry standards)
    const { wastePercent, category } = calculateWasteFactorDetailed(currentFacets, valleys, hips, totalArea)
    
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
    if (unsetPitchFacets.length > 0) {
      confidence = 'low'
      validationNotes.push(`Assign pitch to ${unsetPitchFacets.length} roof section${unsetPitchFacets.length === 1 ? '' : 's'} before quoting.`)
    }
    
    // Verify linear footage totals are reasonable
    const linearTotal = ridges + eaves + rakes + hips + valleys
    const expectedLinearRatio = linearTotal / Math.sqrt(totalArea)
    if (expectedLinearRatio < 2 || expectedLinearRatio > 8) {
      validationNotes.push('Linear footage may need verification')
      confidence = 'medium'
    }

    const isComplexRoof = facetCount >= 9
    if (isComplexRoof && manualRidges === 0) {
      validationNotes.push('Complex roof detected: ridge lines are estimated. Draw ridge lines for production accuracy.')
      confidence = 'medium'
    }
    if (isComplexRoof && manualValleys === 0) {
      validationNotes.push('Complex roof detected: valley lines are estimated. Draw valley lines to improve accuracy.')
      confidence = 'medium'
    }

    // Warning-only duplicate detector: same level tag + similar pitch/area + nearby centroids.
    for (let i = 0; i < currentFacets.length; i++) {
      for (let j = i + 1; j < currentFacets.length; j++) {
        const first = currentFacets[i]
        const second = currentFacets[j]
        if (!first.area_sqft || !second.area_sqft) continue
        if (!first.pitch || !second.pitch || first.pitch === 'Unset' || second.pitch === 'Unset') continue
        if (first.pitch !== second.pitch) continue

        const firstSectionType = first.section_type || 'main_roof'
        const secondSectionType = second.section_type || 'main_roof'
        if (firstSectionType !== secondSectionType) continue

        const areaDeltaPct = Math.abs(first.area_sqft - second.area_sqft) / Math.max(first.area_sqft, second.area_sqft)
        if (areaDeltaPct > 0.2) continue

        const centroidDistanceFt = getDistanceFeet(getFacetCentroid(first.points), getFacetCentroid(second.points))
        if (centroidDistanceFt > 30) continue

        const o1 = first.origin || 'manual_draw'
        const o2 = second.origin || 'manual_draw'
        const mixedAiManual = o1 !== o2
        validationNotes.push(
          mixedAiManual
            ? `Sections ${i + 1} and ${j + 1} look similar (mixed AI vs hand-drawn). Often one replaces the other—delete the extra if both cover the same plane.`
            : `Sections ${i + 1} and ${j + 1} look very similar (same pitch/size/level). Verify this is not a duplicate section.`
        )
        confidence = 'medium'
      }
    }

    // Conservative footprint sanity check (warning only, no blocking).
    const allPoints = currentFacets.flatMap((f) => f.points || [])
    const estimatedFootprintSqft = estimateBoundingBoxAreaSqft(allPoints)
    if (estimatedFootprintSqft && flatArea > estimatedFootprintSqft * 1.2) {
      validationNotes.push('Total measured footprint appears 20%+ above estimated roof footprint. Check for duplicate same-level sections.')
      confidence = 'medium'
    }

    const facetsNeedingGeometryReview = currentFacets.filter((facet) => facet.geometry_reviewed !== true)
    if (facetsNeedingGeometryReview.length > 0) {
      validationNotes.push(
        `Confirm the outline on ${facetsNeedingGeometryReview.length} roof section${facetsNeedingGeometryReview.length === 1 ? '' : 's'} before quoting. AI/Solar outlines are drafts until reviewed.`
      )
      confidence = 'low'
    }

    const facetsWithoutManualPitch = currentFacets.filter((facet) => facet.pitch_source !== 'manual')
    if (facetsWithoutManualPitch.length > 0) {
      validationNotes.push(
        `Confirm slope manually on ${facetsWithoutManualPitch.length} roof section${facetsWithoutManualPitch.length === 1 ? '' : 's'}. Solar slope is only a suggestion.`
      )
      confidence = 'low'
    }

    const unsupportedGeometryFacets = currentFacets.filter(
      (facet) => facet.geometry_source === 'solar_bbox' || facet.geometry_source === 'solar_mask_whole'
    )
    if (unsupportedGeometryFacets.length > 0) {
      validationNotes.push(
        'Solar bounding-box / whole-mask geometry is not quote-ready. Trace real roof faces or confirm every outline after correcting vertices.'
      )
      confidence = 'low'
    }

    const measuredRidges = Math.round(manualRidges)
    const measuredValleys = Math.round(manualValleys)
    const measuredStepFlashing = Math.round(stepFlashing)
    const measuredWallFlashing = Math.round(wallFlashing)
    const measuredEaves = 0
    const measuredRakes = 0
    const measuredHips = 0
    const measuredDripEdge = measuredEaves + measuredRakes
    const hasMeasuredLinework =
      measuredRidges > 0 ||
      measuredValleys > 0 ||
      measuredStepFlashing > 0 ||
      measuredWallFlashing > 0
    if (!hasMeasuredLinework) {
      validationNotes.push('Linear footage is not auto-estimated. Draw ridge, valley, and flashing lines when those quantities are needed.')
    }

    const quoteReady =
      currentFacets.length > 0 &&
      unsetPitchFacets.length === 0 &&
      facetsNeedingGeometryReview.length === 0 &&
      facetsWithoutManualPitch.length === 0 &&
      unsupportedGeometryFacets.length === 0
    
    // Helper to ensure no NaN values
    const safeNum = (n: number, fallback = 0) => isNaN(n) || !isFinite(n) ? fallback : n
    
    const currentMapCenter = googleMapRef.current?.getCenter?.()
    const measurementLat =
      currentMapCenter && typeof currentMapCenter.lat === 'function' ? currentMapCenter.lat() : mapCenter.lat
    const measurementLng =
      currentMapCenter && typeof currentMapCenter.lng === 'function' ? currentMapCenter.lng() : mapCenter.lng

    setMeasurements({
      address: searchedAddress,
      lat: measurementLat,
      lng: measurementLng,
      flat_area_sqft: safeNum(flatArea),
      total_area_sqft: safeNum(totalArea),
      total_squares: safeNum(Math.round(totalArea / 100 * 100) / 100),
      footprint_scale: flatScale,
      facets: currentFacets,
      facet_count: facetCount,
      total_perimeter_lf: safeNum(Math.round(totalPerimeter)),
      ridges_lf: safeNum(measuredRidges),
      hips_lf: safeNum(measuredHips),
      valleys_lf: safeNum(measuredValleys),
      eaves_lf: safeNum(measuredEaves),
      rakes_lf: safeNum(measuredRakes),
      drip_edge_lf: safeNum(measuredDripEdge),
      step_flashing_lf: safeNum(measuredStepFlashing),
      wall_flashing_lf: safeNum(measuredWallFlashing),
      predominant_pitch: predominantPitch,
      avg_pitch_multiplier: safeNum(Math.round(avgPitchMultiplier * 1000) / 1000, 1),
      suggested_waste: safeNum(wastePercent, 10),
      waste_category: category,
      linear_features: features,
      quote_ready: quoteReady,
      linear_review_status: hasMeasuredLinework ? 'measured' : 'missing',
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
    hipLength: number,
    effectiveTotalSqft?: number
  ): { wastePercent: number; category: string } => {
    if (currentFacets.length === 0) {
      return { wastePercent: 10, category: 'simple' }
    }
    
    const facetCount = currentFacets.length
    const totalArea =
      typeof effectiveTotalSqft === 'number' && effectiveTotalSqft > 0
        ? effectiveTotalSqft
        : currentFacets.reduce((sum, f) => sum + f.area_sqft, 0)
    
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
    const unresolvedPitchCount = facets.filter((facet) => !facet.pitch || facet.pitch === 'Unset').length
    if (unresolvedPitchCount > 0) {
      alert(`Assign pitch to all roof sections before saving. ${unresolvedPitchCount} section${unresolvedPitchCount === 1 ? '' : 's'} still need slope confirmation.`)
      return
    }
    if (facets.some((facet) => facet.pitch_source !== 'manual')) {
      alert('Confirm slope manually on every roof section before saving. Solar/AI slope suggestions are not treated as measured slope.')
      return
    }
    if (facets.some((facet) => facet.geometry_reviewed !== true)) {
      alert('Confirm every roof outline before saving. AI/Solar geometry is only a draft until reviewed.')
      return
    }
    if (facets.some((facet) => facet.geometry_source === 'solar_bbox' || facet.geometry_source === 'solar_mask_whole')) {
      alert('Solar box/whole-mask geometry is not quote-ready. Correct the outline or draw the roof faces manually before saving.')
      return
    }

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
    clearAIDraftOverlays()
    
    commitFacets([])
    commitLinearFeatures([])
    setMeasurements(null)
    setSelectedFacet(null)
    setAiDraftSections([])
    setAiNotes('')
    facetGeometrySourceRef.current = null
    setAiGeometrySource(null)
    autoDetectRequestKeyRef.current = null
    skipAutoDetectAfterFailureRef.current = false
  }

  const unresolvedPitchCount = facets.filter((facet) => !facet.pitch || facet.pitch === 'Unset').length

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
            <button
              onClick={() => detectRoofWithAI(false, 'solar')}
              disabled={isDetecting || !googleMapRef.current}
              className="w-full mb-2 min-h-[44px] px-3 py-2 rounded-lg font-medium text-sm bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {isDetecting ? 'Loading…' : 'Load roof (Google Solar)'}
            </button>
            {showDrawingToolHints && (
              <p className="text-[11px] text-gray-500 mb-2 leading-snug">
                Free: uses Solar roof mask when Data Layers are enabled. If Solar only has rough boxes, use AI trace or draw facets manually. Sections list shows{' '}
                <span className="text-cyan-600/90">AI</span> vs <span className="text-gray-400">Drawn</span> when you mix
                loads and manual edits.
              </p>
            )}
            {ROOF_MEASURE_VISION_TRACE_ENABLED ? (
              <>
                <button
                  onClick={() => detectRoofWithAI(false, 'vision')}
                  disabled={isDetecting || !googleMapRef.current}
                  className="w-full mb-3 min-h-[40px] px-3 py-2 rounded-lg font-medium text-xs bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 disabled:opacity-50"
                >
                  AI trace roof (OpenAI — uses credits)
                </button>
                {showDrawingToolHints && (
                  <p className="text-[11px] text-gray-500 mb-2 leading-snug">
                    Traces visible roof edges in the satellite view (min. 5 vertices per facet when structured output works).
                  </p>
                )}
              </>
            ) : (
              <p className="w-full mb-3 rounded-lg border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-100/90 leading-snug">
                AI trace roof is <span className="font-medium">off</span> for now (saves OpenAI spend while alignment is
                fixed). Use Load roof (Google Solar) or Draw Facet.
              </p>
            )}

            {aiDraftSections.length > 0 && (
              <div className="mb-3 rounded-lg border border-sky-500/30 bg-sky-900/20 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-medium text-sky-300">AI Draft - Review & Confirm</p>
                  <div className="flex gap-2">
                    <button
                      onClick={acceptAllAIDrafts}
                      className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700"
                    >
                      Accept All
                    </button>
                    <button
                      onClick={discardAIDrafts}
                      className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-200 hover:bg-gray-600"
                    >
                      Discard
                    </button>
                  </div>
                </div>

                {aiGeometrySource && (
                  <p className="text-[10px] text-gray-500 mb-1">
                    Geometry source:{' '}
                    <span className="text-gray-400">
                      {aiGeometrySource === 'solar_mask_plane'
                        ? 'Solar mask (GeoTIFF)'
                        : aiGeometrySource === 'solar_mask_whole'
                          ? 'Solar roof outline'
                        : aiGeometrySource === 'solar_bbox'
                          ? 'Solar segment boxes (fallback)'
                          : aiGeometrySource === 'vision' || aiGeometrySource === 'vision_solar_guided'
                            ? 'OpenAI vision trace'
                            : aiGeometrySource}
                    </span>
                  </p>
                )}
                {aiNotes && <p className="text-xs text-sky-200 mb-2">{aiNotes}</p>}

                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {aiDraftSections.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-xs bg-gray-900/30 rounded px-2 py-1">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-200">{item.type.replace('_', ' ')}</span>
                        <span className={`${item.confidence < 0.75 ? 'text-amber-300' : 'text-sky-300'}`}>
                          {(item.confidence * 100).toFixed(0)}%
                        </span>
                        {item.confidence < 0.75 && <span className="text-amber-300">low confidence</span>}
                        {item.type === 'facet' && item.suggested_pitch && (
                          <span className="text-sky-300">pitch {item.suggested_pitch}</span>
                        )}
                        <span className="text-gray-400">({item.status})</span>
                      </div>
                      {item.status === 'pending' && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => acceptDraftItem(item.id)}
                            className="px-2 py-0.5 rounded bg-green-700 text-white hover:bg-green-600"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => rejectDraftItem(item.id)}
                            className="px-2 py-0.5 rounded bg-red-700 text-white hover:bg-red-600"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-2">Auto-added roof faces can be edited on the map. Review any remaining draft lines here.</p>
              </div>
            )}
            
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
                    onClick={() => startDrawingLine('ridge')}
                    disabled={isDrawing}
                    className="flex items-center justify-center gap-1.5 px-2 py-2 bg-sky-600/20 text-sky-400 border border-sky-600/50 rounded-lg text-xs font-medium hover:bg-sky-600/30 disabled:opacity-50"
                  >
                    <span className="w-2 h-2 bg-sky-500 rounded-full"></span>
                    Ridge
                  </button>
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
                {facets.map((facet, idx) => {
                  const fpScale = measurements?.footprint_scale ?? 1
                  const rawFlat = facet.flat_area_sqft || 0
                  const displayFlat = Math.round(rawFlat * fpScale)
                  const mult = facet.pitch_multiplier || 1
                  const displaySurface =
                    facet.pitch === 'Unset' ? displayFlat : Math.round(displayFlat * mult)
                  return (
                  <div
                    key={facet.id}
                    onClick={() => setSelectedFacet(facet.id)}
                    className={`p-3 rounded-lg cursor-pointer transition ${
                      selectedFacet === facet.id 
                        ? 'bg-indigo-600/20 border border-indigo-500' 
                        : facet.pitch === 'Unset'
                          ? 'bg-amber-900/15 hover:bg-amber-900/25 border border-amber-700/40'
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
                        {facet.origin === 'ai_draft' ? (
                          <span className="text-[10px] px-1.5 py-0 rounded bg-cyan-900/60 text-cyan-300 font-medium">
                            AI
                          </span>
                        ) : facet.origin === 'manual_draw' ? (
                          <span className="text-[10px] px-1.5 py-0 rounded bg-gray-600/80 text-gray-300 font-medium">
                            Drawn
                          </span>
                        ) : null}
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
                        <span className="text-gray-500">
                          {facet.pitch === 'Unset' ? 'Surface (pitch TBD):' : 'Actual surface:'}
                        </span>
                        <span className="text-gray-300 ml-1">{displaySurface.toLocaleString()} sqft</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Pitch:</span>
                        <span className="text-gray-300 ml-1">
                          {facet.pitch}
                          {facet.pitch !== 'Unset' ? ` (×${facet.pitch_multiplier?.toFixed(2) || '1.00'})` : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Flat:</span>
                        <span className="text-gray-400 ml-1">{displayFlat.toLocaleString()} sqft</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Squares:</span>
                        <span className="text-gray-300 ml-1">{(displaySurface / 100).toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="text-[11px] text-gray-500">Pitch</label>
                      <select
                        value={PITCH_OPTIONS.some((option) => option.value === facet.pitch) ? facet.pitch : ''}
                        onChange={(e) => updateFacetPitch(facet.id, e.target.value)}
                        className="mt-1 w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
                      >
                        <option value="" disabled>
                          {facet.suggested_pitch
                            ? `Set pitch (Google Solar suggests ${facet.suggested_pitch})`
                            : 'Set pitch'}
                        </option>
                        {PITCH_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {facet.suggested_pitch && facet.pitch === 'Unset' && (
                        <p className="mt-1 text-[11px] text-sky-300">
                          Suggested by Google Solar: {facet.suggested_pitch}
                          {typeof facet.suggested_pitch_degrees === 'number'
                            ? ` (${facet.suggested_pitch_degrees.toFixed(1)}°)`
                            : ''}
                        </p>
                      )}
                    </div>
                    {facet.geometry_reviewed !== true && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          confirmFacetGeometry(facet.id)
                        }}
                        className="mt-2 w-full rounded border border-amber-500/50 bg-amber-900/20 px-2 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-900/35"
                      >
                        Confirm corrected outline
                      </button>
                    )}
                    <div className="mt-2">
                      <label className="text-[11px] text-gray-500">Section Type</label>
                      <select
                        value={facet.section_type || 'main_roof'}
                        onChange={(e) => updateFacetSectionType(facet.id, e.target.value as SectionType)}
                        className="mt-1 w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
                      >
                        {SECTION_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  )
                })}
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
                          {feature.origin === 'ai_draft' ? (
                            <span className="text-[10px] px-1.5 py-0 rounded bg-cyan-900/60 text-cyan-300 font-medium">
                              AI
                            </span>
                          ) : feature.origin === 'manual_draw' ? (
                            <span className="text-[10px] px-1.5 py-0 rounded bg-gray-600/80 text-gray-300 font-medium">
                              Drawn
                            </span>
                          ) : null}
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

            {facets.length >= 9 && (
              <div className="mt-4 p-3 bg-amber-900/20 rounded border border-amber-700/30">
                {linearFeatures.filter((feature) => feature.type === 'ridge').length === 0 && (
                  <p className="text-xs text-amber-300">
                    Complex roof detected: ridge lines are estimated. Add ridge lines for better production accuracy.
                  </p>
                )}
                {linearFeatures.filter((feature) => feature.type === 'valley').length === 0 && (
                  <p className="text-xs text-amber-300 mt-1">
                    Valley lines are estimated too. Add valley lines when available.
                  </p>
                )}
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
              {unresolvedPitchCount > 0 && (
                <div className="mb-3 rounded-lg border border-amber-700/40 bg-amber-900/20 p-2">
                  <p className="text-xs text-amber-300 font-medium">
                    {unresolvedPitchCount} roof section{unresolvedPitchCount === 1 ? '' : 's'} still need slope confirmation.
                  </p>
                  <p className="text-[11px] text-amber-200/80 mt-1">
                    Draft geometry is drawn, but quote-ready totals stay blocked until every face has a confirmed pitch.
                  </p>
                </div>
              )}
              
              {/* Main totals */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-indigo-900/30 rounded-lg p-3 border border-indigo-700/50">
                  <div className="text-2xl font-bold text-white">
                    {measurements.total_squares.toFixed(2)}
                  </div>
                  <div className="text-xs text-indigo-300">
                    {unresolvedPitchCount > 0 ? 'Squares (draft until slope confirmed)' : 'Squares (actual)'}
                  </div>
                </div>
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <div className="text-xl font-bold text-white">
                    {(measurements.total_area_sqft || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400">
                    {unresolvedPitchCount > 0 ? 'Sq Ft (draft until slope confirmed)' : 'Sq Ft (actual)'}
                  </div>
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
                disabled={unresolvedPitchCount > 0}
                className="w-full mt-4 px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
              >
                Save Measurement
              </button>
              <button
                onClick={() => setShowEstimateConfigModal(true)}
                disabled={!opportunityId || unresolvedPitchCount > 0}
                className="w-full mt-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                Generate Estimate
              </button>
              {unresolvedPitchCount > 0 && (
                <p className="text-xs text-amber-300 mt-2">
                  Save and estimate stay disabled until every auto-drawn face has a confirmed pitch.
                </p>
              )}
              {!opportunityId && (
                <p className="text-xs text-amber-300 mt-2">
                  Generate Estimate requires an opportunity context.
                </p>
              )}
            </div>
          )}

          {generatedEstimate && (
            <div className="p-4 border-t border-gray-700 bg-gray-800/50">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-200">Generated Estimate</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-300 border border-amber-700/50">
                  AI Draft - Needs Review
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                <div className="bg-gray-700/50 rounded p-2">
                  <div className="text-gray-400">Subtotal</div>
                  <div className="text-white font-medium">${(generatedEstimate.estimate.subtotal || 0).toLocaleString()}</div>
                </div>
                <div className="bg-gray-700/50 rounded p-2">
                  <div className="text-gray-400">Overhead</div>
                  <div className="text-white font-medium">
                    ${(generatedEstimate.estimate.overhead_amount || 0).toLocaleString()}
                  </div>
                </div>
                <div className="bg-indigo-900/30 border border-indigo-700/40 rounded p-2">
                  <div className="text-indigo-300">Total</div>
                  <div className="text-white font-semibold">${(generatedEstimate.estimate.total || 0).toLocaleString()}</div>
                </div>
              </div>

              {generatedEstimate.ai_flags?.length > 0 && (
                <div className="mb-3 p-2 rounded border border-amber-700/40 bg-amber-900/20">
                  <p className="text-xs text-amber-300 font-medium mb-1">AI Flags</p>
                  {generatedEstimate.ai_flags.map((flag, idx) => (
                    <p key={`${flag}-${idx}`} className="text-xs text-amber-200">- {flag}</p>
                  ))}
                </div>
              )}

              {generatedEstimate.scope_summary && (
                <div className="mb-3 p-2 rounded border border-sky-700/40 bg-sky-900/20">
                  <p className="text-xs text-sky-300 font-medium mb-1">Scope Summary</p>
                  <p className="text-xs text-sky-100">{generatedEstimate.scope_summary}</p>
                </div>
              )}

              <div className="space-y-2 max-h-56 overflow-y-auto">
                {Object.entries(
                  (generatedEstimate.line_items || []).reduce((acc, item) => {
                    const key = item.category || 'other'
                    if (!acc[key]) acc[key] = []
                    acc[key].push(item)
                    return acc
                  }, {} as Record<string, GeneratedEstimateLine[]>)
                ).map(([category, items]) => (
                  <div key={category} className="rounded border border-gray-700/60 bg-gray-900/30 p-2">
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{category}</p>
                    <div className="space-y-1">
                      {items.map((item) => (
                        <div key={item.id} className="flex items-start justify-between gap-2 text-xs">
                          <div className="text-gray-200 min-w-0">
                            <p className="truncate">{item.description}</p>
                            <p className="text-gray-500">
                              {item.quantity} {item.unit} @ ${item.unit_price}
                            </p>
                          </div>
                          <p className="text-gray-100 font-medium">${item.total_price.toLocaleString()}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
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

      {showEstimateConfigModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl shadow-xl max-w-lg w-full">
            <div className="p-6 border-b border-gray-700">
              <h2 className="text-xl font-bold text-white">Generate Estimate</h2>
              <p className="text-gray-400 text-sm mt-1">Configure AI draft settings</p>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Roof Type</label>
                  <input
                    value={estimateConfig.roofType}
                    onChange={(e) => setEstimateConfig((prev) => ({ ...prev, roofType: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Waste Factor (%)</label>
                  <input
                    type="number"
                    value={estimateConfig.wasteFactor}
                    onChange={(e) =>
                      setEstimateConfig((prev) => ({ ...prev, wasteFactor: Number(e.target.value) || 0 }))
                    }
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Layers</label>
                  <input
                    type="number"
                    value={estimateConfig.layers}
                    onChange={(e) => setEstimateConfig((prev) => ({ ...prev, layers: Number(e.target.value) || 1 }))}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Replace Decking</label>
                  <select
                    value={estimateConfig.replaceDecking}
                    onChange={(e) =>
                      setEstimateConfig((prev) => ({
                        ...prev,
                        replaceDecking: e.target.value as EstimateConfig['replaceDecking'],
                      }))
                    }
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  >
                    <option value="always">always</option>
                    <option value="if_needed">if_needed</option>
                    <option value="never">never</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Manufacturer</label>
                  <input
                    value={estimateConfig.manufacturer}
                    onChange={(e) => setEstimateConfig((prev) => ({ ...prev, manufacturer: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                    placeholder="Owens Corning"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Product Line</label>
                  <input
                    value={estimateConfig.productLine}
                    onChange={(e) => setEstimateConfig((prev) => ({ ...prev, productLine: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                    placeholder="Duration"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Preferred Color (optional)</label>
                <input
                  value={estimateConfig.preferredColor || ''}
                  onChange={(e) => setEstimateConfig((prev) => ({ ...prev, preferredColor: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  placeholder="Estate Gray"
                />
              </div>
            </div>
            <div className="p-6 border-t border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => setShowEstimateConfigModal(false)}
                className="px-4 py-2 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={generateSmartEstimate}
                disabled={isGeneratingEstimate}
                className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {isGeneratingEstimate ? 'Generating...' : 'Generate Estimate'}
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
              
            </div>
            
            <div className="p-6 border-t bg-gray-50 rounded-b-2xl flex justify-between items-center">
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-white"
              >
                Back to Edit
              </button>
              <div className="text-right">
                {unresolvedPitchCount > 0 && (
                  <p className="mb-2 text-xs text-amber-700">
                    Confirm slope on all roof faces before saving this measurement.
                  </p>
                )}
                <button
                  onClick={saveMeasurement}
                  disabled={saving || unresolvedPitchCount > 0}
                  className="px-8 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                >
                  {saving ? 'Saving...' : 'Save & Create Proposal →'}
                </button>
              </div>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
