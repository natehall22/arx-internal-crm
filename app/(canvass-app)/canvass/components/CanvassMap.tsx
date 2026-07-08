'use client'

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { AssignedTerritoryMapPayload } from '@/lib/canvass-territories'
import type { CanvassPin } from '../page'
import type { ViewportPin } from '../lib/useViewportLeads'
import {
  HAIL_SWATH_LEGEND,
  STORM_REPORT_LEGEND,
  WEATHER_WINDOW_OPTIONS,
  WIND_IMPACT_HALO,
  windReportGetsHalo,
  readStoredWeatherLayer,
  readStoredWeatherWindowDays,
  reportDotFill,
  reportMarkerRadiusMeters,
  storeWeatherLayer,
  storeWeatherWindowDays,
  summarizeViewport,
  weatherFeatureStyle,
  weatherWindowLabel,
  widerWindowHintText,
  type WeatherContext,
  type WeatherFeatureCollection,
  type WeatherLayer,
  type WeatherWindowDays,
  DEFAULT_WEATHER_WINDOW_DAYS,
} from '../lib/weather-overlay'
import {
  MIN_ROOF_AGE_ZOOM,
  ROOF_AGE_LEGEND,
  ROOF_AGE_MARKER_STROKE,
  ROOF_AGE_MARKER_Z_INDEX,
  readStoredRoofAgeOn,
  roofAgeBucket,
  roofAgeMarkerRadiusMeters,
  storeRoofAgeOn,
  type RoofAgeFeatureCollection,
  type RoofAgeEmptyReason,
} from '../lib/roof-age-overlay'

export type { WeatherContext }

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
  onStormPeek?: (lat: number, lng: number) => void
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
  weatherOverlayEnabled?: boolean
  weatherTimeWindowDays?: number
  onWeatherContextChange?: (context: WeatherContext | null) => void
  /** Roof-age parcel layer (county year-built data) — flag-gated like weather */
  roofAgeEnabled?: boolean
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

// Existing-customer (sold) marker: large green $ badge.
// Built as data-URI SVGs at module scope so every sold marker shares the same
// cached image. Unsynced pins keep the established amber-ring + faded treatment.
function buildSaleBadgeUrl(synced: boolean): string {
  const ring = synced ? '#ffffff' : '#FCD34D'
  // Match legacy unsynced treatment: fills dim to 0.6 but the amber ring and
  // $ glyph stay fully opaque so the pending-sync signal reads in sunlight.
  const fillOpacity = synced ? '1' : '0.6'
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="76" height="88" viewBox="0 0 38 44">' +
    `<path d="M19 43L12 29h14z" fill="#15803d" fill-opacity="${fillOpacity}" stroke="${ring}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<circle cx="19" cy="17" r="15" fill="#16a34a" fill-opacity="${fillOpacity}" stroke="${ring}" stroke-width="3"/>` +
    '<text x="19" y="23.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="700" fill="#ffffff">$</text>' +
    '</svg>'
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
}
const SALE_BADGE_URL_SYNCED = buildSaleBadgeUrl(true)
const SALE_BADGE_URL_UNSYNCED = buildSaleBadgeUrl(false)

function teardropIconAndLabel(pin: AnyPin, dispositionColor: string, synced: boolean) {
  const sale = hasInstallationSalePin(pin)
  if (sale) {
    const icon = {
      url: synced ? SALE_BADGE_URL_SYNCED : SALE_BADGE_URL_UNSYNCED,
      scaledSize: new google.maps.Size(38, 44),
      anchor: new google.maps.Point(19, 43),
    }
    return { icon, label: null, sale }
  }
  const icon = {
    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z',
    fillColor: dispositionColor,
    fillOpacity: synced ? 1 : 0.6,
    strokeColor: synced ? '#ffffff' : '#FCD34D',
    strokeWeight: synced ? 2 : 3,
    scale: 1.5,
    anchor: new google.maps.Point(12, 22),
  }
  return { icon, label: null, sale }
}

function getMarkerVisualSignature(pin: AnyPin, dispositionColor: string, synced: boolean): string {
  const sale = hasInstallationSalePin(pin)
  // 'badge-v1' marks the large $ badge so a marker re-renders if this design changes.
  const saleVisual = sale ? 'badge-v1' : ''
  return [
    pin.lat,
    pin.lng,
    dispositionColor,
    synced ? '1' : '0',
    sale ? '1' : '0',
    saleVisual,
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
  onStormPeek,
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
  weatherOverlayEnabled = false,
  weatherTimeWindowDays = 730,
  roofAgeEnabled = false,
  onWeatherContextChange,
}: Props) {
  // Keep latest handlers without re-running marker sync / re-binding map listeners every render.
  const onMapClickRef = useRef(onMapClick)
  const onStormPeekRef = useRef(onStormPeek)
  const onPinClickRef = useRef(onPinClick)
  onMapClickRef.current = onMapClick
  onStormPeekRef.current = onStormPeek
  onPinClickRef.current = onPinClick
  const weatherOverlayEnabledRef = useRef(weatherOverlayEnabled)
  const weatherLayerRef = useRef<WeatherLayer>('off')
  weatherOverlayEnabledRef.current = weatherOverlayEnabled

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
  const weatherDataRef = useRef<any>(null)
  const weatherAbortRef = useRef<AbortController | null>(null)
  const [weatherLayer, setWeatherLayer] = useState<WeatherLayer>('off')
  useEffect(() => {
    weatherLayerRef.current = weatherLayer
  }, [weatherLayer])
  const [weatherControlExpanded, setWeatherControlExpanded] = useState(false)
  const [weatherWindowDays, setWeatherWindowDays] = useState<WeatherWindowDays>(() =>
    readStoredWeatherWindowDays(),
  )
  // Debounced pan/zoom refetch + client-side dedupe so idling on the same block
  // doesn't re-hit the API (server also caches by rounded bbox, but why ask).
  const weatherIdleTimerRef = useRef<number | null>(null)
  const weatherFetchKeyRef = useRef<string | null>(null)
  const [weatherStripText, setWeatherStripText] = useState('')
  const [weatherStripEmpty, setWeatherStripEmpty] = useState(false)
  const [weatherStripOffline, setWeatherStripOffline] = useState(false)
  const [weatherStripDegraded, setWeatherStripDegraded] = useState(false)
  const [weatherStripWiderHint, setWeatherStripWiderHint] = useState(false)
  const [weatherStripWiderTargetDays, setWeatherStripWiderTargetDays] =
    useState<WeatherWindowDays>(DEFAULT_WEATHER_WINDOW_DAYS)
  type WeatherCacheEntry = {
    layer: Exclude<WeatherLayer, 'off'>
    collection: WeatherFeatureCollection
    refreshedAt: string | null
  }
  const weatherLastGoodRef = useRef<WeatherCacheEntry | null>(null)
  const onWeatherContextChangeRef = useRef(onWeatherContextChange)
  onWeatherContextChangeRef.current = onWeatherContextChange

  const applyWeatherDataStyle = useCallback((feature: { getProperty: (key: string) => unknown }) => {
    const style = weatherFeatureStyle(feature) as Record<string, unknown>
    const icon = style.icon as Record<string, unknown> | undefined
    if (icon) {
      icon.path = google.maps.SymbolPath.CIRCLE
    }
    return style
  }, [])

  // Wind impact halos are google.maps.Circle overlays (the Data layer can't render
  // a point as an area), tracked separately so they clear with the features.
  const weatherHaloCirclesRef = useRef<any[]>([])

  const clearWeatherHalos = useCallback(() => {
    weatherHaloCirclesRef.current.forEach((circle) => circle.setMap(null))
    weatherHaloCirclesRef.current = []
  }, [])

  const clearWeatherFeatures = useCallback(() => {
    clearWeatherHalos()
    const data = weatherDataRef.current
    if (!data) return
    const features: any[] = []
    data.forEach((feature: any) => features.push(feature))
    features.forEach((feature) => data.remove(feature))
  }, [clearWeatherHalos])

  /** iOS Safari sometimes ignores `map` in the Circle constructor — attach explicitly. */
  const createWeatherCircle = useCallback((options: Record<string, unknown>, map: any) => {
    try {
      const circle = new google.maps.Circle(options)
      circle.setMap(map)
      return circle
    } catch {
      try {
        return new google.maps.Circle({ ...options, map })
      } catch {
        return null
      }
    }
  }, [])

  const weatherGraphicsMissing = useCallback((collection: WeatherFeatureCollection) => {
    const features = collection.features ?? []
    const reportFeatures = features.filter((f) => f.properties?.kind === 'report')
    const nonReportFeatures = features.filter((f) => f.properties?.kind !== 'report')
    if (reportFeatures.length > 0 && weatherHaloCirclesRef.current.length === 0) {
      return true
    }
    if (nonReportFeatures.length > 0) {
      const data = weatherDataRef.current
      if (!data) return true
      let onMap = 0
      data.forEach(() => {
        onMap += 1
      })
      if (onMap === 0) return true
    }
    return false
  }, [])

  // Must run after map init — the old useEffect ran before mapInstanceRef existed
  // (declaration order), so weatherDataRef stayed null while fetch+strip succeeded.
  const ensureWeatherDataLayer = useCallback(() => {
    if (!weatherOverlayEnabledRef.current) return null
    const map = mapInstanceRef.current
    if (!map) return null
    if (!weatherDataRef.current) {
      weatherDataRef.current = new google.maps.Data({ map })
      weatherDataRef.current.setStyle(applyWeatherDataStyle)
      weatherDataRef.current.addListener(
        'click',
        (e: {
          latLng?: { lat: () => number; lng: () => number }
          stop?: () => void
        }) => {
          if (
            !weatherOverlayEnabledRef.current ||
            weatherLayerRef.current === 'off' ||
            !e.latLng
          ) {
            return
          }
          e.stop?.()
          onStormPeekRef.current?.(e.latLng.lat(), e.latLng.lng())
        },
      )
    }
    return weatherDataRef.current
  }, [applyWeatherDataStyle])

  const paintWeatherCollection = useCallback(
    (collection: WeatherFeatureCollection) => {
      const map = mapInstanceRef.current
      if (!map || typeof google === 'undefined' || !google.maps?.Circle) return
      const features = collection?.features
      if (!Array.isArray(features)) return
      try {
        clearWeatherFeatures()
        // Storm report dots use google.maps.Circle — Data-layer SVG symbols often
        // fail to paint on iOS Safari (field-verified Jul 2026). Swaths/warnings
        // stay on the Data layer as polygons.
        for (const feature of features) {
          const props = feature.properties
          const kind = props?.kind

          if (kind === 'report') {
            if (feature.geometry?.type !== 'Point') continue
            const [lng, lat] = feature.geometry.coordinates as [number, number]
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
            const layer = String(props.layer || 'hail')
            const magnitude = Number(props.magnitude || 0)
            const damage = Boolean(props.damage)

            if (
              layer === 'wind' &&
              windReportGetsHalo(magnitude, damage) &&
              weatherHaloCirclesRef.current.length < WIND_IMPACT_HALO.maxCircles
            ) {
              const halo = createWeatherCircle(
                {
                  center: { lat, lng },
                  radius: WIND_IMPACT_HALO.radiusMeters,
                  fillColor: WIND_IMPACT_HALO.fill,
                  fillOpacity: WIND_IMPACT_HALO.fillOpacity,
                  strokeColor: WIND_IMPACT_HALO.stroke,
                  strokeOpacity: WIND_IMPACT_HALO.strokeOpacity,
                  strokeWeight: WIND_IMPACT_HALO.strokeWeight,
                  clickable: false,
                  zIndex: 1,
                },
                map,
              )
              if (halo) weatherHaloCirclesRef.current.push(halo)
            }

            const dot = createWeatherCircle(
              {
                center: { lat, lng },
                radius: reportMarkerRadiusMeters(layer, magnitude, damage),
                fillColor: reportDotFill(layer, magnitude, damage),
                fillOpacity: 1,
                strokeColor: '#FFFFFF',
                strokeOpacity: 1,
                strokeWeight: 3,
                clickable: true,
                zIndex: 3,
              },
              map,
            )
            if (dot) {
              dot.addListener('click', () => onStormPeekRef.current?.(lat, lng))
              weatherHaloCirclesRef.current.push(dot)
            }
            continue
          }

          const data = ensureWeatherDataLayer()
          if (!data) continue
          try {
            data.addGeoJson({ type: 'FeatureCollection', features: [feature] })
          } catch {
            // drop this one feature, keep going
          }
        }
        weatherDataRef.current?.setStyle(applyWeatherDataStyle)
      } catch {
        clearWeatherFeatures()
      }
    },
    [applyWeatherDataStyle, clearWeatherFeatures, createWeatherCircle, ensureWeatherDataLayer],
  )

  const ensureWeatherGraphicsVisible = useCallback(() => {
    if (!weatherOverlayEnabledRef.current || !mapInstanceRef.current) return
    const layer = weatherLayerRef.current
    if (layer === 'off') return
    const cached = weatherLastGoodRef.current
    if (!cached || cached.layer !== layer) return
    if (weatherGraphicsMissing(cached.collection)) {
      paintWeatherCollection(cached.collection)
    }
  }, [paintWeatherCollection, weatherGraphicsMissing])

  const publishWeatherContext = useCallback(
    (layer: Exclude<WeatherLayer, 'off'>, offline: boolean) => {
      const cached = weatherLastGoodRef.current
      if (!cached || cached.layer !== layer) {
        onWeatherContextChangeRef.current?.(null)
        return
      }
      onWeatherContextChangeRef.current?.({
        layer: cached.layer,
        features: cached.collection.features,
        refreshedAt: cached.refreshedAt,
        offline,
      })
    },
    [],
  )

  const mapCenterPoint = useCallback(() => {
    const center = mapInstanceRef.current?.getCenter()
    return center ? { lat: center.lat(), lng: center.lng() } : undefined
  }, [])

  const updateWeatherStrip = useCallback(
    (layer: Exclude<WeatherLayer, 'off'>, collection: WeatherFeatureCollection, offline: boolean) => {
      const summary = summarizeViewport(layer, collection.features, mapCenterPoint())
      if (offline && collection.features.length > 0) {
        const refreshedAt = weatherLastGoodRef.current?.refreshedAt
        const dateLabel = refreshedAt
          ? new Date(refreshedAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })
          : summary.dateLabel || 'earlier'
        setWeatherStripText(`Offline — last data shown · ${dateLabel}`)
        setWeatherStripEmpty(false)
        setWeatherStripOffline(true)
        return
      }
      if (offline) {
        setWeatherStripText('Offline — no stored storm data')
        setWeatherStripEmpty(true)
        setWeatherStripOffline(true)
        return
      }
      setWeatherStripText(summary.text)
      setWeatherStripEmpty(summary.empty)
      setWeatherStripOffline(false)
      setWeatherStripDegraded(false)
      setWeatherStripWiderHint(false)
    },
    [mapCenterPoint],
  )

  // Window options the org cap allows (default cap 730 shows all three). Options
  // above the cap are hidden rather than clamped silently, so the chips/pill can
  // never claim a wider search window than what was actually queried.
  const visibleWindowOptions = useMemo(() => {
    const allowed = WEATHER_WINDOW_OPTIONS.filter((option) => option.days <= weatherTimeWindowDays)
    return allowed.length > 0 ? allowed : [WEATHER_WINDOW_OPTIONS[0]]
  }, [weatherTimeWindowDays])

  // Largest visible option not exceeding the stored selection (falls back to the
  // smallest visible option). This is what the UI highlights AND what we query.
  const selectedWindowDays = useMemo(
    () =>
      visibleWindowOptions.reduce(
        (best, option) => (option.days <= weatherWindowDays ? option.days : best),
        visibleWindowOptions[0].days,
      ),
    [visibleWindowOptions, weatherWindowDays],
  )

  // Rep-selected window, hard-capped by the org-level prop (and again server-side).
  const effectiveWindowDays = Math.min(selectedWindowDays, weatherTimeWindowDays)
  const widestAllowedWindowDays = useMemo(
    () =>
      visibleWindowOptions.reduce(
        (best, option) => (option.days > best ? option.days : best),
        visibleWindowOptions[0].days,
      ),
    [visibleWindowOptions],
  )

  const fetchWeatherForLayer = useCallback(
    async (layer: Exclude<WeatherLayer, 'off'>) => {
      if (!weatherOverlayEnabledRef.current || !mapInstanceRef.current) return

      const finish = (offline: boolean) => {
        publishWeatherContext(layer, offline)
      }

      if (!navigator.onLine) {
        weatherAbortRef.current?.abort()
        // Invalidate the dedupe key: once we're back online, the next idle must
        // do a real fetch so the "Offline" strip/context can't stick around.
        weatherFetchKeyRef.current = null
        const cached = weatherLastGoodRef.current
        if (cached && cached.layer === layer) {
          paintWeatherCollection(cached.collection)
          updateWeatherStrip(layer, cached.collection, true)
        } else {
          clearWeatherFeatures()
          setWeatherStripText('Offline — no stored storm data')
          setWeatherStripEmpty(true)
          setWeatherStripOffline(true)
        }
        finish(true)
        return
      }

      const bounds = mapInstanceRef.current.getBounds()
      if (!bounds) {
        // Bounds can be null before the first idle on iOS — still paint cache so
        // the strip+graphics stay in sync, then let the idle listener fetch bounds.
        const cached = weatherLastGoodRef.current
        if (cached && cached.layer === layer) {
          paintWeatherCollection(cached.collection)
          updateWeatherStrip(layer, cached.collection, false)
          finish(false)
        }
        return
      }
      const ne = bounds.getNorthEast()
      const sw = bounds.getSouthWest()

      // Skip if we already have fresh data for effectively this viewport+layer+window
      // (rounded so sub-block pans dedupe). Cleared on layer off, window change, failure.
      const fetchKey = [
        ne.lat().toFixed(3),
        ne.lng().toFixed(3),
        sw.lat().toFixed(3),
        sw.lng().toFixed(3),
        layer,
        effectiveWindowDays,
      ].join('|')
      if (
        weatherFetchKeyRef.current === fetchKey &&
        weatherLastGoodRef.current?.layer === layer
      ) {
        // Re-paint even on dedupe — the first fetch may have landed before the map
        // (or Data layer) existed, updating the strip but skipping graphics.
        paintWeatherCollection(weatherLastGoodRef.current.collection)
        ensureWeatherGraphicsVisible()
        return
      }

      weatherAbortRef.current?.abort()
      const controller = new AbortController()
      weatherAbortRef.current = controller
      const timeoutId = window.setTimeout(() => controller.abort(), 7000)

      // First load for this layer: tell the rep something is happening instead of
      // a silent empty map. Pans keep the last paint until fresh data lands.
      if (!weatherLastGoodRef.current || weatherLastGoodRef.current.layer !== layer) {
        setWeatherStripText('Checking storms…')
        setWeatherStripEmpty(false)
        setWeatherStripOffline(false)
        setWeatherStripDegraded(false)
        setWeatherStripWiderHint(false)
      }

      const bboxParams = {
        n: String(ne.lat()),
        s: String(sw.lat()),
        e: String(ne.lng()),
        w: String(sw.lng()),
        layer,
      }

      try {
        const params = new URLSearchParams({
          ...bboxParams,
          windowDays: String(effectiveWindowDays),
        })

        const response = await fetch(`/api/canvass/weather?${params.toString()}`, {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('weather fetch failed')

        const payload = (await response.json()) as WeatherFeatureCollection
        if (controller.signal.aborted) return

        if (payload.degraded) {
          weatherFetchKeyRef.current = null
          clearWeatherFeatures()
          setWeatherStripText("Couldn't load storm data — tap to retry")
          setWeatherStripEmpty(true)
          setWeatherStripOffline(false)
          setWeatherStripDegraded(true)
          setWeatherStripWiderHint(false)
          onWeatherContextChangeRef.current?.(null)
          finish(false)
          return
        }

        weatherFetchKeyRef.current = fetchKey
        weatherLastGoodRef.current = {
          layer,
          collection: payload,
          refreshedAt: payload.refreshedAt || new Date().toISOString(),
        }
        paintWeatherCollection(payload)
        ensureWeatherGraphicsVisible()

        const primarySummary = summarizeViewport(layer, payload.features, mapCenterPoint())
        if (primarySummary.empty && effectiveWindowDays < widestAllowedWindowDays) {
          // Lightweight wider-window probe: only when the selected window is empty
          // but older recorded storms may still exist within the org-allowed cap.
          try {
            const widerParams = new URLSearchParams({
              ...bboxParams,
              windowDays: String(widestAllowedWindowDays),
            })
            const widerResponse = await fetch(`/api/canvass/weather?${widerParams.toString()}`, {
              signal: controller.signal,
            })
            if (!controller.signal.aborted && widerResponse.ok) {
              const widerPayload = (await widerResponse.json()) as WeatherFeatureCollection
              if (
                !widerPayload.degraded &&
                !summarizeViewport(layer, widerPayload.features, mapCenterPoint()).empty
              ) {
                setWeatherStripText(
                  widerWindowHintText(effectiveWindowDays, widestAllowedWindowDays, layer),
                )
                setWeatherStripEmpty(true)
                setWeatherStripOffline(false)
                setWeatherStripDegraded(false)
                setWeatherStripWiderHint(true)
                setWeatherStripWiderTargetDays(widestAllowedWindowDays)
                finish(false)
                return
              }
            }
          } catch {
            // Probe failure is non-fatal — fall through to the normal empty strip.
          }
        }

        updateWeatherStrip(layer, payload, false)
        finish(false)
      } catch {
        if (controller.signal.aborted) return
        weatherFetchKeyRef.current = null

        const cached = weatherLastGoodRef.current
        if (cached && cached.layer === layer) {
          paintWeatherCollection(cached.collection)
          ensureWeatherGraphicsVisible()
          updateWeatherStrip(layer, cached.collection, !navigator.onLine)
          finish(!navigator.onLine)
        } else {
          // No cached data and the request failed — this is a load failure, not
          // a confirmed "no storms" result, so don't imply the area is clear.
          clearWeatherFeatures()
          setWeatherStripText(
            !navigator.onLine ? 'Offline — no stored storm data' : "Couldn't load storm data",
          )
          setWeatherStripEmpty(true)
          setWeatherStripOffline(!navigator.onLine)
          setWeatherStripDegraded(false)
          setWeatherStripWiderHint(false)
          onWeatherContextChangeRef.current?.(null)
        }
      } finally {
        window.clearTimeout(timeoutId)
      }
    },
    [
      clearWeatherFeatures,
      effectiveWindowDays,
      ensureWeatherGraphicsVisible,
      mapCenterPoint,
      paintWeatherCollection,
      publishWeatherContext,
      updateWeatherStrip,
      weatherTimeWindowDays,
      widestAllowedWindowDays,
    ],
  )
  // Latest fetcher for the map 'idle' listener (bound once at map init).
  const fetchWeatherForLayerRef = useRef(fetchWeatherForLayer)
  fetchWeatherForLayerRef.current = fetchWeatherForLayer
  const ensureWeatherDataLayerRef = useRef(ensureWeatherDataLayer)
  ensureWeatherDataLayerRef.current = ensureWeatherDataLayer
  const paintWeatherCollectionRef = useRef(paintWeatherCollection)
  paintWeatherCollectionRef.current = paintWeatherCollection
  const ensureWeatherGraphicsVisibleRef = useRef(ensureWeatherGraphicsVisible)
  ensureWeatherGraphicsVisibleRef.current = ensureWeatherGraphicsVisible

  const handleWeatherLayerSelect = useCallback(
    (nextLayer: WeatherLayer) => {
      weatherAbortRef.current?.abort()
      if (weatherIdleTimerRef.current) {
        window.clearTimeout(weatherIdleTimerRef.current)
        weatherIdleTimerRef.current = null
      }
      // Sync before setState — idle listeners and map init read this ref immediately;
      // a useEffect-only update let them see 'off' right after WIND/HAIL was tapped.
      weatherLayerRef.current = nextLayer
      setWeatherLayer(nextLayer)
      if (nextLayer === 'off') {
        weatherFetchKeyRef.current = null
        clearWeatherFeatures()
        setWeatherControlExpanded(false)
        setWeatherStripText('')
        setWeatherStripEmpty(false)
        setWeatherStripOffline(false)
        setWeatherStripDegraded(false)
        setWeatherStripWiderHint(false)
        onWeatherContextChangeRef.current?.(null)
        return
      }
      storeWeatherLayer(nextLayer)
      // Keep the hail/wind segmented control expanded while a layer is active so
      // flipping hail↔wind is a single tap (reps switch constantly mid-storm).
      void fetchWeatherForLayer(nextLayer)
    },
    [clearWeatherFeatures, fetchWeatherForLayer],
  )

  const handleWeatherWindowSelect = useCallback(
    (days: WeatherWindowDays) => {
      if (days === weatherWindowDays) return
      // Kill any pending pan-debounce so it can't race the window-change refetch
      // with an identical (aborted-and-reissued) request.
      if (weatherIdleTimerRef.current) {
        window.clearTimeout(weatherIdleTimerRef.current)
        weatherIdleTimerRef.current = null
      }
      setWeatherWindowDays(days)
      storeWeatherWindowDays(days)
      // The narrower/wider window invalidates the dedupe key; the effect below
      // refetches once state (and the fetch callback) reflect the new window.
      weatherFetchKeyRef.current = null
    },
    [weatherWindowDays],
  )

  // Refetch after a window change while a layer is live.
  const prevWeatherWindowRef = useRef(weatherWindowDays)
  useEffect(() => {
    if (prevWeatherWindowRef.current === weatherWindowDays) return
    prevWeatherWindowRef.current = weatherWindowDays
    if (weatherOverlayEnabled && weatherLayer !== 'off') {
      void fetchWeatherForLayer(weatherLayer)
    }
  }, [weatherWindowDays, weatherLayer, weatherOverlayEnabled, fetchWeatherForLayer])

  useEffect(() => {
    return () => {
      weatherAbortRef.current?.abort()
      if (weatherIdleTimerRef.current) {
        window.clearTimeout(weatherIdleTimerRef.current)
      }
    }
  }, [])

  // ---- Roof-age parcel layer (county year-built data) ----
  const roofAgeEnabledRef = useRef(roofAgeEnabled)
  roofAgeEnabledRef.current = roofAgeEnabled
  const [roofAgeOn, setRoofAgeOn] = useState(() => readStoredRoofAgeOn())
  const roofAgeOnRef = useRef(roofAgeOn)
  const [roofAgeZoomHint, setRoofAgeZoomHint] = useState(false)
  // County didn't publish year-built for this area (e.g. Cabarrus) — honest empty, not a bug.
  const [roofAgeNoData, setRoofAgeNoData] = useState(false)
  const [roofAgeEmptyReason, setRoofAgeEmptyReason] = useState<RoofAgeEmptyReason | null>(null)
  const [roofAgeEmptyCounty, setRoofAgeEmptyCounty] = useState<string | null>(null)
  const [roofAgeLoadError, setRoofAgeLoadError] = useState(false)
  // google.maps.Circle markers — Data-layer SVG symbols fail on iOS Safari (Jul 2026).
  const roofAgeCirclesRef = useRef<any[]>([])
  const roofAgeAbortRef = useRef<AbortController | null>(null)
  const roofAgeFetchKeyRef = useRef<string | null>(null)
  const roofAgeIdleTimerRef = useRef<number | null>(null)

  const clearRoofAgeCircles = useCallback(() => {
    roofAgeCirclesRef.current.forEach((circle) => circle.setMap(null))
    roofAgeCirclesRef.current = []
  }, [])

  const paintRoofAgeCollection = useCallback(
    (collection: RoofAgeFeatureCollection) => {
      clearRoofAgeCircles()
      const map = mapInstanceRef.current
      if (!map) return
      for (const feature of collection.features) {
        if (feature.geometry?.type !== 'Point') continue
        const [lng, lat] = feature.geometry.coordinates as [number, number]
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
        const age = Number(feature.properties?.roofAge || 0)
        const bucket = roofAgeBucket(age)
        if (!bucket) continue
        try {
          roofAgeCirclesRef.current.push(
            new google.maps.Circle({
              map,
              center: { lat, lng },
              radius: roofAgeMarkerRadiusMeters(age),
              fillColor: bucket.fill,
              fillOpacity: 1,
              ...ROOF_AGE_MARKER_STROKE,
              clickable: false,
              zIndex: ROOF_AGE_MARKER_Z_INDEX,
            }),
          )
        } catch {
          // drop this marker, keep going
        }
      }
    },
    [clearRoofAgeCircles],
  )

  const fetchRoofAge = useCallback(async () => {
    if (!roofAgeEnabledRef.current || !roofAgeOnRef.current || !mapInstanceRef.current) return
    const zoom = mapInstanceRef.current.getZoom()
    if (zoom == null || zoom < MIN_ROOF_AGE_ZOOM) {
      // Too far out for parcel dots — clear and show the "zoom in" hint on the pill.
      roofAgeFetchKeyRef.current = null
      clearRoofAgeCircles()
      setRoofAgeZoomHint(true)
      setRoofAgeNoData(false)
      setRoofAgeEmptyReason(null)
      setRoofAgeEmptyCounty(null)
      setRoofAgeLoadError(false)
      return
    }
    setRoofAgeZoomHint(false)
    const bounds = mapInstanceRef.current.getBounds()
    if (!bounds) return
    const ne = bounds.getNorthEast()
    const sw = bounds.getSouthWest()
    const fetchKey = [
      ne.lat().toFixed(3),
      ne.lng().toFixed(3),
      sw.lat().toFixed(3),
      sw.lng().toFixed(3),
    ].join('|')
    if (roofAgeFetchKeyRef.current === fetchKey) return

    roofAgeAbortRef.current?.abort()
    const controller = new AbortController()
    roofAgeAbortRef.current = controller
    const timeoutId = window.setTimeout(() => controller.abort(), 15000)
    try {
      const params = new URLSearchParams({
        n: String(ne.lat()),
        s: String(sw.lat()),
        e: String(ne.lng()),
        w: String(sw.lng()),
      })
      const response = await fetch(`/api/canvass/roof-age?${params.toString()}`, {
        signal: controller.signal,
      })
      if (!response.ok) throw new Error('roof-age fetch failed')
      const payload = (await response.json()) as RoofAgeFeatureCollection
      if (controller.signal.aborted) return
      if (payload.degraded) {
        // Match weather overlay: clear stale viewport data and surface retry on next idle.
        roofAgeFetchKeyRef.current = null
        clearRoofAgeCircles()
        setRoofAgeNoData(false)
        setRoofAgeEmptyReason(null)
        setRoofAgeEmptyCounty(null)
        setRoofAgeLoadError(true)
        return
      }
      // Rep may have zoomed out or panned while the request was in flight.
      if (!roofAgeEnabledRef.current || !roofAgeOnRef.current) return
      const liveZoom = mapInstanceRef.current?.getZoom()
      if (liveZoom == null || liveZoom < MIN_ROOF_AGE_ZOOM) return
      const liveBounds = mapInstanceRef.current?.getBounds()
      if (!liveBounds) return
      const liveNe = liveBounds.getNorthEast()
      const liveSw = liveBounds.getSouthWest()
      const liveKey = [
        liveNe.lat().toFixed(3),
        liveNe.lng().toFixed(3),
        liveSw.lat().toFixed(3),
        liveSw.lng().toFixed(3),
      ].join('|')
      if (liveKey !== fetchKey) return

      roofAgeFetchKeyRef.current = fetchKey
      paintRoofAgeCollection(payload)
      setRoofAgeNoData(payload.features.length === 0)
      setRoofAgeEmptyReason(payload.features.length === 0 ? payload.emptyReason ?? null : null)
      setRoofAgeEmptyCounty(payload.features.length === 0 ? payload.county ?? null : null)
      setRoofAgeLoadError(false)
    } catch {
      if (controller.signal.aborted) return
      // Fail quiet (offline, timeout) — clear stale dots so reps don't knock off-map.
      roofAgeFetchKeyRef.current = null
      clearRoofAgeCircles()
      setRoofAgeNoData(false)
      setRoofAgeEmptyReason(null)
      setRoofAgeEmptyCounty(null)
      setRoofAgeLoadError(true)
    } finally {
      window.clearTimeout(timeoutId)
    }
  }, [clearRoofAgeCircles, paintRoofAgeCollection])
  const fetchRoofAgeRef = useRef(fetchRoofAge)
  fetchRoofAgeRef.current = fetchRoofAge

  const handleRoofAgeToggle = useCallback(() => {
    const next = !roofAgeOnRef.current
    roofAgeOnRef.current = next
    setRoofAgeOn(next)
    storeRoofAgeOn(next)
    if (next) {
      void fetchRoofAgeRef.current()
    } else {
      roofAgeAbortRef.current?.abort()
      roofAgeFetchKeyRef.current = null
      clearRoofAgeCircles()
      setRoofAgeZoomHint(false)
      setRoofAgeNoData(false)
      setRoofAgeEmptyReason(null)
      setRoofAgeEmptyCounty(null)
      setRoofAgeLoadError(false)
    }
  }, [clearRoofAgeCircles])

  useEffect(() => {
    if (!roofAgeEnabled || !mapLoaded || !mapInstanceRef.current) return
    if (roofAgeOnRef.current) void fetchRoofAgeRef.current()
  }, [mapLoaded, roofAgeEnabled])

  useEffect(() => {
    return () => {
      roofAgeAbortRef.current?.abort()
      if (roofAgeIdleTimerRef.current) {
        window.clearTimeout(roofAgeIdleTimerRef.current)
      }
      clearRoofAgeCircles()
    }
  }, [clearRoofAgeCircles])

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

    // Data layer for swaths/warnings + repaint/fetch any overlay work that raced map init.
    if (weatherOverlayEnabledRef.current) {
      ensureWeatherDataLayerRef.current()
      const activeLayer = weatherLayerRef.current
      if (activeLayer !== 'off') {
        const cached = weatherLastGoodRef.current
        if (cached && cached.layer === activeLayer) {
          paintWeatherCollectionRef.current(cached.collection)
          ensureWeatherGraphicsVisibleRef.current()
        }
        void fetchWeatherForLayerRef.current(activeLayer)
      }
    }

    // Click listener (ref so we don't recreate the map when the parent passes a new callback each render)
    mapInstanceRef.current.addListener('click', (e: any) => {
      if (e?.latLng) {
        const lat = e.latLng.lat()
        const lng = e.latLng.lng()
        if (weatherOverlayEnabledRef.current && weatherLayerRef.current !== 'off') {
          onStormPeekRef.current?.(lat, lng)
        } else {
          onMapClickRef.current(lat, lng)
        }
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

    // Weather overlay follows the viewport: refetch (debounced) after every
    // pan/zoom while a layer is on, so a rep scouting a new neighborhood sees
    // its storms without re-toggling. Dedupe inside fetchWeatherForLayer keeps
    // same-block idles from re-hitting the API.
    mapInstanceRef.current.addListener('idle', () => {
      if (!weatherOverlayEnabledRef.current) return
      const layer = weatherLayerRef.current
      if (layer === 'off') return
      if (weatherIdleTimerRef.current) window.clearTimeout(weatherIdleTimerRef.current)
      weatherIdleTimerRef.current = window.setTimeout(() => {
        weatherIdleTimerRef.current = null
        const currentLayer = weatherLayerRef.current
        if (currentLayer === 'off') return
        ensureWeatherGraphicsVisibleRef.current()
        void fetchWeatherForLayerRef.current(currentLayer)
      }, 700)
    })

    // Roof-age layer follows the viewport the same way (debounced idle refetch).
    mapInstanceRef.current.addListener('idle', () => {
      if (!roofAgeEnabledRef.current || !roofAgeOnRef.current) return
      if (roofAgeIdleTimerRef.current) window.clearTimeout(roofAgeIdleTimerRef.current)
      roofAgeIdleTimerRef.current = window.setTimeout(() => {
        roofAgeIdleTimerRef.current = null
        void fetchRoofAgeRef.current()
      }, 700)
    })

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
      
      {/* Weather status strip */}
      {weatherOverlayEnabled && weatherLayer !== 'off' && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-10 max-w-[88vw]"
          style={{ top: 'calc(max(16px, env(safe-area-inset-top)) + 56px)' }}
        >
          <div
            role={weatherStripDegraded || weatherStripWiderHint ? 'button' : undefined}
            tabIndex={weatherStripDegraded || weatherStripWiderHint ? 0 : undefined}
            onClick={
              weatherStripWiderHint
                ? () => handleWeatherWindowSelect(weatherStripWiderTargetDays)
                : weatherStripDegraded
                  ? () => void fetchWeatherForLayer(weatherLayer)
                  : undefined
            }
            onKeyDown={
              weatherStripDegraded || weatherStripWiderHint
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      if (weatherStripWiderHint) {
                        handleWeatherWindowSelect(weatherStripWiderTargetDays)
                      } else {
                        void fetchWeatherForLayer(weatherLayer)
                      }
                    }
                  }
                : undefined
            }
            className={`rounded-full shadow-lg px-4 py-2 text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${
              weatherStripOffline
                ? 'bg-amber-50 text-[#2c2c2a] border border-amber-200'
                : weatherStripDegraded
                  ? 'bg-orange-50 text-[#2c2c2a] border border-orange-300 cursor-pointer'
                  : weatherStripWiderHint
                    ? 'bg-indigo-50 text-[#2c2c2a] border border-indigo-300 cursor-pointer'
                    : weatherStripEmpty
                      ? 'bg-white text-[#2c2c2a] italic'
                      : 'bg-white text-[#2c2c2a]'
            }`}
          >
            {weatherStripOffline && (
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-2 align-middle" />
            )}
            {weatherStripDegraded && <span className="mr-1 align-middle">⟳</span>}
            {weatherStripText}
          </div>
        </div>
      )}

      {/* Map controls - left side */}
      <div className="absolute bottom-24 left-4 flex flex-col gap-2 z-10">
        {weatherOverlayEnabled && (
          <div className="flex flex-col gap-2 items-start">
            {weatherControlExpanded ? (
              /* Expanded panel: layer + time window + legend in one card so nothing
                 floats mid-screen. Collapses to a compact pill for knocking. */
              <div className="bg-white rounded-2xl shadow-xl w-[232px] overflow-hidden">
                <div className="flex items-center justify-between pl-3 pr-1 pt-1.5 pb-0.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#2c2c2a]">
                    Storm overlay
                  </span>
                  <button
                    type="button"
                    onClick={() => setWeatherControlExpanded(false)}
                    className="p-2.5 text-gray-500 active:text-gray-700"
                    aria-label="Collapse storm overlay panel"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                {/* Layer segmented control */}
                <div className="px-3">
                  <div className="grid grid-cols-2 gap-1 bg-gray-100 rounded-xl p-1">
                    {(['hail', 'wind'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => handleWeatherLayerSelect(option)}
                        aria-pressed={weatherLayer === option}
                        className={`h-10 rounded-lg text-sm font-semibold capitalize transition-colors ${
                          weatherLayer === option
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-[#2c2c2a] active:bg-gray-200'
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Time window chips */}
                <div className="px-3 pt-2">
                  <div className="flex gap-1.5">
                    {visibleWindowOptions.map((option) => (
                      <button
                        key={option.days}
                        type="button"
                        onClick={() => handleWeatherWindowSelect(option.days)}
                        title={option.title}
                        aria-pressed={selectedWindowDays === option.days}
                        className={`flex-1 h-10 rounded-lg text-xs font-semibold border transition-colors ${
                          selectedWindowDays === option.days
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'bg-white border-gray-300 text-[#2c2c2a] active:bg-gray-100'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Legend for the active layer */}
                {weatherLayer !== 'off' && (
                  <div className="px-3 pt-2 space-y-1 text-[11px] leading-tight text-[#2c2c2a]">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: STORM_REPORT_LEGEND.fill,
                          boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.35), 0 0 0 1.5px ${STORM_REPORT_LEGEND.stroke}`,
                        }}
                      />
                      <span>{STORM_REPORT_LEGEND.label}</span>
                    </div>
                    {weatherLayer === 'hail' &&
                      HAIL_SWATH_LEGEND.map((item) => (
                        <div key={item.label} className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-sm flex-shrink-0 opacity-80"
                            style={{
                              backgroundColor: item.fill,
                              boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.35), 0 0 0 1.5px ${item.stroke}`,
                            }}
                          />
                          <span>{item.label} swath</span>
                        </div>
                      ))}
                    {weatherLayer === 'wind' && (
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: WIND_IMPACT_HALO.fill,
                            opacity: 0.55,
                            boxShadow: `0 0 0 1.5px ${WIND_IMPACT_HALO.stroke}`,
                          }}
                        />
                        <span>Impact area — no wind swaths (damage / 58+ mph)</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="p-3 pt-2.5">
                  <button
                    type="button"
                    onClick={() => handleWeatherLayerSelect('off')}
                    className="w-full h-10 rounded-xl border border-gray-300 text-sm font-semibold text-[#2c2c2a] active:bg-gray-100"
                  >
                    Hide overlay
                  </button>
                </div>
              </div>
            ) : weatherLayer !== 'off' ? (
              /* Active + collapsed: compact status pill. Body reopens the panel;
                 ✕ is the desire path — one thumb-tap kills the overlay clutter. */
              <div className="bg-white rounded-full shadow-lg flex items-center h-12 pl-1 pr-1">
                <button
                  type="button"
                  onClick={() => setWeatherControlExpanded(true)}
                  className="flex items-center gap-1.5 h-10 pl-2 pr-1.5 rounded-full active:bg-gray-100"
                  aria-label={`Storm overlay settings — ${weatherLayer}, ${weatherWindowLabel(selectedWindowDays)}`}
                >
                  <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
                    />
                  </svg>
                  <span className="text-xs font-bold uppercase tracking-wide text-[#2c2c2a]">
                    {weatherLayer}
                  </span>
                  <span className="text-[11px] font-semibold text-gray-500">
                    · {weatherWindowLabel(selectedWindowDays)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleWeatherLayerSelect('off')}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-gray-500 active:bg-gray-100"
                  aria-label="Turn storm overlay off"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              /* Off + collapsed: one tap turns the last-used layer on AND opens the
                 panel — see storms immediately, tune after (desire path first). */
              <button
                type="button"
                onClick={() => {
                  setWeatherControlExpanded(true)
                  handleWeatherLayerSelect(readStoredWeatherLayer())
                }}
                className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center"
                title="Storm overlay"
                aria-label="Show storm overlay"
              >
                <svg className="w-6 h-6 text-[#2c2c2a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
                  />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Roof-age parcel layer control */}
        {roofAgeEnabled && (
          <div className="flex flex-col gap-1.5 items-start">
            {roofAgeOn ? (
              <>
                <div className="bg-white rounded-full shadow-lg flex items-center h-12 pl-1 pr-1">
                  <div className="flex items-center gap-1.5 h-10 pl-2 pr-1.5">
                    <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                      />
                    </svg>
                    <span className="text-xs font-bold uppercase tracking-wide text-[#2c2c2a]">
                      Roof age
                    </span>
                    {roofAgeZoomHint ? (
                      <span className="text-[11px] font-semibold text-gray-500">· zoom in</span>
                    ) : roofAgeLoadError ? (
                      <span className="text-[11px] font-semibold text-gray-500">· couldn&apos;t load</span>
                    ) : roofAgeNoData ? (
                      <span className="text-[11px] font-semibold text-gray-500">
                        {roofAgeEmptyReason === 'county_gaps'
                          ? `· no year-built data${roofAgeEmptyCounty ? ` (${roofAgeEmptyCounty})` : ''}`
                          : roofAgeEmptyReason === 'all_too_new'
                            ? '· all homes ≤10 yrs'
                            : '· no data here'}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={handleRoofAgeToggle}
                    className="w-10 h-10 rounded-full flex items-center justify-center text-gray-500 active:bg-gray-100"
                    aria-label="Turn roof age layer off"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {!roofAgeZoomHint && (
                  <div className="bg-white rounded-xl shadow-lg px-3 py-2 space-y-1 text-[11px] leading-tight text-[#2c2c2a]">
                    {ROOF_AGE_LEGEND.map((item) => (
                      <div key={item.label} className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-[2px] flex-shrink-0"
                          style={{
                            backgroundColor: item.fill,
                            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.35), 0 0 0 1.5px #FFFFFF',
                          }}
                        />
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={handleRoofAgeToggle}
                className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center"
                title="Roof age"
                aria-label="Show roof age layer"
              >
                <svg className="w-6 h-6 text-[#2c2c2a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                  />
                </svg>
              </button>
            )}
          </div>
        )}

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
