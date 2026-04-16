'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { exteriorRingsFromGeoJSON } from '@/lib/canvass-territory-geometry'

declare const google: any

export type TerritoryRow = {
  id: string
  name: string
  color: string
  boundary_geojson: { type: string; coordinates: unknown }
  user_ids: string[]
  team_ids: string[]
}

type OrgUser = { id: string; full_name: string | null; email: string | null; role: string }
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
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=drawing,geometry`
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
        setUsers((uJson.users || []).filter((u: OrgUser) => u.id))
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

  useEffect(() => {
    if (!ready || !mapRef.current || mapInstanceRef.current) return
    mapInstanceRef.current = new google.maps.Map(mapRef.current, {
      center: { lat: 39.8283, lng: -98.5795 },
      zoom: 4,
      mapTypeId: 'hybrid',
      disableDefaultUI: false,
    })

    const dm = new google.maps.drawing.DrawingManager({
      drawingMode: null,
      drawingControl: true,
      drawingControlOptions: {
        position: google.maps.ControlPosition.TOP_CENTER,
        drawingModes: [google.maps.drawing.OverlayType.POLYGON],
      },
      polygonOptions: {
        fillColor: '#6366F1',
        fillOpacity: 0.25,
        strokeWeight: 2,
        clickable: false,
        editable: true,
        zIndex: 1,
      },
    })
    dm.setMap(mapInstanceRef.current)
    drawingManagerRef.current = dm

    google.maps.event.addListener(dm, 'overlaycomplete', (e: any) => {
      if (e.type === google.maps.drawing.OverlayType.POLYGON) {
        if (draftPolygonRef.current) {
          draftPolygonRef.current.setMap(null)
        }
        draftPolygonRef.current = e.overlay
        setDraftGeo(polygonToGeoJSON(e.overlay))
        dm.setDrawingMode(null)
      }
    })

    const map = mapInstanceRef.current
    window.setTimeout(() => {
      google.maps.event.trigger(map, 'resize')
    }, 0)
  }, [ready])

  useEffect(() => {
    if (!ready || !mapInstanceRef.current) return
    const map = mapInstanceRef.current
    const id = window.requestAnimationFrame(() => {
      google.maps.event.trigger(map, 'resize')
    })
    return () => cancelAnimationFrame(id)
  }, [ready, compact])

  useEffect(() => {
    if (!ready) return
    redrawOverlays()
  }, [ready, redrawOverlays])

  useEffect(() => {
    loadMaps()
      .then(() => setReady(true))
      .catch((e) => setError(e instanceof Error ? e.message : 'Maps error'))
  }, [])

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
    ? 'min-h-[280px] h-[42vh] sm:h-[480px] lg:h-[560px]'
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

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className={gridClass}>
          <div className={formColClass}>
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
          </div>

          <div className={mapColClass}>
            <div className={`bg-white rounded-lg shadow overflow-hidden ${mapShellClass} relative`}>
              {!ready && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-100 text-gray-600 text-sm z-10">
                  Loading map…
                </div>
              )}
              <div ref={mapRef} className="w-full h-full min-h-[200px]" />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
