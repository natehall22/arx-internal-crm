/**
 * VIEWPORT LEADS HOOK - Spotio/Terros style map loading at scale
 * 
 * Designed for 100k+ pins with hundreds of users.
 * 
 * Features:
 * - Tile-based caching to prevent refetching same areas
 * - Debounced fetching on map idle
 * - Incremental loading (excludes already-loaded pins)
 * - Zoom-level awareness (doesn't load at low zoom)
 * - Memory-efficient pin storage (minimal data until clicked)
 */

'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

// Minimal pin data from viewport API
export interface ViewportPin {
  id: string
  lat: number
  lng: number
  d: string | null  // disposition (short key)
  s: string         // status (short key)
  o: string | null  // owner_user_id (short key)
  t: string         // created_at timestamp
  /** Installation Agreement signed — show green $ on map */
  ia?: boolean
}

// Full pin data (fetched on click)
export interface FullPinData {
  id: string
  lat: number
  lng: number
  homeowner_name?: string
  address_text?: string
  phone?: string
  email?: string
  status: string
  canvass_disposition?: string
  canvass_notes?: string
  notes?: string
  created_at: string
  updated_at?: string
  owner_user_id?: string
  owner?: { id: string; full_name: string }
  /** Customer signed Installation Agreement — canvass map shows green $ */
  installation_agreement_signed_at?: string | null
}

// Cache configuration
const CACHE_PREFIX = 'cvp_v2:'  // Canvass Viewport v2
const DEBOUNCE_MS = 400  // Increased to reduce flicker during pan/zoom
const MIN_ZOOM_FOR_FETCH = 10
const TILE_PRECISION = 3  // Decimal places for tile keys (lower = larger tiles)

// Bounds type (google.maps.LatLngBounds at runtime)
type MapBounds = any

// Generate tile key from bounds and zoom
function getTileKey(bounds: MapBounds, zoom: number): string {
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  const zoomBucket = Math.floor(zoom / 2) * 2  // Bucket: 10, 12, 14, 16, 18, 20
  
  // Round bounds to create stable tile keys
  const precision = Math.max(1, TILE_PRECISION - Math.floor((zoom - 10) / 4))
  const key = [
    sw.lat().toFixed(precision),
    sw.lng().toFixed(precision),
    ne.lat().toFixed(precision),
    ne.lng().toFixed(precision),
    zoomBucket
  ].join('_')
  
  return `${CACHE_PREFIX}${key}`
}

interface ViewportState {
  pins: Map<string, ViewportPin>
  pinDetails: Map<string, FullPinData>
  loading: boolean
  error: string | null
  hasMore: boolean
  totalLoaded: number
}

interface UseViewportLeadsReturn {
  pins: ViewportPin[]
  loading: boolean
  error: string | null
  hasMore: boolean
  totalLoaded: number
  fetchForBounds: (bounds: MapBounds, zoom: number) => void
  getPinDetails: (id: string) => Promise<FullPinData | null>
  clearCache: () => void
  addPin: (pin: ViewportPin) => void  // Add a newly created pin to the display
  updatePin: (pin: ViewportPin) => void  // Update an existing pin
  removePin: (id: string) => void  // Remove a pin from the display
  // Disposition filter
  dispositionFilter: string | null
  setDispositionFilter: (d: string | null) => void
}

export function useViewportLeads(): UseViewportLeadsReturn {
  const [state, setState] = useState<ViewportState>({
    pins: new Map(),
    pinDetails: new Map(),
    loading: false,
    error: null,
    hasMore: false,
    totalLoaded: 0,
  })
  
  const [dispositionFilter, setDispositionFilter] = useState<string | null>(null)
  
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const fetchedTilesRef = useRef<Set<string>>(new Set())
  const abortControllerRef = useRef<AbortController | null>(null)
  const lastBoundsRef = useRef<string | null>(null)
  const pinsCountRef = useRef(0)
  const dispositionFilterSeenRef = useRef<string | null | undefined>(undefined)

  // Keep pins count in ref for use in fetchForBounds (avoids stale closure)
  useEffect(() => {
    pinsCountRef.current = state.pins.size
  }, [state.pins.size])

  // Load cached tile keys on mount
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(`${CACHE_PREFIX}tiles`)
      if (cached) {
        fetchedTilesRef.current = new Set(JSON.parse(cached))
      }
    } catch {
      // Ignore
    }
  }, [])

  // Save fetched tiles to session storage
  const saveFetchedTiles = useCallback(() => {
    try {
      const tiles = Array.from(fetchedTilesRef.current).slice(-200)
      sessionStorage.setItem(`${CACHE_PREFIX}tiles`, JSON.stringify(tiles))
    } catch {
      // Ignore quota errors
    }
  }, [])

  const fetchForBounds = useCallback((bounds: MapBounds, zoom: number) => {
    // Clear pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    // Don't fetch at low zoom
    if (zoom < MIN_ZOOM_FOR_FETCH) {
      setState(prev => ({ ...prev, loading: false, error: null }))
      return
    }

    const tileKey = getTileKey(bounds, zoom)
    
    // Skip if we've already fetched this tile (and no filter change)
    // IMPORTANT: Don't skip when we have no pins in memory - e.g. after app switch/background
    // when React state was lost but sessionStorage tile cache was restored
    const filterKey = dispositionFilter || 'all'
    const fullTileKey = `${tileKey}:${filterKey}`
    
    if (
      fetchedTilesRef.current.has(fullTileKey) &&
      lastBoundsRef.current === fullTileKey &&
      pinsCountRef.current > 0
    ) {
      return
    }

    debounceRef.current = setTimeout(async () => {
      // Cancel any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      abortControllerRef.current = new AbortController()

      setState(prev => ({ ...prev, loading: true, error: null }))
      lastBoundsRef.current = fullTileKey

      try {
        const ne = bounds.getNorthEast()
        const sw = bounds.getSouthWest()
        
        // BOUNDS ACCURACY: Add padding buffer to avoid edge dropouts
        // This ensures pins near viewport edges are included
        const latPad = (ne.lat() - sw.lat()) * 0.10
        const lngPad = (ne.lng() - sw.lng()) * 0.10
        
        const minLat = sw.lat() - latPad
        const maxLat = ne.lat() + latPad
        const minLng = sw.lng() - lngPad
        const maxLng = ne.lng() + lngPad
        
        // Build query params with padded bounds
        const params = new URLSearchParams({
          minLat: minLat.toString(),
          maxLat: maxLat.toString(),
          minLng: minLng.toString(),
          maxLng: maxLng.toString(),
          zoom: zoom.toString(),
        })
        
        // ANTIMERIDIAN HANDLING: Check if viewport crosses dateline
        // If minLng > maxLng, the viewport spans across the antimeridian (rare but handled)
        if (minLng > maxLng) {
          params.set('crossesAntimeridian', 'true')
        }

        if (dispositionFilter) {
          params.set('disposition', dispositionFilter)
        }

        // For incremental loading, exclude already-loaded IDs
        // Only do this if we have a reasonable number
        const currentIds = Array.from(state.pins.keys())
        if (currentIds.length > 0 && currentIds.length < 500) {
          params.set('excludeIds', currentIds.join(','))
        }

        const response = await fetch(`/api/canvass/leads/viewport?${params}`, {
          signal: abortControllerRef.current.signal,
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || data.message || 'Failed to fetch pins')
        }

        const data = await response.json()

        // Check for "zoom in" message
        if (data.minZoomRequired) {
          setState(prev => ({
            ...prev,
            loading: false,
            error: `Zoom in to level ${data.minZoomRequired} to see pins`,
          }))
          return
        }

        // Mark tile as fetched
        fetchedTilesRef.current.add(fullTileKey)
        saveFetchedTiles()

        // DEDUP/MERGE: Merge new pins by ID (upsert pattern)
        // This prevents duplicate pins from overlapping fetches
        // Latest data wins if a pin is returned multiple times
        setState(prev => {
          const newPins = new Map(prev.pins)
          
          for (const pin of data.pins || []) {
            // Upsert: replace existing entry or add new one
            newPins.set(pin.id, pin)
          }

          // DEV LOGGING: Diagnostic info for viewport mode
          if (process.env.NODE_ENV === 'development') {
            console.log('[Viewport]', {
              tileKey: fullTileKey,
              returned: data.pins?.length || 0,
              storeSize: newPins.size,
              truncated: data.truncated || false,
              hasMore: data.hasMore || false,
            })
          }

          return {
            ...prev,
            pins: newPins,
            loading: false,
            hasMore: data.hasMore || data.truncated || false,
            totalLoaded: newPins.size,
            error: null,
          }
        })

      } catch (err: any) {
        if (err.name === 'AbortError') return
        
        console.error('Viewport fetch error:', err)
        setState(prev => ({
          ...prev,
          loading: false,
          error: err.message || 'Failed to load pins',
        }))
      }
    }, DEBOUNCE_MS)
  }, [dispositionFilter, saveFetchedTiles, state.pins])

  // Fetch full pin details on demand (for click/modal)
  const getPinDetails = useCallback(async (id: string): Promise<FullPinData | null> => {
    // Check cache first
    const cached = state.pinDetails.get(id)
    if (cached) return cached

    try {
      const response = await fetch('/api/canvass/leads/viewport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      })

      if (!response.ok) {
        throw new Error('Failed to fetch pin details')
      }

      const data = await response.json()
      const lead = data.leads?.[0]

      if (lead) {
        // Cache the details
        setState(prev => {
          const newDetails = new Map(prev.pinDetails)
          newDetails.set(id, lead)
          return { ...prev, pinDetails: newDetails }
        })
        return lead
      }

      return null
    } catch (err) {
      console.error('Failed to fetch pin details:', err)
      return null
    }
  }, [state.pinDetails])

  const clearCache = useCallback(() => {
    setState({
      pins: new Map(),
      pinDetails: new Map(),
      loading: false,
      error: null,
      hasMore: false,
      totalLoaded: 0,
    })
    fetchedTilesRef.current.clear()
    lastBoundsRef.current = null
    
    try {
      // Clear session storage
      const keys = Object.keys(sessionStorage)
      for (const key of keys) {
        if (key.startsWith(CACHE_PREFIX)) {
          sessionStorage.removeItem(key)
        }
      }
    } catch {
      // Ignore
    }
  }, [])

  // Add a newly created pin directly to the state (without refetching)
  const addPin = useCallback((pin: ViewportPin) => {
    setState(prev => {
      const newPins = new Map(prev.pins)
      newPins.set(pin.id, pin)
      return {
        ...prev,
        pins: newPins,
        totalLoaded: newPins.size,
      }
    })
  }, [])

  // Update an existing pin in the state
  const updatePin = useCallback((pin: ViewportPin) => {
    setState(prev => {
      const newPins = new Map(prev.pins)
      newPins.set(pin.id, pin)
      // Also clear cached details so they get refetched
      const newDetails = new Map(prev.pinDetails)
      newDetails.delete(pin.id)
      return {
        ...prev,
        pins: newPins,
        pinDetails: newDetails,
      }
    })
  }, [])

  // Remove a pin from the state
  const removePin = useCallback((id: string) => {
    setState(prev => {
      const newPins = new Map(prev.pins)
      newPins.delete(id)
      const newDetails = new Map(prev.pinDetails)
      newDetails.delete(id)
      return {
        ...prev,
        pins: newPins,
        pinDetails: newDetails,
        totalLoaded: newPins.size,
      }
    })
  }, [])

  // When disposition filter changes, reset tile cache and pin store so merges
  // cannot leave stale pins from a previous filter (viewport API merges by ID).
  useEffect(() => {
    if (dispositionFilterSeenRef.current === undefined) {
      dispositionFilterSeenRef.current = dispositionFilter
      return
    }
    if (dispositionFilterSeenRef.current === dispositionFilter) return
    dispositionFilterSeenRef.current = dispositionFilter

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    fetchedTilesRef.current.clear()
    lastBoundsRef.current = null
    setState(prev => ({
      ...prev,
      pins: new Map(),
      pinDetails: new Map(),
      totalLoaded: 0,
      hasMore: false,
      error: null,
    }))
  }, [dispositionFilter])

  return {
    pins: Array.from(state.pins.values()),
    loading: state.loading,
    error: state.error,
    hasMore: state.hasMore,
    totalLoaded: state.totalLoaded,
    fetchForBounds,
    getPinDetails,
    clearCache,
    addPin,
    updatePin,
    removePin,
    dispositionFilter,
    setDispositionFilter,
  }
}

// Type declaration for google maps
declare const google: any
