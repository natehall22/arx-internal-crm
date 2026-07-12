'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isCanvassTerritoryAssigneeEligible } from '@/lib/canvass-territory-assignee-filter'
import { exteriorRingsFromGeoJSON } from '@/lib/canvass-territory-geometry'
import type { ViewportPin } from '@/app/(canvass-app)/canvass/lib/useViewportLeads'

declare const google: any

/** Dot colors — same dispositions as main canvass map (`ViewportPin.d`) */
const LEAD_DOT_COLORS: Record<string, string> = {
  hot_lead: '#EF4444',
  go_back: '#F59E0B',
  not_home: '#9CA3AF',
  not_interested: '#6B7280',
  bad_roof: '#78716C',
  renter: '#A1A1AA',
  scheduled: '#10B981',
  inspection_scheduled: '#10B981',
  default: '#4F46E5',
}

const LEADS_VIEWPORT_DEBOUNCE_MS = 400

export type TerritoryRow = {
  id: string
  name: string
  color: string
  boundary_geojson: { type: string; coordinates: unknown }
  user_ids: string[]
  team_ids: string[]
}

type OrgUser = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  dashboard_view?: string | null
}
type OrgTeam = { id: string; name: string }

function polygonToGeoJSON(polygon: { getPath: () => { getLength: () => number; getAt: (i: number) => { lng: () => number; lat: () => number } } }): {
  type: 'Polygon'
  coordinates: number[][][]
} {
  const path = polygon.getPath()
  const coords: number[][] = []
  const n = path.getLength()
  for (let i = 0; i < n; i++) {
    const p = path.getAt(i)
    coords.push([p.lng(), p.lat()])
  }
  if (coords.length >= 3) {
    const a = coords[0]
    const b = coords[coords.length - 1]
    if (a[0] !== b[0] || a[1] !== b[1]) {
      coords.push([a[0], a[1]])
    }
  }
  return { type: 'Polygon', coordinates: [coords] }
}

function loadMaps(): Promise<void> {
  if (typeof google !== 'undefined' && google.maps) return Promise.resolve()
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!key) return Promise.reject(new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set'))
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=drawing,geometry&v=3.64`
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Google Maps'))
    document.head.appendChild(s)
  })
}

export type CanvassTerritoriesEditorProps = {
  /** Where to send the user if the territories API returns 403 */
  forbiddenRedirect?: string
  /**
   * Canvass-app layout: map above the form on small screens (Spotio-style),
   * slightly shorter map pane on mobile.
   */
  compact?: boolean
}

export function CanvassTerritoriesEditor({
  forbiddenRedirect = '/dashboard',
  compact = false,
}: CanvassTerritoriesEditorProps) {
  const router = useRouter()
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const drawingManagerRef = useRef<any>(null)
  const overlayPolygonsRef = useRef<any[]>([])
  const draftPolygonRef = useRef<any>(null)
  const leadMarkersRef = useRef<any[]>([])
  const leadPinsIdleListenerRef = useRef<any>(null)
  const leadFetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leadFetchAbortRef = useRef<AbortController | null>(null)
  const showLeadPinsRef = useRef(true)

  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [territories, setTerritories] = useState<TerritoryRow[]>([])
  const [users, setUsers] = useState<OrgUser[]>([])
  const [orgTeams, setOrgTeams] = useState<OrgTeam[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [formName, setFormName] = useState('')
  const [formColor, setFormColor] = useState('#6366F1')
  const [formUserIds, setFormUserIds] = useState<string[]>([])
  const [formTeamIds, setFormTeamIds] = useState<string[]>([])
  const [draftGeo, setDraftGeo] = useState<{ type: 'Polygon'; coordinates: number[][][] } | null>(null)
  const [saving, setSaving] = useState(false)

  /** One-shot browser location for initial map view (same idea as canvass map + useGeolocation). */
  const [userLatLng, setUserLatLng] = useState<{ lat: number; lng: number } | null>(null)
  const [mapInitialized, setMapInitialized] = useState(false)
  const userLocationAppliedRef = useRef(false)

  /** Mirrors Google drawing mode for mobile toolbar (default control is hidden — too small to tap). */
  const [mapTool, setMapTool] = useState<'draw' | 'pan'>('draw')
  /** Reuses `/api/canvass/leads/viewport` — same pins as main canvass map. Default on so assigning areas shows context. */
  const [showLeadPins, setShowLeadPins] = useState(true)
  const [leadPinsHint, setLeadPinsHint] = useState<string | null>(null)

  showLeadPinsRef.current = showLeadPins

  const clearLeadMarkers = useCallback(() => {
    leadMarkersRef.current.forEach((m) => {
      try {
        m?.setMap?.(null)
      } catch {
        /* ignore */
      }
    })
    leadMarkersRef.current = []
  }, [])

  const syncPanVersusDraw = useCallback(() => {
    const dm = drawingManagerRef.current
    const m = mapInstanceRef.current
    if (!dm || !m) return
    const mode = dm.getDrawingMode()
    const allowOneFingerPan = mode == null
    m.setOptions({
      draggable: true,
      scrollwheel: true,
      // Pan: one finger moves map. Draw: "cooperative" = two fingers pan/zoom (one finger = corners).
      // Never use "none" here — it blocks ALL gestures; map feels frozen on mobile.
      gestureHandling: allowOneFingerPan ? 'greedy' : 'cooperative',
    })
    setMapTool(mode ? 'draw' : 'pan')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLatLng({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        })
      },
      () => {
        /* Permission denied or unavailable — keep default US center */
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tRes, uRes] = await Promise.all([
        fetch('/api/admin/canvass-territories'),
        fetch('/api/admin/users'),
      ])
      if (tRes.status === 401 || uRes.status === 401) {
        router.push('/login')
        return
      }
      if (tRes.status === 403 || uRes.status === 403) {
        router.push(forbiddenRedirect)
        return
      }
      if (!tRes.ok) {
        const j = await tRes.json().catch(() => ({}))
        setError(j.error || 'Failed to load territories')
        setLoading(false)
        return
      }
      const tJson = await tRes.json()
      setTerritories(
        (tJson.territories || []).map((t: TerritoryRow) => ({
          ...t,
          user_ids: t.user_ids || [],
          team_ids: t.team_ids || [],
        }))
      )

      if (uRes.ok) {
        const uJson = await uRes.json()
        setUsers(
          (uJson.users || []).filter(
            (u: OrgUser) => !!u.id && isCanvassTerritoryAssigneeEligible(u)
          )
        )
        const rawTeams = uJson.teams
        if (Array.isArray(rawTeams)) {
          setOrgTeams(
            rawTeams
              .filter((t: { id?: string }) => t?.id)
              .map((t: { id: string; name?: string | null }) => ({
                id: t.id,
                name: typeof t.name === 'string' ? t.name : '',
              }))
          )
        } else {
          setOrgTeams([])
        }
      } else {
        // Previously swallowed silently: territories would still load and render fine,
        // but the "Assigned reps"/"Assigned teams" pickers would just show empty with no
        // explanation — indistinguishable from "assignment doesn't work". Surface it instead.
        const j = await uRes.json().catch(() => ({}))
        setUsers([])
        setOrgTeams([])
        setError(
          j.error ||
            'Could not load reps/teams for assignment. Areas still loaded — try refreshing to assign reps.'
        )
      }
    } catch {
      setError('Failed to load data')
    }
    setLoading(false)
  }, [router, forbiddenRedirect])

  useEffect(() => {
    loadData()
  }, [loadData])

  const redrawOverlays = useCallback(() => {
    overlayPolygonsRef.current.forEach((p) => p.setMap(null))
    overlayPolygonsRef.current = []
    if (!mapInstanceRef.current) return
    for (const t of territories) {
      const rings = exteriorRingsFromGeoJSON(t.boundary_geojson)
      for (const ring of rings) {
        const poly = new google.maps.Polygon({
          paths: ring.map(([lng, lat]) => ({ lat, lng })),
          strokeColor: t.color,
          strokeOpacity: 0.95,
          strokeWeight: 2,
          fillColor: t.color,
          fillOpacity: selectedId === t.id ? 0.35 : 0.12,
          map: mapInstanceRef.current,
        })
        overlayPolygonsRef.current.push(poly)
      }
    }
  }, [territories, selectedId])

  // Map must mount in the DOM before this runs. Do not gate the map container on API `loading`,
  // or `ready` becomes true while mapRef is null and the map never initializes.
  //
  // Mobile: start in POLYGON mode. While drawing, use gestureHandling "cooperative" (two fingers
  // pan/zoom; one finger places vertices). "none" breaks the map — it disables every gesture.
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstanceRef.current) return

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: 39.8283, lng: -98.5795 },
      zoom: 4,
      mapTypeId: 'hybrid',
      disableDefaultUI: false,
      mapTypeControl: true,
      fullscreenControl: true,
      clickableIcons: false,
      gestureHandling: 'greedy',
    })
    mapInstanceRef.current = map

    const dm = new google.maps.drawing.DrawingManager({
      drawingMode: google.maps.drawing.OverlayType.POLYGON,
      drawingControl: false,
      polygonOptions: {
        fillColor: '#6366F1',
        fillOpacity: 0.25,
        strokeWeight: 3,
        clickable: true,
        editable: true,
        zIndex: 1,
      },
    })
    dm.setMap(map)
    drawingManagerRef.current = dm

    google.maps.event.addListener(dm, 'drawingmode_changed', syncPanVersusDraw)

    google.maps.event.addListener(dm, 'overlaycomplete', (e: any) => {
      if (e.type === google.maps.drawing.OverlayType.POLYGON) {
        if (draftPolygonRef.current) {
          draftPolygonRef.current.setMap(null)
        }
        draftPolygonRef.current = e.overlay
        setDraftGeo(polygonToGeoJSON(e.overlay))
        dm.setDrawingMode(null)
        syncPanVersusDraw()
      }
    })

    syncPanVersusDraw()

    window.setTimeout(() => {
      google.maps.event.trigger(map, 'resize')
    }, 0)

    setMapInitialized(true)
  }, [ready, syncPanVersusDraw])

  // Pan/zoom to user once when map + location are ready (canvass uses ~17–18; slightly wider for drawing).
  useEffect(() => {
    if (!mapInitialized || !mapInstanceRef.current || userLocationAppliedRef.current) return
    if (selectedId !== null || draftGeo) return
    if (!userLatLng) return

    mapInstanceRef.current.setCenter(userLatLng)
    mapInstanceRef.current.setZoom(16)
    userLocationAppliedRef.current = true
  }, [mapInitialized, userLatLng, selectedId, draftGeo])

  /**
   * Optional lead pins — same API + rules as main canvass map (`/api/canvass/leads/viewport`).
   * Default off; debounced on map idle; low z-index dots (no click handlers — avoids fighting polygon draw).
   */
  useEffect(() => {
    if (!mapInitialized || !ready || !mapInstanceRef.current) return

    if (!showLeadPins) {
      if (leadFetchDebounceRef.current) {
        clearTimeout(leadFetchDebounceRef.current)
        leadFetchDebounceRef.current = null
      }
      leadFetchAbortRef.current?.abort()
      clearLeadMarkers()
      setLeadPinsHint(null)
      if (leadPinsIdleListenerRef.current) {
        google.maps.event.removeListener(leadPinsIdleListenerRef.current)
        leadPinsIdleListenerRef.current = null
      }
      return
    }

    const map = mapInstanceRef.current

    const loadPinsForBounds = async () => {
      if (!showLeadPinsRef.current || !mapInstanceRef.current) return

      const b = map.getBounds()
      const zoom = map.getZoom()
      if (!b || zoom === undefined) return

      if (zoom < 10) {
        clearLeadMarkers()
        setLeadPinsHint('Zoom in closer to load lead pins.')
        return
      }

      const ne = b.getNorthEast()
      const sw = b.getSouthWest()
      const params = new URLSearchParams({
        minLat: String(sw.lat()),
        maxLat: String(ne.lat()),
        minLng: String(sw.lng()),
        maxLng: String(ne.lng()),
        zoom: String(Math.floor(zoom)),
      })

      leadFetchAbortRef.current?.abort()
      const ac = new AbortController()
      leadFetchAbortRef.current = ac

      try {
        const res = await fetch(`/api/canvass/leads/viewport?${params.toString()}`, {
          credentials: 'include',
          signal: ac.signal,
        })
        const data = (await res.json().catch(() => ({}))) as {
          pins?: ViewportPin[]
          error?: string
          minZoomRequired?: number
          message?: string
          truncated?: boolean
        }
        if (!res.ok) {
          setLeadPinsHint(typeof data.error === 'string' ? data.error : 'Could not load pins')
          clearLeadMarkers()
          return
        }
        if (data.minZoomRequired != null) {
          clearLeadMarkers()
          setLeadPinsHint(data.message || 'Zoom in to see pins')
          return
        }
        const pins: ViewportPin[] = Array.isArray(data.pins) ? data.pins : []
        clearLeadMarkers()

        for (const pin of pins) {
          if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) continue
          const disp = String(pin.d || '').toLowerCase()
          const fill = pin.ia
            ? '#16a34a'
            : LEAD_DOT_COLORS[disp] || LEAD_DOT_COLORS.default
          const marker = new google.maps.Marker({
            position: { lat: pin.lat, lng: pin.lng },
            map,
            optimized: true,
            zIndex: 80,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: fill,
              fillOpacity: 0.92,
              strokeColor: '#ffffff',
              strokeWeight: 2,
            },
          })
          leadMarkersRef.current.push(marker)
        }
        if (pins.length === 0) {
          setLeadPinsHint(
            data.truncated
              ? 'Zoom in — sample cap reached; try a smaller area.'
              : 'No lead pins here. Pan/zoom where your leads are, or ensure leads have map coordinates.'
          )
        } else {
          setLeadPinsHint(
            data.truncated ? 'Showing a sample of pins — zoom in to load more in this area.' : null
          )
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
        setLeadPinsHint('Could not load pins')
        clearLeadMarkers()
      }
    }

    const scheduleLoad = () => {
      if (leadFetchDebounceRef.current) clearTimeout(leadFetchDebounceRef.current)
      leadFetchDebounceRef.current = setTimeout(() => {
        leadFetchDebounceRef.current = null
        loadPinsForBounds()
      }, LEADS_VIEWPORT_DEBOUNCE_MS)
    }

    leadPinsIdleListenerRef.current = google.maps.event.addListener(map, 'idle', scheduleLoad)
    scheduleLoad()
    window.setTimeout(() => {
      google.maps.event.trigger(map, 'idle')
    }, 200)

    return () => {
      if (leadFetchDebounceRef.current) {
        clearTimeout(leadFetchDebounceRef.current)
        leadFetchDebounceRef.current = null
      }
      leadFetchAbortRef.current?.abort()
      if (leadPinsIdleListenerRef.current) {
        google.maps.event.removeListener(leadPinsIdleListenerRef.current)
        leadPinsIdleListenerRef.current = null
      }
      clearLeadMarkers()
      setLeadPinsHint(null)
    }
  }, [mapInitialized, ready, showLeadPins, clearLeadMarkers])

  useEffect(() => {
    if (!ready || !mapInstanceRef.current) return
    const map = mapInstanceRef.current
    const id = window.requestAnimationFrame(() => {
      google.maps.event.trigger(map, 'resize')
    })
    return () => cancelAnimationFrame(id)
  }, [ready, compact, loading])

  useEffect(() => {
    if (!ready) return
    redrawOverlays()
  }, [ready, redrawOverlays])

  useEffect(() => {
    loadMaps()
      .then(() => setReady(true))
      .catch((e) => setError(e instanceof Error ? e.message : 'Maps error'))
  }, [])

  const tapDrawMode = useCallback(() => {
    const dm = drawingManagerRef.current
    if (!dm) return
    dm.setDrawingMode(google.maps.drawing.OverlayType.POLYGON)
    syncPanVersusDraw()
  }, [syncPanVersusDraw])

  const tapPanMode = useCallback(() => {
    const dm = drawingManagerRef.current
    if (!dm) return
    dm.setDrawingMode(null)
    syncPanVersusDraw()
  }, [syncPanVersusDraw])

  const clearDraftShape = useCallback(() => {
    if (draftPolygonRef.current) {
      draftPolygonRef.current.setMap(null)
      draftPolygonRef.current = null
    }
    setDraftGeo(null)
    const dm = drawingManagerRef.current
    if (dm) {
      dm.setDrawingMode(google.maps.drawing.OverlayType.POLYGON)
      syncPanVersusDraw()
    }
  }, [syncPanVersusDraw])

  const recenterMapOnUser = useCallback(() => {
    const map = mapInstanceRef.current
    if (!map) return
    const finish = (lat: number, lng: number) => {
      map.panTo({ lat, lng })
      const z = map.getZoom()
      if (z !== undefined && z < 14) map.setZoom(16)
    }
    if (userLatLng) {
      finish(userLatLng.lat, userLatLng.lng)
      return
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setUserLatLng({ lat, lng })
        finish(lat, lng)
      },
      () => {},
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 }
    )
  }, [userLatLng])

  const startNew = () => {
    setSelectedId(null)
    setFormName('')
    setFormColor('#6366F1')
    setFormUserIds([])
    setFormTeamIds([])
    setDraftGeo(null)
    if (draftPolygonRef.current) {
      draftPolygonRef.current.setMap(null)
      draftPolygonRef.current = null
    }
    const dm = drawingManagerRef.current
    if (dm) {
      dm.setDrawingMode(google.maps.drawing.OverlayType.POLYGON)
      syncPanVersusDraw()
    }
  }

  const selectTerritory = (t: TerritoryRow) => {
    setSelectedId(t.id)
    setFormName(t.name)
    setFormColor(t.color)
    setFormUserIds([...(t.user_ids || [])])
    setFormTeamIds([...(t.team_ids || [])])
    setDraftGeo(null)
    if (draftPolygonRef.current) {
      draftPolygonRef.current.setMap(null)
      draftPolygonRef.current = null
    }
    const dm = drawingManagerRef.current
    if (dm) {
      dm.setDrawingMode(null)
      syncPanVersusDraw()
    }
    const rings = exteriorRingsFromGeoJSON(t.boundary_geojson)
    if (rings[0]?.length && mapInstanceRef.current) {
      const b = new google.maps.LatLngBounds()
      for (const [lng, lat] of rings[0]) {
        b.extend({ lat, lng })
      }
      mapInstanceRef.current.fitBounds(b)
    }
    window.setTimeout(() => {
      if (mapInstanceRef.current) {
        google.maps.event.trigger(mapInstanceRef.current, 'resize')
      }
    }, 300)
  }

  const saveTerritory = async () => {
    let boundary: { type: 'Polygon'; coordinates: number[][][] } | null = null
    if (draftPolygonRef.current) {
      try {
        boundary = polygonToGeoJSON(draftPolygonRef.current)
      } catch {
        boundary = draftGeo
      }
    } else {
      const existing = territories.find((x) => x.id === selectedId)?.boundary_geojson
      boundary =
        draftGeo ||
        (existing && existing.type === 'Polygon' && Array.isArray(existing.coordinates)
          ? (existing as { type: 'Polygon'; coordinates: number[][][] })
          : null)
    }
    if (!boundary || !formName.trim()) {
      setError('Name and a drawn polygon (or existing area) are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (selectedId) {
        const body: Record<string, unknown> = {
          name: formName.trim(),
          color: formColor,
          user_ids: formUserIds,
          team_ids: formTeamIds,
        }
        if (draftGeo) body.boundary_geojson = draftGeo
        const res = await fetch(`/api/admin/canvass-territories/${selectedId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setError(j.error || 'Save failed')
        } else {
          await loadData()
          startNew()
        }
      } else {
        const res = await fetch('/api/admin/canvass-territories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formName.trim(),
            color: formColor,
            boundary_geojson: boundary,
            user_ids: formUserIds,
            team_ids: formTeamIds,
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setError(j.error || 'Save failed')
        } else {
          await loadData()
          startNew()
        }
      }
    } finally {
      setSaving(false)
    }
  }

  const deleteTerritory = async (id: string) => {
    if (!confirm('Delete this work area?')) return
    setError(null)
    const res = await fetch(`/api/admin/canvass-territories/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || 'Delete failed')
      return
    }
    if (selectedId === id) startNew()
    await loadData()
  }

  const toggleUser = (id: string) => {
    setFormUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const toggleTeam = (id: string) => {
    setFormTeamIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const mapShellClass = compact
    ? 'min-h-[300px] h-[48vh] sm:h-[480px] lg:h-[560px]'
    : 'h-[560px]'

  const gridClass = compact
    ? 'grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6'
    : 'grid grid-cols-1 lg:grid-cols-12 gap-6'

  const formColClass = compact
    ? 'lg:col-span-4 space-y-4 order-2 lg:order-1'
    : 'lg:col-span-4 space-y-4'

  const mapColClass = compact
    ? 'lg:col-span-8 order-1 lg:order-2'
    : 'lg:col-span-8'

  return (
    <>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 text-red-800 px-4 py-2 text-sm">{error}</div>
      )}

      <div className={gridClass}>
        <div className={formColClass}>
          {loading ? (
            <div className="bg-white rounded-lg shadow p-6 text-gray-500 text-sm">
              Loading areas and users…
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="font-medium text-gray-900">Areas</h2>
                  <button
                    type="button"
                    onClick={startNew}
                    className="text-sm text-indigo-600 hover:underline"
                  >
                    New area
                  </button>
                </div>
                <ul className="space-y-2 max-h-64 overflow-y-auto">
                  {territories.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => selectTerritory(t)}
                        className={`w-full text-left px-3 py-2 rounded border flex items-center gap-2 ${
                          selectedId === t.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                        <span className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-gray-900 truncate block">{t.name}</span>
                          <span className="text-xs text-gray-500">
                            {(t.user_ids?.length ?? 0)} rep{(t.user_ids?.length ?? 0) === 1 ? '' : 's'}
                            {' · '}
                            {(t.team_ids?.length ?? 0)} team{(t.team_ids?.length ?? 0) === 1 ? '' : 's'}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {territories.length === 0 && (
                    <li className="text-sm text-gray-500">No areas yet — draw one on the map.</li>
                  )}
                </ul>
              </div>

              <div className="bg-white rounded-lg shadow p-4 space-y-3">
                <h2 className="font-medium text-gray-900">{selectedId ? 'Edit area' : 'New area'}</h2>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                  <input
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. North Oak Hills"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Color</label>
                  <input
                    type="color"
                    className="h-10 w-full border rounded cursor-pointer"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Assigned reps</label>
                  <p className="text-xs text-gray-500 mb-1.5">
                    Sales-side users only (Ops dashboard users are not listed).
                  </p>
                  <div className="max-h-40 overflow-y-auto border rounded p-2 space-y-1">
                    {users.map((u) => (
                      <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formUserIds.includes(u.id)}
                          onChange={() => toggleUser(u.id)}
                        />
                        <span className="truncate">{u.full_name || u.email || u.id}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Assigned teams</label>
                  <div className="max-h-32 overflow-y-auto border rounded p-2 space-y-1">
                    {orgTeams.length === 0 ? (
                      <p className="text-xs text-gray-500">No teams in this org.</p>
                    ) : (
                      orgTeams.map((team) => (
                        <label key={team.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formTeamIds.includes(team.id)}
                            onChange={() => toggleTeam(team.id)}
                          />
                          <span className="truncate">{team.name || team.id}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Use the polygon tool on the map to {selectedId ? 'replace the shape (optional)' : 'define the boundary'}.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={saveTerritory}
                    className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : selectedId ? 'Save changes' : 'Create area'}
                  </button>
                  {selectedId && (
                    <button
                      type="button"
                      onClick={() => deleteTerritory(selectedId)}
                      className="px-4 py-2 border border-red-300 text-red-700 rounded text-sm"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className={mapColClass}>
          <div className={`bg-white rounded-lg shadow overflow-hidden ${mapShellClass} relative`}>
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100 text-gray-600 text-sm z-10">
                Loading map…
              </div>
            )}
            <div ref={mapRef} className="w-full h-full min-h-[200px] touch-manipulation" />
            {ready && mapInitialized && (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] flex justify-center bg-gradient-to-t from-white/95 via-white/70 to-transparent px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3 sm:px-3"
              >
                <div
                  className="pointer-events-auto flex w-full max-w-xl flex-wrap items-stretch justify-center gap-2"
                  role="toolbar"
                  aria-label="Map drawing tools"
                >
                  <button
                    type="button"
                    onClick={tapDrawMode}
                    className={`min-h-[48px] flex-1 min-w-[5.5rem] rounded-xl border-2 px-3 py-2.5 text-sm font-semibold shadow-sm transition active:scale-[0.98] ${
                      mapTool === 'draw'
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                    }`}
                  >
                    Draw area
                  </button>
                  <button
                    type="button"
                    onClick={tapPanMode}
                    className={`min-h-[48px] flex-1 min-w-[5.5rem] rounded-xl border-2 px-3 py-2.5 text-sm font-semibold shadow-sm transition active:scale-[0.98] ${
                      mapTool === 'pan'
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                    }`}
                  >
                    Pan map
                  </button>
                  <button
                    type="button"
                    onClick={recenterMapOnUser}
                    className="min-h-[48px] min-w-[5.5rem] rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 active:scale-[0.98]"
                    title="Center on your location"
                  >
                    My location
                  </button>
                  {draftGeo && (
                    <button
                      type="button"
                      onClick={clearDraftShape}
                      className="min-h-[48px] min-w-[5.5rem] rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900 shadow-sm hover:bg-amber-100 active:scale-[0.98]"
                    >
                      Clear shape
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          {ready && mapInitialized && (
            <div className="mt-2 rounded-xl border border-indigo-100 bg-indigo-50/90 px-3 py-2.5 text-xs leading-relaxed text-indigo-950 sm:text-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <p className="font-semibold text-indigo-900">Quick guide</p>
                <button
                  type="button"
                  onClick={() => setShowLeadPins((v) => !v)}
                  className={`min-h-[44px] shrink-0 rounded-lg border-2 px-3 py-2 text-left text-xs font-semibold shadow-sm transition sm:min-h-0 sm:py-1.5 sm:text-sm ${
                    showLeadPins
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-indigo-200 bg-white text-indigo-900 hover:bg-indigo-100/80'
                  }`}
                >
                  {showLeadPins ? 'Lead pins on' : 'Show lead pins'}
                </button>
              </div>
              {leadPinsHint && (
                <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 sm:text-xs">
                  {leadPinsHint}
                </p>
              )}
              <ul className="mt-1.5 list-disc space-y-1 pl-4 marker:text-indigo-400">
                <li>
                  <strong>Draw area:</strong> tap each corner. Close the shape by tapping the{' '}
                  <span className="whitespace-nowrap">first point again</span> (or double-tap the last point).
                </li>
                <li>
                  <strong>Pan map:</strong> use the buttons on the map, then drag with one finger. Or stay on Draw and use{' '}
                  <span className="font-medium">two fingers</span> to move the map without placing a point.
                </li>
                <li>
                  <strong>Field tip:</strong> finish the outline before assigning reps — use{' '}
                  <span className="font-medium">Clear shape</span> to start over.
                </li>
                {showLeadPins && (
                  <li>
                    <strong>Lead pins:</strong> colored <strong>dots</strong> = your leads (not Google&apos;s business
                    icons on the satellite). Same rules as the main canvass map. Tap{' '}
                    <span className="font-medium">Lead pins on</span> to hide dots if the map is too busy.
                  </li>
                )}
              </ul>
            </div>
          )}
          <p className="mt-2 hidden px-0.5 text-xs leading-snug text-gray-600 sm:block">
            Tools also appear on the map on larger screens. Use <strong>Draw area</strong> / <strong>Pan map</strong>{' '}
            at the bottom for the best touch experience.
          </p>
        </div>
      </div>
    </>
  )
}
