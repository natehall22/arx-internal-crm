'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { calculateElevationMeasure, calculateExteriorMeasureTotals } from '@/lib/exterior-measure'

// ─── Types ────────────────────────────────────────────────────────────────────

type Opening = {
  id?: string
  opening_type: 'window' | 'door' | 'garage_door' | 'other'
  label: string
  quantity: number
  width_ft: number
  height_ft: number
  notes?: string | null
}

type Elevation = {
  id?: string
  elevation_name: string
  wall_width_ft: number
  wall_height_ft: number
  gable_width_ft: number
  gable_height_ft: number
  waste_percent: number | null
  soffit_depth_ft: number
  soffit_length_ft: number
  fascia_lf: number
  gutter_lf: number
  starter_strip_lf: number
  j_channel_lf: number
  inside_corners: number
  outside_corners: number
  notes?: string | null
  openings: Opening[]
  // UI-only — not persisted to DB
  scaleReferenceLabel?: string
  scaleReferenceFt?: number
}

type MeasurePhoto = {
  id: string
  elevation_id: string | null
  caption: string | null
  filename: string
  url: string | null
}

type Report = {
  id?: string
  measure_kind: 'roof' | 'siding' | 'windows' | 'gutters_soffit_fascia' | 'full_exterior'
  status: 'draft' | 'reviewed' | 'final'
  report_title: string
  waste_percent: number
  notes: string
}

type ExteriorMeasureClientProps = {
  subject: any
  apiBase: string
  photoApiBase: string
  backHref: string
  backLabel: string
  printHref: string
  title?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const defaultReport: Report = {
  measure_kind: 'siding',
  status: 'draft',
  report_title: 'ARX Exterior Measure Report',
  waste_percent: 10,
  notes: '',
}

const defaultSideNames = ['Front', 'Right', 'Rear', 'Left']

const SCALE_OPTIONS = [
  { value: 'entry door width',   label: 'Front door width',       hint: 'usually 3 ft' },
  { value: 'garage door width',  label: 'Garage door width',      hint: 'usually 9 or 16 ft' },
  { value: 'window width',       label: 'A window width',         hint: '' },
  { value: 'window height',      label: 'A window height',        hint: '' },
  { value: 'wall height',        label: 'Wall height to roofline', hint: '' },
  { value: 'custom measurement', label: 'Something else',         hint: '' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function fmt(value: number) {
  return String(Math.round(value * 100) / 100)
}

function newSide(name = 'New side', wastePercent = 10): Elevation {
  return {
    elevation_name: name,
    wall_width_ft: 0, wall_height_ft: 0,
    gable_width_ft: 0, gable_height_ft: 0,
    waste_percent: wastePercent,
    soffit_depth_ft: 0, soffit_length_ft: 0,
    fascia_lf: 0, gutter_lf: 0,
    starter_strip_lf: 0, j_channel_lf: 0,
    inside_corners: 0, outside_corners: 0,
    notes: '', openings: [],
  }
}

function mapElevation(el: any): Elevation {
  return {
    id: el.id,
    elevation_name: el.elevation_name || 'Side',
    wall_width_ft:    cleanNumber(el.wall_width_ft),
    wall_height_ft:   cleanNumber(el.wall_height_ft),
    gable_width_ft:   cleanNumber(el.gable_width_ft),
    gable_height_ft:  cleanNumber(el.gable_height_ft),
    waste_percent:    el.waste_percent == null ? null : cleanNumber(el.waste_percent),
    soffit_depth_ft:  cleanNumber(el.soffit_depth_ft),
    soffit_length_ft: cleanNumber(el.soffit_length_ft),
    fascia_lf:        cleanNumber(el.fascia_lf),
    gutter_lf:        cleanNumber(el.gutter_lf),
    starter_strip_lf: cleanNumber(el.starter_strip_lf),
    j_channel_lf:     cleanNumber(el.j_channel_lf),
    inside_corners:   cleanNumber(el.inside_corners),
    outside_corners:  cleanNumber(el.outside_corners),
    notes: el.notes || '',
    openings: (el.openings || []).map((o: any) => ({
      id: o.id,
      opening_type: o.opening_type || 'window',
      label: o.label || '',
      quantity: cleanNumber(o.quantity || 1),
      width_ft: cleanNumber(o.width_ft),
      height_ft: cleanNumber(o.height_ft),
      notes: o.notes || '',
    })),
  }
}

// ─── Number input ─────────────────────────────────────────────────────────────

function Field({
  label, hint, value, onChange, step = '0.1',
}: {
  label: string; hint?: string; value: number | null
  onChange: (v: number) => void; step?: string
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600">
        {label}{hint && <span className="ml-1 font-normal text-gray-400">{hint}</span>}
      </span>
      <input
        type="number" inputMode="decimal" min="0" step={step}
        value={value ?? ''}
        onChange={(e) => onChange(cleanNumber(e.target.value))}
        className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </label>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExteriorMeasureClient({
  subject, apiBase, photoApiBase, backHref, backLabel, printHref, title = 'Exterior Measure',
}: ExteriorMeasureClientProps) {
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [report, setReport]         = useState<Report>(defaultReport)
  const [sides, setSides]           = useState<Elevation[]>([])
  const [photos, setPhotos]         = useState<MeasurePhoto[]>([])
  const [activeSideIdx, setActiveSideIdx] = useState(0)
  const [scanningId, setScanningId] = useState<string | null>(null)
  const [scannedIds, setScannedIds] = useState<Set<string>>(new Set())
  const [aiNotes, setAiNotes]       = useState<Map<string, string>>(new Map())
  const [detailOpen, setDetailOpen] = useState<Set<string>>(new Set())
  const [isNewMeasure, setIsNewMeasure] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const pendingElevId = useRef<string>('general')

  // Resolve names from subject shape
  const customer   = Array.isArray(subject.customer) ? subject.customer[0] : subject.customer || subject.customers
  const project    = Array.isArray(subject.project)  ? subject.project[0]  : subject.project
  const lead       = project ? (Array.isArray(project.leads) ? project.leads[0] : project.leads) : null
  const directLead = Array.isArray(subject.leads)    ? subject.leads[0]    : subject.leads
  const customerName = customer?.name || lead?.homeowner_name || directLead?.homeowner_name || subject.contact_name || 'Customer'
  const addressText  = subject.address_text || subject.job_number || ''

  const normalizedSides = useMemo(
    () => sides.map((s) => ({ ...s, waste_percent: s.waste_percent ?? report.waste_percent })),
    [sides, report.waste_percent],
  )
  const totals = useMemo(() => calculateExteriorMeasureTotals(normalizedSides), [normalizedSides])

  // ── Load ─────────────────────────────────────────────────────────────────

  async function loadMeasure() {
    setLoading(true); setError(null)
    try {
      const res  = await fetch(apiBase, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      if (data.report) {
        setReport({
          id: data.report.id,
          measure_kind:  data.report.measure_kind  || 'siding',
          status:        data.report.status        || 'draft',
          report_title:  data.report.report_title  || defaultReport.report_title,
          waste_percent: cleanNumber(data.report.waste_percent || 10),
          notes:         data.report.notes         || '',
        })
        setSides((data.elevations || []).map(mapElevation))
        setIsNewMeasure(false)
      } else {
        setReport(defaultReport)
        setSides(defaultSideNames.map((n) => newSide(n, defaultReport.waste_percent)))
        setIsNewMeasure(true)
      }
      setPhotos(data.photos || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally { setLoading(false) }
  }

  useEffect(() => { void loadMeasure() }, [apiBase])

  // Eagerly save new measures so elevation IDs exist before photos are taken
  useEffect(() => {
    if (!loading && isNewMeasure && !report.id) {
      setIsNewMeasure(false)
      void saveMeasure()
    }
  }, [loading, isNewMeasure, report.id])

  // ── Mutations ─────────────────────────────────────────────────────────────

  function patchSide(idx: number, patch: Partial<Elevation>) {
    setSides((curr) => curr.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  function patchOpening(sIdx: number, oIdx: number, patch: Partial<Opening>) {
    setSides((curr) =>
      curr.map((s, i) =>
        i === sIdx ? { ...s, openings: s.openings.map((o, j) => (j === oIdx ? { ...o, ...patch } : o)) } : s,
      ),
    )
  }

  async function saveMeasure(nextStatus?: Report['status']): Promise<boolean> {
    setSaving(true); setError(null)
    try {
      const elevationsForApi = sides.map(({ scaleReferenceLabel: _a, scaleReferenceFt: _b, ...rest }) => rest)
      const res  = await fetch(apiBase, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: { ...report, status: nextStatus || report.status }, elevations: elevationsForApi }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setReport({
        id: data.report.id,
        measure_kind:  data.report.measure_kind  || 'siding',
        status:        data.report.status        || 'draft',
        report_title:  data.report.report_title  || defaultReport.report_title,
        waste_percent: cleanNumber(data.report.waste_percent || 10),
        notes:         data.report.notes         || '',
      })
      setSides((data.elevations || []).map(mapElevation))
      setPhotos(data.photos || [])
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      return false
    } finally { setSaving(false) }
  }

  function openCamera(elevId: string) {
    pendingElevId.current = elevId
    fileRef.current?.click()
  }

  async function uploadPhoto(file: File) {
    setUploading(true); setError(null)
    const elevId = pendingElevId.current
    try {
      if (!report.id) { const ok = await saveMeasure(); if (!ok) return }
      const form = new FormData()
      form.append('file', file)
      if (elevId !== 'general') form.append('elevation_id', elevId)
      const res  = await fetch(photoApiBase, { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      await loadMeasure()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const photosBySide = useMemo(() => {
    const map = new Map<string, MeasurePhoto[]>()
    for (const p of photos) {
      const k = p.elevation_id || 'general'
      map.set(k, [...(map.get(k) || []), p])
    }
    return map
  }, [photos])

  async function scanSide(elevId: string, idx: number) {
    if (!report.id) { setError('Save the measure first, then scan.'); return }
    setScanningId(elevId); setError(null)
    try {
      const side = sides[idx]
      const res  = await fetch('/api/ai/extract-exterior-measure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId:            report.id,
          elevationId:         elevId,
          scaleReferenceLabel: side?.scaleReferenceLabel || undefined,
          scaleReferenceFt:    side?.scaleReferenceFt    || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Measuring failed')

      const e = data.estimates || {}
      const patch: Partial<Elevation> = {}
      if (typeof e.wall_width_ft    === 'number') patch.wall_width_ft    = e.wall_width_ft
      if (typeof e.wall_height_ft   === 'number') patch.wall_height_ft   = e.wall_height_ft
      if (typeof e.gable_width_ft   === 'number') patch.gable_width_ft   = e.gable_width_ft
      if (typeof e.gable_height_ft  === 'number') patch.gable_height_ft  = e.gable_height_ft
      if (typeof e.soffit_depth_ft  === 'number') patch.soffit_depth_ft  = e.soffit_depth_ft
      if (typeof e.soffit_length_ft === 'number') patch.soffit_length_ft = e.soffit_length_ft
      if (typeof e.fascia_lf        === 'number') patch.fascia_lf        = e.fascia_lf
      if (typeof e.gutter_lf        === 'number') patch.gutter_lf        = e.gutter_lf
      if (typeof e.starter_strip_lf === 'number') patch.starter_strip_lf = e.starter_strip_lf
      if (typeof e.j_channel_lf     === 'number') patch.j_channel_lf     = e.j_channel_lf
      if (typeof e.inside_corners   === 'number') patch.inside_corners   = Math.round(e.inside_corners)
      if (typeof e.outside_corners  === 'number') patch.outside_corners  = Math.round(e.outside_corners)
      if (Array.isArray(e.openings) && e.openings.length > 0) {
        patch.openings = e.openings.map((o: any) => ({
          opening_type: ['window','door','garage_door','other'].includes(o.opening_type) ? o.opening_type : 'window',
          label: String(o.label || ''),
          quantity: Math.max(1, Math.round(Number(o.quantity) || 1)),
          width_ft:  Number(o.width_ft)  || 0,
          height_ft: Number(o.height_ft) || 0,
          notes: '',
        }))
      }
      patchSide(idx, patch)
      const note = typeof e.notes === 'string' && e.notes ? e.notes : ''
      setAiNotes((prev) => new Map(prev).set(elevId, note))
      setScannedIds((prev) => new Set(prev).add(elevId))
      // Auto-open detail for easy review after scan
      setDetailOpen((prev) => new Set(prev).add(elevId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Measuring failed')
    } finally { setScanningId(null) }
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  const activeSide = sides[activeSideIdx] ?? sides[0]
  const activeSideCalc = activeSide
    ? calculateElevationMeasure({ ...activeSide, waste_percent: activeSide.waste_percent ?? report.waste_percent })
    : null
  const activeSidePhotos = activeSide?.id ? (photosBySide.get(activeSide.id) || []) : []
  const isScanning    = scanningId === activeSide?.id
  const hasPhotos     = activeSidePhotos.length > 0
  const wasScanned    = activeSide?.id ? scannedIds.has(activeSide.id) : false
  const showDetail    = activeSide?.id ? detailOpen.has(activeSide.id) : false

  function toggleDetail(elevId: string) {
    setDetailOpen((prev) => {
      const next = new Set(prev)
      next.has(elevId) ? next.delete(elevId) : next.add(elevId)
      return next
    })
  }

  function sideStatus(side: Elevation) {
    const sidePhotos = side.id ? (photosBySide.get(side.id) || []) : []
    if (side.id && scannedIds.has(side.id)) return 'scanned'
    if (sidePhotos.length > 0) return 'ready'
    return 'empty'
  }

  const sidesScanned   = sides.filter((s) => s.id && scannedIds.has(s.id)).length
  const sidesWithPhotos = sides.filter((s) => s.id && (photosBySide.get(s.id) || []).length > 0).length

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">

      {/* Hidden file input — triggered per side */}
      <input
        ref={fileRef} type="file" accept="image/*" capture="environment"
        className="hidden" disabled={uploading}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPhoto(f) }}
      />

      {/* ── Header ── */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href={backHref} className="inline-flex min-h-[44px] items-center text-sm font-medium text-indigo-600 hover:text-indigo-800">
            {backLabel}
          </Link>
          <h1 className="text-2xl font-bold text-gray-950">{title}</h1>
          <p className="text-sm text-gray-500">{customerName}{addressText ? ` · ${addressText}` : ''}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            type="button" onClick={() => void saveMeasure()} disabled={saving || loading}
            className="min-h-[44px] rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >{saving ? 'Saving…' : 'Save'}</button>
          <Link href={printHref}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >Export</Link>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="rounded-xl border bg-white p-6 text-sm text-gray-500">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className="space-y-4 lg:col-span-2">

            {/* ── Side tabs ── */}
            <div className="rounded-xl border bg-white p-3 shadow-sm">
              <div className="flex flex-wrap gap-2">
                {sides.map((side, idx) => {
                  const status = sideStatus(side)
                  const isActive = idx === activeSideIdx
                  return (
                    <button
                      key={side.id || idx}
                      type="button"
                      onClick={() => setActiveSideIdx(idx)}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-gray-900 text-white'
                          : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {status === 'scanned' && <span className={isActive ? 'text-emerald-300' : 'text-emerald-500'}>✓</span>}
                      {status === 'ready'   && <span className={isActive ? 'text-amber-300'   : 'text-amber-400'}>●</span>}
                      {status === 'empty'   && <span className={isActive ? 'text-gray-400'    : 'text-gray-300'}>○</span>}
                      {side.elevation_name}
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => {
                    setSides((curr) => [...curr, newSide(`Side ${curr.length + 1}`, report.waste_percent)])
                    setActiveSideIdx(sides.length)
                  }}
                  className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-500 hover:border-indigo-400 hover:text-indigo-600"
                >
                  + Add side
                </button>
              </div>
            </div>

            {/* ── Active side card ── */}
            {activeSide && (
              <div className="rounded-xl border bg-white shadow-sm overflow-hidden">

                {/* Side name + remove */}
                <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
                  <input
                    value={activeSide.elevation_name}
                    onChange={(e) => patchSide(activeSideIdx, { elevation_name: e.target.value })}
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-lg font-semibold text-gray-950 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="e.g. Front, Rear, Garage side…"
                  />
                  {sides.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSides((curr) => curr.filter((_, i) => i !== activeSideIdx))
                        setActiveSideIdx((i) => Math.max(0, i - 1))
                      }}
                      className="min-h-[40px] rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    >Remove</button>
                  )}
                </div>

                <div className="p-4 space-y-4">

                  {/* ─── STATE 1: No photos yet ─────────────────────────── */}
                  {!hasPhotos && !showDetail && (
                    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 py-12 text-center">
                      <div className="text-5xl mb-3">📷</div>
                      <p className="text-base font-semibold text-gray-800">
                        Take photos of the {activeSide.elevation_name.toLowerCase()} side
                      </p>
                      <p className="mt-1 text-sm text-gray-500 max-w-xs">
                        Stand back so the whole wall fits in frame. A couple overlapping shots is fine.
                      </p>
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => openCamera(activeSide.id || 'general')}
                        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
                      >
                        {uploading && pendingElevId.current === (activeSide.id || 'general')
                          ? 'Uploading…'
                          : '📷  Take photos'}
                      </button>
                      <button
                        type="button"
                        onClick={() => activeSide.id && toggleDetail(activeSide.id)}
                        className="mt-3 text-xs text-gray-400 underline underline-offset-2 hover:text-gray-600"
                      >
                        I'll type the numbers in myself
                      </button>
                    </div>
                  )}

                  {/* ─── STATE 2 & 3: Has photos or manual mode ──────────── */}
                  {(hasPhotos || showDetail) && (
                    <>
                      {/* Photo strip + add more */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-semibold text-gray-700">
                            {activeSide.elevation_name} photos
                            <span className="ml-1 font-normal text-gray-400">({activeSidePhotos.length})</span>
                          </p>
                          <button
                            type="button" disabled={uploading}
                            onClick={() => openCamera(activeSide.id || 'general')}
                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {uploading && pendingElevId.current === (activeSide.id || 'general') ? 'Uploading…' : '+ Add photo'}
                          </button>
                        </div>
                        {hasPhotos && (
                          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                            {activeSidePhotos.map((p) => (
                              <a key={p.id} href={p.url || '#'} target="_blank" rel="noopener noreferrer"
                                className="relative aspect-square overflow-hidden rounded-lg bg-gray-100">
                                <img src={p.url || ''} alt={p.filename || 'Photo'} className="h-full w-full object-cover" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* ─── AI measure CTA (before scan) ─── */}
                      {activeSide.id && hasPhotos && !wasScanned && !isScanning && (
                        <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-indigo-900">Measure with AI</p>
                              <p className="mt-0.5 text-sm text-indigo-700">
                                AI looks at your photos and figures out all the measurements — you just check the numbers after.
                              </p>
                            </div>
                            <button
                              type="button" disabled={scanningId !== null}
                              onClick={() => void scanSide(activeSide.id!, activeSideIdx)}
                              className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                              Go →
                            </button>
                          </div>
                          {/* Optional scale hint */}
                          <div className="mt-3 flex flex-wrap items-end gap-2">
                            <label className="flex-1 min-w-[160px]">
                              <span className="text-xs text-indigo-700 font-medium">
                                Know any actual measurements on this wall?
                                <span className="font-normal"> Helps AI be more accurate — totally optional.</span>
                              </span>
                              <select
                                value={activeSide.scaleReferenceLabel || ''}
                                onChange={(e) => patchSide(activeSideIdx, { scaleReferenceLabel: e.target.value || undefined })}
                                className="mt-1 min-h-[40px] w-full rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-sm text-gray-900"
                              >
                                <option value="">— No, just go —</option>
                                {SCALE_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>{o.label}{o.hint ? ` (${o.hint})` : ''}</option>
                                ))}
                              </select>
                            </label>
                            {activeSide.scaleReferenceLabel && (
                              <label className="w-28">
                                <span className="text-xs text-indigo-700 font-medium">How many feet?</span>
                                <input
                                  type="number" inputMode="decimal" step="0.5" min="0.5" max="100"
                                  value={activeSide.scaleReferenceFt ?? ''}
                                  onChange={(e) => patchSide(activeSideIdx, { scaleReferenceFt: parseFloat(e.target.value) || undefined })}
                                  placeholder="e.g. 3"
                                  className="mt-1 min-h-[40px] w-full rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-sm text-gray-900"
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ─── Scanning in progress ─── */}
                      {isScanning && (
                        <div className="flex items-center gap-3 rounded-xl bg-indigo-50 border border-indigo-200 px-4 py-3">
                          <svg className="h-5 w-5 animate-spin text-indigo-600 shrink-0" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          <div>
                            <p className="text-sm font-semibold text-indigo-900">Measuring…</p>
                            <p className="text-xs text-indigo-700">AI is looking at your photos. This takes about 15–30 seconds.</p>
                          </div>
                        </div>
                      )}

                      {/* ─── MEASUREMENTS (after scan or manual) ─── */}
                      {(wasScanned || showDetail) && activeSideCalc && !isScanning && (
                        <div className="space-y-3">

                          {/* AI result banner */}
                          {wasScanned && (
                            <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5">
                              <div>
                                <p className="text-sm font-semibold text-emerald-800">
                                  ✓ Measured — {fmt(activeSide.wall_width_ft)} × {fmt(activeSide.wall_height_ft)} ft wall
                                  {activeSide.openings.length > 0 && `, ${activeSide.openings.reduce((sum, o) => sum + o.quantity, 0)} opening${activeSide.openings.reduce((sum, o) => sum + o.quantity, 0) !== 1 ? 's' : ''}`}
                                </p>
                                {aiNotes.get(activeSide.id!) && (
                                  <p className="mt-0.5 text-xs text-emerald-700">{aiNotes.get(activeSide.id!)}</p>
                                )}
                              </div>
                              <button
                                type="button" disabled={scanningId !== null}
                                onClick={() => void scanSide(activeSide.id!, activeSideIdx)}
                                className="shrink-0 text-xs text-emerald-600 underline underline-offset-2 hover:text-emerald-800 disabled:opacity-50"
                              >Re-measure</button>
                            </div>
                          )}

                          {/* Quick summary cards */}
                          <div className="grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-3 text-sm sm:grid-cols-4">
                            <div>
                              <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">Wall size</p>
                              <p className="mt-0.5 font-semibold text-gray-900">{fmt(activeSide.wall_width_ft)} × {fmt(activeSide.wall_height_ft)} ft</p>
                            </div>
                            <div>
                              <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">Siding needed</p>
                              <p className="mt-0.5 font-semibold text-gray-900">{fmt(activeSideCalc.net_siding_sqft)} sqft</p>
                            </div>
                            <div>
                              <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">Windows & doors</p>
                              <p className="mt-0.5 font-semibold text-gray-900">
                                {activeSide.openings.length === 0
                                  ? 'None'
                                  : activeSide.openings.map((o) => `${o.quantity} ${o.opening_type.replace('_', ' ')}`).join(', ')}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">Corners</p>
                              <p className="mt-0.5 font-semibold text-gray-900">{activeSide.outside_corners} out · {activeSide.inside_corners} in</p>
                            </div>
                          </div>

                          {/* Edit toggle */}
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-400">
                              {showDetail ? 'Editing measurements' : 'Something look off?'}
                            </p>
                            <button
                              type="button"
                              onClick={() => activeSide.id && toggleDetail(activeSide.id)}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                showDetail
                                  ? 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                                  : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                              }`}
                            >
                              {showDetail ? 'Hide fields' : '✏️ Edit numbers'}
                            </button>
                          </div>

                          {/* Detail form — editable fields */}
                          {showDetail && (
                            <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">

                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Wall size</p>
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                  <Field label="Width" hint="(ft)" value={activeSide.wall_width_ft}  onChange={(v) => patchSide(activeSideIdx, { wall_width_ft:  v })} />
                                  <Field label="Height" hint="(ft)" value={activeSide.wall_height_ft} onChange={(v) => patchSide(activeSideIdx, { wall_height_ft: v })} />
                                  <Field label="Waste %" hint="(trim & cuts)" value={activeSide.waste_percent ?? report.waste_percent} onChange={(v) => patchSide(activeSideIdx, { waste_percent: v })} />
                                </div>
                              </div>

                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Gable <span className="font-normal normal-case tracking-normal text-gray-400">— triangular section at the peak, if any</span></p>
                                <div className="grid grid-cols-2 gap-3">
                                  <Field label="Gable width" hint="(ft)" value={activeSide.gable_width_ft}  onChange={(v) => patchSide(activeSideIdx, { gable_width_ft:  v })} />
                                  <Field label="Gable height" hint="(ft)" value={activeSide.gable_height_ft} onChange={(v) => patchSide(activeSideIdx, { gable_height_ft: v })} />
                                </div>
                              </div>

                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Eave overhang, fascia & gutters</p>
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                  <Field label="Overhang depth"  hint="(ft)" value={activeSide.soffit_depth_ft}  onChange={(v) => patchSide(activeSideIdx, { soffit_depth_ft:  v })} />
                                  <Field label="Overhang run"    hint="(ft)" value={activeSide.soffit_length_ft} onChange={(v) => patchSide(activeSideIdx, { soffit_length_ft: v })} />
                                  <Field label="Fascia board"    hint="(ft)" value={activeSide.fascia_lf}         onChange={(v) => patchSide(activeSideIdx, { fascia_lf:         v })} />
                                  <Field label="Gutter run"      hint="(ft)" value={activeSide.gutter_lf}         onChange={(v) => patchSide(activeSideIdx, { gutter_lf:         v })} />
                                  <Field label="Starter strip"   hint="(ft)" value={activeSide.starter_strip_lf}  onChange={(v) => patchSide(activeSideIdx, { starter_strip_lf:  v })} />
                                  <Field label="Window/door trim" hint="(ft, J-channel)" value={activeSide.j_channel_lf} onChange={(v) => patchSide(activeSideIdx, { j_channel_lf: v })} />
                                </div>
                              </div>

                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Corners on this side</p>
                                <div className="grid grid-cols-2 gap-3">
                                  <Field label="Outside corners" hint="(walls meeting outward)" value={activeSide.outside_corners} step="1" onChange={(v) => patchSide(activeSideIdx, { outside_corners: v })} />
                                  <Field label="Inside corners"  hint="(walls meeting inward)"  value={activeSide.inside_corners}  step="1" onChange={(v) => patchSide(activeSideIdx, { inside_corners:  v })} />
                                </div>
                              </div>

                              {/* Calc row */}
                              <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 sm:grid-cols-4">
                                <span>Gross: <strong className="text-gray-900">{fmt(activeSideCalc.gross_wall_sqft)} sqft</strong></span>
                                <span>Gable: <strong className="text-gray-900">{fmt(activeSideCalc.gable_sqft)} sqft</strong></span>
                                <span>Openings: <strong className="text-gray-900">−{fmt(activeSideCalc.opening_deductions_sqft)} sqft</strong></span>
                                <span className="font-semibold text-gray-900">Net: {fmt(activeSideCalc.net_siding_sqft)} sqft</span>
                              </div>

                              {/* Windows & Doors */}
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Windows & doors</p>
                                  <button
                                    type="button"
                                    onClick={() => patchSide(activeSideIdx, { openings: [...activeSide.openings, { opening_type: 'window', label: '', quantity: 1, width_ft: 0, height_ft: 0, notes: '' }] })}
                                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                  >+ Add opening</button>
                                </div>
                                {activeSide.openings.length === 0 ? (
                                  <p className="rounded-lg border border-dashed border-gray-200 p-3 text-sm text-gray-400">
                                    None found yet — AI picks these up automatically when you measure.
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    {activeSide.openings.map((op, opIdx) => (
                                      <div key={op.id || opIdx} className="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-5">
                                        <label>
                                          <span className="text-xs font-medium text-gray-600">Type</span>
                                          <select
                                            value={op.opening_type}
                                            onChange={(e) => patchOpening(activeSideIdx, opIdx, { opening_type: e.target.value as Opening['opening_type'] })}
                                            className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
                                          >
                                            <option value="window">Window</option>
                                            <option value="door">Door</option>
                                            <option value="garage_door">Garage door</option>
                                            <option value="other">Other</option>
                                          </select>
                                        </label>
                                        <Field label="How many" value={op.quantity} step="1" onChange={(v) => patchOpening(activeSideIdx, opIdx, { quantity: v })} />
                                        <Field label="Width" hint="(ft)" value={op.width_ft}  onChange={(v) => patchOpening(activeSideIdx, opIdx, { width_ft:  v })} />
                                        <Field label="Height" hint="(ft)" value={op.height_ft} onChange={(v) => patchOpening(activeSideIdx, opIdx, { height_ft: v })} />
                                        <button
                                          type="button"
                                          onClick={() => patchSide(activeSideIdx, { openings: activeSide.openings.filter((_, i) => i !== opIdx) })}
                                          className="mt-5 min-h-[44px] rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                                        >Remove</button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                </div>
              </div>
            )}

            {/* ── Options (hidden by default) ── */}
            <details className="rounded-xl border bg-white shadow-sm">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-500 hover:text-gray-800">
                ⚙️ Options
              </summary>
              <div className="border-t border-gray-100 p-4 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="sm:col-span-2">
                    <span className="text-xs font-medium text-gray-600">Report title</span>
                    <input
                      value={report.report_title}
                      onChange={(e) => setReport((r) => ({ ...r, report_title: e.target.value }))}
                      className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </label>
                  <Field label="Default waste %" hint="(all sides)" value={report.waste_percent} onChange={(v) => setReport((r) => ({ ...r, waste_percent: v }))} />
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-gray-600">What are you measuring?</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {([
                      { value: 'siding',               label: 'Siding',             helper: 'Walls, gables, corners & trim' },
                      { value: 'windows',              label: 'Windows',            helper: 'All openings with sizes & counts' },
                      { value: 'gutters_soffit_fascia', label: 'Gutters & soffit',   helper: 'Fascia, gutter, soffit & starter' },
                      { value: 'roof',                 label: 'Roof',               helper: 'Use the roof measuring tool ↗' },
                      { value: 'full_exterior',        label: 'Full exterior',      helper: 'Siding, windows, gutters & photos' },
                    ] as const).map((t) => (
                      <button key={t.value} type="button"
                        onClick={() => setReport((r) => ({ ...r, measure_kind: t.value }))}
                        className={`min-h-[52px] rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          report.measure_kind === t.value
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-950'
                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span className="block font-semibold">{t.label}</span>
                        <span className="mt-0.5 block text-xs text-gray-500">{t.helper}</span>
                      </button>
                    ))}
                  </div>
                  {report.measure_kind === 'roof' && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-sm font-medium text-amber-900">Roof measuring uses a different tool</p>
                      <p className="mt-0.5 text-xs text-amber-700">
                        The roof tool traces facets on a satellite image and calculates pitch-adjusted area.
                      </p>
                      <Link
                        href="/tools/roof-measure"
                        className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
                      >
                        Open roof measure tool →
                      </Link>
                    </div>
                  )}
                </div>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Notes</span>
                  <textarea
                    value={report.notes}
                    onChange={(e) => setReport((r) => ({ ...r, notes: e.target.value }))}
                    placeholder="Product assumptions, field notes, anything worth remembering…"
                    className="mt-1 min-h-[80px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none"
                  />
                </label>
              </div>
            </details>

          </section>

          {/* ── What you'll need sidebar ── */}
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-950">What you'll need</h2>
                {sidesScanned > 0 && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    {sidesScanned} of {sides.length} measured
                  </span>
                )}
                {sidesScanned === 0 && sidesWithPhotos > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {sidesWithPhotos} ready to measure
                  </span>
                )}
              </div>

              {sidesScanned === 0 ? (
                <p className="mt-2 text-sm text-gray-400">
                  Measure each side of the house and the totals will show up here.
                </p>
              ) : (
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Gross wall</dt>         <dd className="font-medium">{fmt(totals.gross_wall_sqft)} sqft</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Gable</dt>              <dd className="font-medium">{fmt(totals.gable_sqft)} sqft</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Openings (deducted)</dt><dd className="font-medium">−{fmt(totals.opening_deductions_sqft)} sqft</dd></div>
                  <div className="flex justify-between gap-3 border-t pt-2"><dt className="font-semibold text-gray-900">Siding needed</dt> <dd className="font-semibold">{fmt(totals.net_siding_sqft)} sqft</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Waste allowance</dt>   <dd className="font-medium">{fmt(totals.waste_sqft)} sqft</dd></div>
                  <div className="flex justify-between gap-3"><dt className="font-semibold text-gray-900">Squares of siding</dt> <dd className="font-semibold text-indigo-700">{fmt(totals.siding_squares)}</dd></div>
                  <div className="flex justify-between gap-3 border-t pt-2"><dt className="text-gray-500">Soffit</dt>        <dd className="font-medium">{fmt(totals.soffit_sqft)} sqft</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Fascia board</dt>       <dd className="font-medium">{fmt(totals.fascia_lf)} lin ft</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Gutters</dt>            <dd className="font-medium">{fmt(totals.gutter_lf)} lin ft</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Starter strip</dt>     <dd className="font-medium">{fmt(totals.starter_strip_lf)} lin ft</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Window/door trim</dt>  <dd className="font-medium">{fmt(totals.j_channel_lf)} lin ft</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Outside corners</dt>  <dd className="font-medium">{totals.outside_corners}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Inside corners</dt>   <dd className="font-medium">{totals.inside_corners}</dd></div>
                </dl>
              )}

              {/* Side-by-side status */}
              <div className="mt-4 space-y-1 border-t pt-3">
                {sides.map((side, idx) => {
                  const st = sideStatus(side)
                  return (
                    <button key={side.id || idx} type="button"
                      onClick={() => setActiveSideIdx(idx)}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-gray-50 ${activeSideIdx === idx ? 'bg-gray-100 font-semibold' : ''}`}
                    >
                      <span className="text-gray-700">{side.elevation_name}</span>
                      <span className={st === 'scanned' ? 'text-emerald-600' : st === 'ready' ? 'text-amber-500' : 'text-gray-300'}>
                        {st === 'scanned' ? '✓ measured' : st === 'ready' ? '● ready to measure' : '○ no photos yet'}
                      </span>
                    </button>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={() => void saveMeasure('reviewed')}
                disabled={saving}
                className="mt-4 min-h-[44px] w-full rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              >All done — save it ✓</button>
            </div>
          </aside>

        </div>
      )}
    </main>
  )
}
