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
  notes?: string
  created_at: string
  owner_user_id?: string
  owner?: { id: string; full_name: string }
}

// Cache configuration
const CACHE_PREFIX = 'cvp_v2:'  // Canvass Viewport v2
const DEBOUNCE_MS = 250
const MIN_ZOOM_FOR_FETCH = 10
const TILE_PRECISION = 3  // Decimal places for tile keys (lower = larger tiles)

// Generate tile key from bounds and zoom
function getTileKey(bounds: google.maps.LatLngBounds, zoom: number): string {
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
  fetchForBounds: (bounds: google.maps.LatLngBounds, zoom: number) => void
  getPinDetails: (id: string) => Promise<FullPinData | null>
  clearCache: () => void
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

  const fetchForBounds = useCallback((bounds: google.maps.LatLngBounds, zoom: number) => {
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
    const filterKey = dispositionFilter || 'all'
    const fullTileKey = `${tileKey}:${filterKey}`
    
    if (fetchedTilesRef.current.has(fullTileKey) && lastBoundsRef.current === fullTileKey) {
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
        
        // Build query params
        const params = new URLSearchParams({
          minLat: sw.lat().toString(),
          maxLat: ne.lat().toString(),
          minLng: sw.lng().toString(),
          maxLng: ne.lng().toString(),
          zoom: zoom.toString(),
        })

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

        // Merge new pins
        setState(prev => {
          const newPins = new Map(prev.pins)
          
          for (const pin of data.pins || []) {
            newPins.set(pin.id, pin)
          }

          return {
            ...prev,
            pins: newPins,
            loading: false,
            hasMore: data.hasMore || false,
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

  // Clear cache when disposition filter changes
  useEffect(() => {
    // Don't clear on initial mount
    if (lastBoundsRef.current !== null) {
      fetchedTilesRef.current.clear()
      lastBoundsRef.current = null
    }
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
    dispositionFilter,
    setDispositionFilter,
  }
}

// Type declaration for google maps
declare const google: any
