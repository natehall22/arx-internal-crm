/**
 * Shared behaviour for a toggleable, zoom-gated, bbox-fetched canvass map layer.
 *
 * The weather overlay and roof-age layer each hand-rolled this same ~190 lines.
 * Solar is the third, so the logic lives here instead of being written again.
 * Roof-age and weather are deliberately NOT migrated in the same change — they
 * are live field tooling and their migration deserves its own review. This hook
 * is a faithful extraction of the roof-age implementation so that migration is
 * mechanical when it happens.
 *
 * What it handles, all of which was load-bearing in the original:
 *  - hydration-safe persisted on/off (server can't read localStorage, so the
 *    first client render must also say "off", then correct before paint)
 *  - viewport dedupe, so panning within the same rounded bbox doesn't refetch
 *  - abort + timeout on every request
 *  - stale-response guards: re-check enabled/zoom/bbox AFTER the await, because
 *    the rep may have panned or zoomed out while the request was in flight
 *  - `degraded` responses clear stale markers rather than showing old data
 *  - full cleanup on unmount
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export type OverlayPayload = {
  features: unknown[]
  degraded?: boolean
  emptyReason?: string
}

type Options<P extends OverlayPayload> = {
  /** Feature flag. When false the hook is inert and never fetches. */
  enabled: boolean
  /** API path, e.g. '/api/canvass/solar'. Receives n/s/e/w query params. */
  endpoint: string
  /** Below this zoom the layer clears and reports zoomHint. */
  minZoom: number
  /** localStorage key for the on/off preference. */
  storageKey: string
  /** Live map instance, or null before load. */
  mapRef: React.MutableRefObject<any>
  /** Whether the map has finished loading — triggers the initial fetch. */
  mapLoaded: boolean
  /** Draw the payload. Called after the stale-response guards pass. */
  paint: (payload: P) => void
  /** Remove everything this layer drew. */
  clear: () => void
  /** Request timeout. */
  timeoutMs?: number
}

function readStored(key: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function writeStored(key: string, on: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, on ? 'true' : 'false')
  } catch {
    // private-mode Safari throws on setItem — the toggle still works this session
  }
}

/** Rounded bbox identity. Panning within the same key is not a new fetch. */
function boundsKey(bounds: any): string | null {
  if (!bounds) return null
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  return [ne.lat().toFixed(3), ne.lng().toFixed(3), sw.lat().toFixed(3), sw.lng().toFixed(3)].join('|')
}

export function useCanvassOverlay<P extends OverlayPayload>(options: Options<P>) {
  const { enabled, endpoint, minZoom, storageKey, mapRef, mapLoaded, paint, clear } = options
  const timeoutMs = options.timeoutMs ?? 15000

  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  // Seeded false so the hydrating render matches the server's. The stored value
  // is applied in useLayoutEffect, after hydration commits but before paint.
  const [on, setOn] = useState(false)
  const onRef = useRef(false)

  useLayoutEffect(() => {
    if (readStored(storageKey)) {
      onRef.current = true
      setOn(true)
    }
  }, [storageKey])

  const [zoomHint, setZoomHint] = useState(false)
  const [noData, setNoData] = useState(false)
  const [emptyReason, setEmptyReason] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const fetchKeyRef = useRef<string | null>(null)
  const idleTimerRef = useRef<number | null>(null)

  const paintRef = useRef(paint)
  paintRef.current = paint
  const clearRef = useRef(clear)
  clearRef.current = clear

  const resetState = useCallback(() => {
    setNoData(false)
    setEmptyReason(null)
    setLoadError(false)
  }, [])

  const fetchViewport = useCallback(async () => {
    if (!enabledRef.current || !onRef.current || !mapRef.current) return

    const zoom = mapRef.current.getZoom()
    if (zoom == null || zoom < minZoom) {
      fetchKeyRef.current = null
      clearRef.current()
      setZoomHint(true)
      resetState()
      return
    }
    setZoomHint(false)

    const bounds = mapRef.current.getBounds()
    const fetchKey = boundsKey(bounds)
    if (!fetchKey) return
    if (fetchKeyRef.current === fetchKey) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

    try {
      const ne = bounds.getNorthEast()
      const sw = bounds.getSouthWest()
      const params = new URLSearchParams({
        n: String(ne.lat()),
        s: String(sw.lat()),
        e: String(ne.lng()),
        w: String(sw.lng()),
      })
      const response = await fetch(`${endpoint}?${params.toString()}`, {
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`${endpoint} fetch failed`)
      const payload = (await response.json()) as P
      if (controller.signal.aborted) return

      if (payload.degraded) {
        fetchKeyRef.current = null
        clearRef.current()
        setNoData(false)
        setEmptyReason(null)
        setLoadError(true)
        return
      }

      // The rep may have panned or zoomed out while this was in flight.
      if (!enabledRef.current || !onRef.current) return
      const liveZoom = mapRef.current?.getZoom()
      if (liveZoom == null || liveZoom < minZoom) return
      if (boundsKey(mapRef.current?.getBounds()) !== fetchKey) return

      fetchKeyRef.current = fetchKey
      paintRef.current(payload)
      const empty = payload.features.length === 0
      setNoData(empty)
      setEmptyReason(empty ? payload.emptyReason ?? null : null)
      setLoadError(false)
    } catch {
      if (controller.signal.aborted) return
      // Fail quiet (offline, timeout) — clear stale markers so a rep never
      // knocks a door that isn't in the current viewport's data.
      fetchKeyRef.current = null
      clearRef.current()
      setNoData(false)
      setEmptyReason(null)
      setLoadError(true)
    } finally {
      window.clearTimeout(timeoutId)
    }
  }, [endpoint, minZoom, mapRef, resetState, timeoutMs])

  const fetchRef = useRef(fetchViewport)
  fetchRef.current = fetchViewport

  const toggle = useCallback(() => {
    const next = !onRef.current
    onRef.current = next
    setOn(next)
    writeStored(storageKey, next)
    if (next) {
      void fetchRef.current()
    } else {
      abortRef.current?.abort()
      fetchKeyRef.current = null
      clearRef.current()
      setZoomHint(false)
      resetState()
    }
  }, [storageKey, resetState])

  /** Call from the map's idle listener. Debounced. */
  const onMapIdle = useCallback((delayMs = 400) => {
    if (!enabledRef.current || !onRef.current) return
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null
      void fetchRef.current()
    }, delayMs)
  }, [])

  useEffect(() => {
    if (!enabled || !mapLoaded || !mapRef.current) return
    if (onRef.current) void fetchRef.current()
  }, [mapLoaded, enabled, mapRef])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current)
      clearRef.current()
    }
  }, [])

  return { on, toggle, zoomHint, noData, emptyReason, loadError, onMapIdle, refetch: fetchViewport }
}
