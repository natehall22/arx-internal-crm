'use client'

/**
 * Measure yard — the screen. Satellite map at the property, the crew lead taps points to draw shapes (lawn, bed, cut-out,
 * line), sees live square feet / acres / feet, a mulch / pine straw estimate for beds ("est."), and saves.
 *
 * Phone rules: every control is a normal button / input OUTSIDE the map (opaque cards — no text is ever drawn on the
 * satellite photo), 44 px taps, 16 px inputs, Save in a bar at the bottom of the screen. Points are tapped on the map
 * (a tap that did not drag); round 28 px handles are dragged to adjust. The map never gets a control of ours on top of it.
 *
 * Pure rules: lib/area-measure.ts. Map loading + Google's computeArea / computeLength: lib/google-maps-client.ts.
 * Roof measuring code is never imported here (jest guard: lib/__tests__/area-measure-isolation.test.ts).
 */
import Link from 'next/link'
import * as React from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@/components/ui'
import {
  AREA_MEASURE_DEFAULTS,
  AREA_MEASURE_SETTING_FIELDS,
  LINES_CROSS_MESSAGE,
  SHAPE_TYPES,
  SHAPE_TYPE_HELP,
  SHAPE_TYPE_LABELS,
  bedMaterials,
  computeTotals,
  formatAcres,
  formatCuYd,
  formatFeet,
  formatSqft,
  isPolygonType,
  metersToFeet,
  minPoints,
  polygonSelfIntersects,
  shapeLabel,
  sqmToSqft,
  type AreaMeasureSettings,
  type AreaShape,
  type LatLngPoint,
  type ShapeType,
  type TakesFrom,
} from '@/lib/area-measure'
import { loadGoogleMaps, measureLineMeters, measurePolygonSqm } from '@/lib/google-maps-client'

export type AreaMeasureRefs = { customerId: string | null; propertyId: string | null; opportunityId: string | null; leadId: string | null }

export type AreaMeasureClientProps = {
  /** Address the map opens on (property / deal / lead / customer address); the person can type another. */
  address: string | null
  lat: number | null
  lng: number | null
  refs: AreaMeasureRefs
  /** Who this is for, in words ("Pat Lee"), shown above the map. */
  forLabel: string | null
  canSave: boolean
  /** Why Save is off (typed address with nothing to save it to, or a field role). */
  cannotSaveReason: string | null
  settings: AreaMeasureSettings
  canEditSettings: boolean
  /** Shapes of an earlier measurement to adjust (Re-measure). */
  initialShapes?: AreaShape[]
  backHref: string
  /** The dev harness passes a fake key; the app reads NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. */
  mapsApiKey?: string
}

const COLORS: Record<ShapeType, string> = { lawn: '#2e7d32', bed: '#a65e00', cutout: '#c62828', line: '#1565c0' }

type Draft = { type: ShapeType; takesFrom: TakesFrom; name: string; points: LatLngPoint[] }

let idCounter = 0
const newId = () => `s${Date.now().toString(36)}${(idCounter++).toString(36)}`

/** Measure one shape the way Google does (needs the map script loaded). */
function withMeasure(shape: AreaShape): AreaShape {
  if (isPolygonType(shape.type)) {
    const sqft = shape.points.length >= 3 ? sqmToSqft(measurePolygonSqm(shape.points)) : 0
    return { ...shape, sqft: Math.round(sqft * 10) / 10 }
  }
  const feet = shape.points.length >= 2 ? metersToFeet(measureLineMeters(shape.points)) : 0
  return { ...shape, feet: Math.round(feet * 10) / 10 }
}

function valueText(s: Pick<AreaShape, 'type' | 'sqft' | 'feet'>): string {
  return s.type === 'line' ? formatFeet(s.feet ?? 0) : `${formatSqft(s.sqft ?? 0)} · ${formatAcres(s.sqft ?? 0)}`
}

const chip = (active: boolean) =>
  `min-h-tap rounded-ui border px-3 py-2 text-ui-base font-semibold ${active ? 'border-brand-700 bg-brand-700 text-white' : 'border-surface-line bg-surface text-ink'}`

export default function AreaMeasureClient(props: AreaMeasureClientProps) {
  const { refs, canSave, cannotSaveReason, canEditSettings, backHref, mapsApiKey } = props
  const mapDivRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<any>(null)
  const overlaysRef = React.useRef<any[]>([])

  const [mapReady, setMapReady] = React.useState(false)
  const [mapError, setMapError] = React.useState<string | null>(null)
  const [addressText, setAddressText] = React.useState(props.address ?? '')
  const [shapes, setShapes] = React.useState<AreaShape[]>(props.initialShapes ?? [])
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [hint, setHint] = React.useState<string | null>(null)
  const [settings, setSettings] = React.useState<AreaMeasureSettings>(props.settings)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [settingsDraft, setSettingsDraft] = React.useState({ mulchDepthIn: String(props.settings.mulchDepthIn), strawSqftPerBale: String(props.settings.strawSqftPerBale) })
  const [settingsMsg, setSettingsMsg] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveMsg, setSaveMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [savedSig, setSavedSig] = React.useState<string | null>(null)

  const draftRef = React.useRef<Draft | null>(null)
  draftRef.current = draft

  const sig = React.useMemo(() => JSON.stringify(shapes), [shapes])
  const dirty = savedSig !== sig

  // ---- map ----
  React.useEffect(() => {
    let cancelled = false
    loadGoogleMaps({ apiKey: mapsApiKey })
      .then(() => {
        if (cancelled || !mapDivRef.current) return
        const g = (window as any).google.maps
        const hasCenter = props.lat !== null && props.lng !== null
        const map = new g.Map(mapDivRef.current, {
          center: hasCenter ? { lat: props.lat, lng: props.lng } : { lat: 39.5, lng: -98.35 },
          zoom: hasCenter ? 19 : 4,
          mapTypeId: 'satellite',
          tilt: 0,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
          keyboardShortcuts: false,
          // A quick second tap while placing points must not zoom the map.
          disableDoubleClickZoom: true,
        })
        mapRef.current = map
        map.addListener('click', (e: any) => {
          if (!e?.latLng) return
          const p = { lat: e.latLng.lat(), lng: e.latLng.lng() }
          if (!draftRef.current) {
            setHint('Pick Lawn, Bed, Cut-out or Line first, then tap the map.')
            return
          }
          setHint(null)
          setDraft((d) => (d ? { ...d, points: [...d.points, p] } : d))
        })
        if (shapes.length > 0) {
          const b = new g.LatLngBounds()
          for (const s of shapes) for (const p of s.points) b.extend(p)
          map.fitBounds(b)
        } else if (!hasCenter && addressText.trim()) {
          findAddress(addressText)
        }
        setMapReady(true)
      })
      .catch((e: unknown) => setMapError(e instanceof Error ? e.message : 'The map could not load'))
    return () => {
      cancelled = true
    }
    // The map is created once; props only seed it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function findAddress(text: string) {
    const g = (window as any).google?.maps
    const map = mapRef.current
    if (!g || !map || !text.trim()) return
    new g.Geocoder().geocode({ address: text.trim() }, (results: any[], status: string) => {
      if (status === 'OK' && results?.[0]?.geometry?.location) {
        map.setCenter(results[0].geometry.location)
        map.setZoom(19)
        setHint(null)
      } else {
        setHint('Could not find that address. Check it and try again.')
      }
    })
  }

  // Overlays for every finished shape and the one being drawn. Rebuilt on any change (a yard has a handful of shapes).
  React.useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return
    const g = (window as any).google.maps
    overlaysRef.current.forEach((o) => o.setMap(null))
    overlaysRef.current = []
    const drawing = !!draft
    const make = (type: ShapeType, pts: LatLngPoint[], selected: boolean, onClick?: () => void) => {
      const color = COLORS[type]
      const asPolygon = isPolygonType(type) && pts.length >= 3
      const o = asPolygon
        ? new g.Polygon({ map, paths: pts, strokeColor: color, strokeWeight: selected ? 4 : 2, fillColor: color, fillOpacity: type === 'cutout' ? 0.4 : 0.3, clickable: !drawing })
        : new g.Polyline({ map, path: pts, strokeColor: color, strokeWeight: selected ? 6 : 4, clickable: !drawing })
      if (onClick && !drawing) o.addListener('click', onClick)
      overlaysRef.current.push(o)
    }
    for (const s of shapes) make(s.type, s.points, s.id === selectedId, () => setSelectedId(s.id))
    if (draft) make(draft.type, draft.points, true)
  }, [shapes, draft, selectedId, mapReady])

  // Round drag handles on the points of the shape being drawn or adjusted.
  const selected = shapes.find((s) => s.id === selectedId) ?? null
  const editKey = draft ? 'draft' : selected ? selected.id : null
  const editPoints = draft ? draft.points : selected ? selected.points : []
  const editType: ShapeType | null = draft ? draft.type : selected ? selected.type : null
  const editPointsRef = React.useRef(editPoints)
  editPointsRef.current = editPoints
  React.useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || !editKey || !editType) return
    const g = (window as any).google.maps
    const color = COLORS[editType]
    const markers = editPointsRef.current.map((p, i) => {
      const m = new g.Marker({
        map,
        position: p,
        draggable: true,
        optimized: false,
        zIndex: 10,
        title: `Point ${i + 1}`,
        icon: { path: g.SymbolPath.CIRCLE, scale: 14, fillColor: '#ffffff', fillOpacity: 1, strokeColor: color, strokeWeight: 4 },
      })
      const move = (e: any) => {
        if (!e?.latLng) return
        const np = { lat: e.latLng.lat(), lng: e.latLng.lng() }
        if (editKey === 'draft') setDraft((d) => (d ? { ...d, points: d.points.map((q, j) => (j === i ? np : q)) } : d))
        else setShapes((list) => list.map((s) => (s.id === editKey ? withMeasure({ ...s, points: s.points.map((q, j) => (j === i ? np : q)) }) : s)))
      }
      m.addListener('drag', move)
      m.addListener('dragend', move)
      return m
    })
    return () => markers.forEach((m: any) => m.setMap(null))
  }, [editKey, editType, editPoints.length, mapReady])

  // Warn before leaving with an unsaved measurement.
  React.useEffect(() => {
    if (!dirty || shapes.length === 0) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty, shapes.length])

  // ---- drawing actions ----
  function pickType(t: ShapeType) {
    setSaveMsg(null)
    setHint(null)
    if (draft) setDraft({ ...draft, type: t })
    else {
      setSelectedId(null)
      setDraft({ type: t, takesFrom: 'lawn', name: '', points: [] })
    }
  }
  const undoPoint = () => setDraft((d) => (d && d.points.length > 0 ? { ...d, points: d.points.slice(0, -1) } : d))
  function closeShape() {
    if (!draft || draft.points.length < minPoints(draft.type)) return
    if (draftCrosses) {
      setHint(LINES_CROSS_MESSAGE)
      return
    }
    const shape = withMeasure({
      id: newId(),
      type: draft.type,
      name: draft.name.trim() || null,
      points: draft.points,
      ...(draft.type === 'cutout' ? { takesFrom: draft.takesFrom } : {}),
    })
    setShapes((s) => [...s, shape])
    setSelectedId(shape.id)
    setDraft(null)
    setHint(null)
  }
  const cancelDraft = () => {
    setDraft(null)
    setHint(null)
  }
  function removeShape(id: string) {
    setShapes((s) => s.filter((x) => x.id !== id))
    if (selectedId === id) setSelectedId(null)
  }
  function patchSelected(patch: Partial<AreaShape>) {
    if (!selected) return
    setShapes((list) => list.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)))
  }

  // ---- totals ----
  const totals = React.useMemo(() => computeTotals(shapes, settings), [shapes, settings])
  const draftMeasure = React.useMemo(() => {
    if (!draft || !mapReady) return null
    const need = minPoints(draft.type)
    if (draft.points.length < need) return null
    return withMeasure({ id: 'draft', type: draft.type, name: null, points: draft.points })
  }, [draft, mapReady])
  const hasBeds = totals.counts.bed > 0
  // An outline that crosses itself has no single area: it cannot be finished or saved until it is redrawn.
  const draftCrosses = !!draft && isPolygonType(draft.type) && polygonSelfIntersects(draft.points)
  const crossingIds = React.useMemo(() => shapes.filter((x) => isPolygonType(x.type) && polygonSelfIntersects(x.points)).map((x) => x.id), [shapes])
  const hasCrossing = draftCrosses || crossingIds.length > 0

  // The Save bar is fixed to the bottom; keep the page padded by its real height so a wrapped message is never hidden behind it.
  const barRef = React.useRef<HTMLDivElement>(null)
  const [barHeight, setBarHeight] = React.useState(112)
  React.useEffect(() => {
    const el = barRef.current
    if (!el) return
    const measure = () => setBarHeight(el.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- save ----
  async function save() {
    if (!canSave || shapes.length === 0 || saving || hasCrossing) return
    setSaving(true)
    setSaveMsg(null)
    const c = mapRef.current?.getCenter?.()
    try {
      const res = await fetch('/api/area-measure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...refs,
          address: addressText.trim() || null,
          lat: c ? c.lat() : props.lat,
          lng: c ? c.lng() : props.lng,
          shapes: shapes.map((s) => ({ id: s.id, type: s.type, name: s.name, points: s.points, sqft: s.sqft, feet: s.feet, takesFrom: s.takesFrom })),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setSaveMsg({ ok: false, text: data.error || 'Could not save. Try again.' })
      else {
        setSavedSig(sig)
        setSaveMsg({ ok: true, text: 'Saved. The older measurements are kept.' })
      }
    } catch {
      setSaveMsg({ ok: false, text: 'No connection. Nothing was saved — try again.' })
    }
    setSaving(false)
  }

  async function saveSettings() {
    setSettingsMsg(null)
    const body = { mulchDepthIn: Number(settingsDraft.mulchDepthIn), strawSqftPerBale: Number(settingsDraft.strawSqftPerBale) }
    try {
      const res = await fetch('/api/area-measure/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await res.json().catch(() => ({}))) as { error?: string; settings?: AreaMeasureSettings }
      if (!res.ok || !data.settings) return setSettingsMsg(data.error || 'Could not save')
      setSettings(data.settings)
      setSettingsMsg('Saved for the whole company.')
    } catch {
      setSettingsMsg('No connection. Try again.')
    }
  }

  const editName = draft ? draft.name : selected?.name ?? ''
  const editTakesFrom = draft ? draft.takesFrom : selected?.takesFrom ?? 'lawn'
  const status = draftCrosses
    ? LINES_CROSS_MESSAGE
    : draft
    ? draft.points.length === 0
      ? `Tap the map to place the first point of the ${SHAPE_TYPE_LABELS[draft.type].toLowerCase()}.`
      : draft.points.length < minPoints(draft.type)
        ? `${draft.points.length} point${draft.points.length === 1 ? '' : 's'}. Keep tapping.`
        : `${draft.points.length} points. Tap more, or press Done.`
    : selected
      ? 'Drag the round points to adjust this shape.'
      : shapes.length === 0
        ? 'Pick what you are measuring, then tap points around it on the map.'
        : 'Pick another shape to add, or tap one on the map or in the list.'

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-3 pt-3 text-ink" style={{ paddingBottom: barHeight + 16 }}>
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Measure yard</CardTitle>
            {props.forLabel ? <p className="mt-1 break-words text-ui-base text-ink">For {props.forLabel}</p> : null}
          </div>
          <Link href={backHref} className="inline-flex min-h-tap items-center text-ui-base font-semibold text-brand-800 underline">
            Back
          </Link>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              findAddress(addressText)
            }}
          >
            <Input aria-label="Address to show on the map" placeholder="Type an address" value={addressText} onChange={(e) => setAddressText(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={!mapReady}>
              Find
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* The map has nothing on top of it: every label and button lives in the cards around it. */}
      <div className="overflow-hidden rounded-ui border border-surface-line bg-surface-subtle">
        {mapError ? (
          <div className="flex h-64 items-center justify-center p-4 text-center text-ui-base text-ink">{mapError}</div>
        ) : (
          <div ref={mapDivRef} data-testid="yard-map" className="w-full" style={{ height: '52dvh', minHeight: 300 }} />
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <p className={`text-ui-base font-semibold ${draftCrosses ? 'text-danger' : 'text-ink'}`} role="status" data-testid="yard-status">
            {hint ?? status}
          </p>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="What are you measuring">
            {SHAPE_TYPES.map((t) => (
              <button key={t} type="button" aria-pressed={editType === t} className={chip(editType === t && !!draft)} onClick={() => pickType(t)}>
                {draft ? SHAPE_TYPE_LABELS[t] : `+ ${SHAPE_TYPE_LABELS[t]}`}
              </button>
            ))}
          </div>
          {editType ? <p className="text-ui-sm text-ink">{SHAPE_TYPE_HELP[editType]}</p> : null}

          {draft ? (
            <>
              {draftMeasure ? (
                <p className="text-ui-base font-semibold text-ink" data-testid="yard-live">
                  {valueText(draftMeasure)}
                </p>
              ) : null}
              <div className="grid grid-cols-3 gap-2">
                <Button variant="secondary" onClick={undoPoint} disabled={draft.points.length === 0}>
                  Undo point
                </Button>
                <Button variant="secondary" onClick={cancelDraft}>
                  Cancel
                </Button>
                <Button onClick={closeShape} disabled={draft.points.length < minPoints(draft.type) || draftCrosses}>
                  Done
                </Button>
              </div>
            </>
          ) : null}

          {editType === 'cutout' ? (
            <div role="group" aria-label="Take this out of" className="flex flex-col gap-2">
              <span className="text-ui-sm font-semibold text-ink">Take this out of</span>
              <div className="grid grid-cols-2 gap-2">
                {(['lawn', 'bed'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={editTakesFrom === v}
                    className={chip(editTakesFrom === v)}
                    onClick={() => (draft ? setDraft({ ...draft, takesFrom: v }) : patchSelected({ takesFrom: v }))}
                  >
                    {v === 'lawn' ? 'The lawn' : 'The beds'}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {draft || selected ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-ui-sm font-semibold text-ink">Name (optional)</span>
              <Input
                value={editName}
                maxLength={80}
                placeholder="Front yard, Rose bed, House ..."
                onChange={(e) => (draft ? setDraft({ ...draft, name: e.target.value }) : patchSelected({ name: e.target.value || null }))}
              />
            </label>
          ) : null}
        </CardContent>
      </Card>

      {shapes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Shapes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {shapes.map((s) => {
              const m = s.type === 'bed' ? bedMaterials(s.sqft ?? 0, settings) : null
              return (
                <div key={s.id} className={`flex items-stretch gap-2 rounded-ui border p-2 ${s.id === selectedId ? 'border-brand-700 bg-brand-50' : 'border-surface-line'}`}>
                  <button type="button" className="min-h-tap min-w-0 flex-1 text-left" onClick={() => !draft && setSelectedId(s.id === selectedId ? null : s.id)} aria-pressed={s.id === selectedId}>
                    <span className="flex items-center gap-2 text-ui-base font-semibold text-ink">
                      <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: COLORS[s.type] }} />
                      <span className="break-words">{shapeLabel(s, shapes)}</span>
                    </span>
                    <span className="block text-ui-base text-ink">
                      {SHAPE_TYPE_LABELS[s.type]}
                      {s.type === 'cutout' ? ` (out of ${s.takesFrom === 'bed' ? 'beds' : 'lawn'})` : ''}: {valueText(s)}
                    </span>
                    {crossingIds.includes(s.id) ? (
                      <span className="block text-ui-base font-semibold text-danger" data-testid="yard-crossing">
                        {LINES_CROSS_MESSAGE}
                      </span>
                    ) : null}
                    {m ? (
                      <span className="block text-ui-sm text-ink">
                        est. {formatCuYd(m.mulchCuYd)} mulch · est. {m.strawBales} bale{m.strawBales === 1 ? '' : 's'} pine straw
                      </span>
                    ) : null}
                  </button>
                  <Button variant="secondary" onClick={() => removeShape(s.id)} aria-label={`Delete ${shapeLabel(s, shapes)}`}>
                    Delete
                  </Button>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Totals</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3" data-testid="yard-totals">
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-ui-base text-ink">
            <dt className="font-semibold">Lawn{totals.cutoutLawnSqft > 0 ? ' (after cut-outs)' : ''}</dt>
            <dd className="text-right">{formatSqft(totals.lawnSqft)} · {formatAcres(totals.lawnSqft)}</dd>
            <dt className="font-semibold">Beds{totals.cutoutBedSqft > 0 ? ' (after cut-outs)' : ''}</dt>
            <dd className="text-right">{formatSqft(totals.bedSqft)} · {formatAcres(totals.bedSqft)}</dd>
            {totals.counts.cutout > 0 ? (
              <>
                <dt className="font-semibold">Cut-outs</dt>
                <dd className="text-right">{formatSqft(totals.cutoutSqft)}</dd>
              </>
            ) : null}
            <dt className="font-semibold">Edging / lines</dt>
            <dd className="text-right">{formatFeet(totals.lineFeet)}</dd>
          </dl>
          {hasBeds ? (
            <div className="rounded-ui border border-surface-line bg-surface-subtle p-3" data-testid="yard-materials">
              <p className="text-ui-base font-semibold text-ink">Bed materials (est.)</p>
              <p className="text-ui-base text-ink">Mulch: est. {formatCuYd(totals.materials.mulchCuYd)} at {settings.mulchDepthIn} in deep</p>
              <p className="text-ui-base text-ink">
                Pine straw: est. {totals.materials.strawBales} bale{totals.materials.strawBales === 1 ? '' : 's'} at {settings.strawSqftPerBale} sq ft per bale
              </p>
            </div>
          ) : null}
          <div>
            <button type="button" className="min-h-tap text-ui-base font-semibold text-brand-800 underline" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}>
              {canEditSettings ? 'Change mulch and pine straw numbers' : 'How the bed estimates are worked out'}
            </button>
            {settingsOpen ? (
              <div className="mt-2 flex flex-col gap-3 rounded-ui border border-surface-line p-3">
                {(Object.keys(AREA_MEASURE_SETTING_FIELDS) as Array<keyof AreaMeasureSettings>).map((k) => {
                  const f = AREA_MEASURE_SETTING_FIELDS[k]
                  return (
                    <label key={k} className="flex flex-col gap-1.5">
                      <span className="text-ui-sm font-semibold text-ink">{f.label}</span>
                      <Input
                        inputMode="decimal"
                        value={settingsDraft[k]}
                        disabled={!canEditSettings}
                        onChange={(e) => setSettingsDraft((d) => ({ ...d, [k]: e.target.value }))}
                        aria-describedby={`${k}-help`}
                      />
                      <span id={`${k}-help`} className="text-ui-sm text-ink">
                        {f.help} Your company uses {settings[k]} now{settings[k] === AREA_MEASURE_DEFAULTS[k] ? ' (the starting number)' : ` (starting number ${AREA_MEASURE_DEFAULTS[k]})`}.
                      </span>
                    </label>
                  )
                })}
                {canEditSettings ? (
                  <Button onClick={saveSettings}>Save for the company</Button>
                ) : (
                  <p className="text-ui-sm text-ink">Only an owner can change these.</p>
                )}
                {settingsMsg ? <p className="text-ui-base text-ink" role="status">{settingsMsg}</p> : null}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div ref={barRef} className="fixed inset-x-0 bottom-0 z-20 border-t border-surface-line bg-surface p-3 shadow-lg">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {saveMsg ? (
            <p className={`text-ui-base font-semibold ${saveMsg.ok ? 'text-ink' : 'text-danger'}`} role="status" data-testid="yard-save-msg">
              {saveMsg.text}{' '}
              {saveMsg.ok ? (
                <Link href={backHref} className="underline">
                  Back
                </Link>
              ) : null}
            </p>
          ) : !canSave && cannotSaveReason ? (
            <p className="text-ui-base text-ink">{cannotSaveReason}</p>
          ) : null}
          <Button onClick={save} disabled={!canSave || shapes.length === 0 || !dirty || !!draft || hasCrossing} loading={saving}>
            {!dirty && shapes.length > 0 ? 'Saved' : 'Save measurement'}
          </Button>
        </div>
      </div>
    </div>
  )
}
