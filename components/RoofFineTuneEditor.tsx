'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  boundsFromPoints,
  imagePixelToLatLng,
  initialViewScaleForFacet,
  latLngToImagePixel,
  type LatLng,
} from '@/lib/georef-bounds'
import type { GeoBounds } from '@/lib/roof-measure-map-zoom'

export type FineTuneFacet = {
  id: string
  points: LatLng[]
  color: string
  label: string
}

type RgbPayload = {
  bounds: GeoBounds
  imageBase64: string
  width: number
  height: number
}

type RoofFineTuneEditorProps = {
  selectedFacetId: string
  facets: FineTuneFacet[]
  centerLat: number
  centerLng: number
  onSave: (facetId: string, points: LatLng[]) => void
  onClose: () => void
}

const MIN_VIEW_SCALE = 1
const MAX_VIEW_SCALE = 12
const HANDLE_RADIUS = 14

export function RoofFineTuneEditor({
  selectedFacetId,
  facets,
  centerLat,
  centerLng,
  onSave,
  onClose,
}: RoofFineTuneEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const rgbRef = useRef<RgbPayload | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewScale, setViewScale] = useState(3)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [editPoints, setEditPoints] = useState<LatLng[]>([])
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 })
  const [dragging, setDragging] = useState<
    { kind: 'pan'; startX: number; startY: number; panX: number; panY: number } | { kind: 'vertex'; index: number } | null
  >(null)

  const selectedFacet = facets.find((f) => f.id === selectedFacetId)

  useEffect(() => {
    if (!selectedFacet) return
    setEditPoints(selectedFacet.points.map((p) => ({ ...p })))
  }, [selectedFacetId, selectedFacet])

  useEffect(() => {
    let alive = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(
          `/api/ai/solar-rgb-overlay?lat=${encodeURIComponent(String(centerLat))}&lng=${encodeURIComponent(String(centerLng))}`
        )
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          throw new Error(payload.error || 'HD imagery unavailable')
        }
        const payload = (await response.json()) as RgbPayload
        if (!alive) return
        rgbRef.current = payload

        const img = new Image()
        img.onload = () => {
          if (!alive) return
          imageRef.current = img
          const cw = containerRef.current?.clientWidth ?? 800
          const ch = containerRef.current?.clientHeight ?? 600
          setCanvasSize({ w: cw, h: ch })
          if (selectedFacet) {
            const scale = initialViewScaleForFacet(
              selectedFacet.points,
              payload.bounds,
              payload.width,
              payload.height,
              cw,
              ch
            )
            setViewScale(scale)
            const fb = boundsFromPoints(selectedFacet.points)
            if (fb) {
              const cx = (fb.west + fb.east) / 2
              const cy = (fb.north + fb.south) / 2
              const pix = latLngToImagePixel(cy, cx, payload.bounds, payload.width, payload.height)
              const baseScale = Math.min(cw / payload.width, ch / payload.height) * 0.92
              const s = baseScale * scale
              const imgLeft = (cw - payload.width * s) / 2
              const imgTop = (ch - payload.height * s) / 2
              const sx = imgLeft + pix.x * s
              const sy = imgTop + pix.y * s
              setPan({ x: cw / 2 - sx, y: ch / 2 - sy })
            }
          }
          setLoading(false)
        }
        img.onerror = () => {
          if (alive) {
            setError('Failed to decode HD image')
            setLoading(false)
          }
        }
        img.src = `data:image/png;base64,${payload.imageBase64}`
      } catch (e) {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Load failed')
        setLoading(false)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [centerLat, centerLng, selectedFacet])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setCanvasSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const imageTransform = useCallback(() => {
    const rgb = rgbRef.current
    if (!rgb) return null
    const baseScale = Math.min(canvasSize.w / rgb.width, canvasSize.h / rgb.height) * 0.92
    const scale = baseScale * viewScale
    const imgLeft = (canvasSize.w - rgb.width * scale) / 2 + pan.x
    const imgTop = (canvasSize.h - rgb.height * scale) / 2 + pan.y
    return { scale, imgLeft, imgTop, rgb }
  }, [canvasSize, viewScale, pan])

  const screenToLatLng = useCallback(
    (sx: number, sy: number): LatLng | null => {
      const t = imageTransform()
      if (!t) return null
      const ix = (sx - t.imgLeft) / t.scale
      const iy = (sy - t.imgTop) / t.scale
      return imagePixelToLatLng(ix, iy, t.rgb.bounds, t.rgb.width, t.rgb.height)
    },
    [imageTransform]
  )

  const latLngToScreen = useCallback(
    (lat: number, lng: number): { x: number; y: number } | null => {
      const t = imageTransform()
      if (!t) return null
      const pix = latLngToImagePixel(lat, lng, t.rgb.bounds, t.rgb.width, t.rgb.height)
      return { x: t.imgLeft + pix.x * t.scale, y: t.imgTop + pix.y * t.scale }
    },
    [imageTransform]
  )

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const img = imageRef.current
    const t = imageTransform()
    if (!canvas || !ctx || !img || !t) return

    canvas.width = canvasSize.w
    canvas.height = canvasSize.h
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h)
    ctx.drawImage(img, t.imgLeft, t.imgTop, t.rgb.width * t.scale, t.rgb.height * t.scale)

    for (const facet of facets) {
      const isSelected = facet.id === selectedFacetId
      const pts = isSelected ? editPoints : facet.points
      if (pts.length < 3) continue
      const screenPts = pts.map((p) => latLngToScreen(p.lat, p.lng)).filter(Boolean) as { x: number; y: number }[]
      if (screenPts.length < 3) continue

      ctx.beginPath()
      ctx.moveTo(screenPts[0].x, screenPts[0].y)
      for (let i = 1; i < screenPts.length; i++) {
        ctx.lineTo(screenPts[i].x, screenPts[i].y)
      }
      ctx.closePath()
      ctx.fillStyle = isSelected ? `${facet.color}88` : `${facet.color}33`
      ctx.fill()
      ctx.strokeStyle = isSelected ? '#ffffff' : facet.color
      ctx.lineWidth = isSelected ? 2.5 : 1.5
      ctx.stroke()

      if (isSelected) {
        for (let i = 0; i < screenPts.length; i++) {
          ctx.beginPath()
          ctx.arc(screenPts[i].x, screenPts[i].y, HANDLE_RADIUS, 0, Math.PI * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fill()
          ctx.strokeStyle = facet.color
          ctx.lineWidth = 3
          ctx.stroke()
          ctx.fillStyle = '#111827'
          ctx.font = 'bold 11px system-ui'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(String(i + 1), screenPts[i].x, screenPts[i].y)
        }
      }
    }
  }, [canvasSize, editPoints, facets, imageTransform, latLngToScreen, selectedFacetId])

  useEffect(() => {
    draw()
  }, [draw])

  const hitVertex = (sx: number, sy: number): number | null => {
    for (let i = 0; i < editPoints.length; i++) {
      const p = latLngToScreen(editPoints[i].lat, editPoints[i].lng)
      if (!p) continue
      const dx = sx - p.x
      const dy = sy - p.y
      if (dx * dx + dy * dy <= HANDLE_RADIUS * HANDLE_RADIUS * 1.4) return i
    }
    return null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const vi = hitVertex(sx, sy)
    if (vi != null) {
      setDragging({ kind: 'vertex', index: vi })
    } else {
      setDragging({ kind: 'pan', startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y })
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    if (dragging.kind === 'pan') {
      setPan({
        x: dragging.panX + (e.clientX - dragging.startX),
        y: dragging.panY + (e.clientY - dragging.startY),
      })
      return
    }
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const ll = screenToLatLng(sx, sy)
    if (!ll) return
    setEditPoints((prev) => prev.map((p, i) => (i === dragging.index ? ll : p)))
  }

  const onPointerUp = () => setDragging(null)

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.88 : 1.14
    setViewScale((s) => Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, s * delta)))
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-gray-950">
      <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Fine-tune section edges</h2>
          <p className="text-xs text-gray-400">
            HD satellite (0.1 m/px) — scroll to zoom further than Google Maps allows. Drag white handles to adjust corners.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500 hidden sm:inline">Zoom {viewScale.toFixed(1)}×</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || !!error || editPoints.length < 3}
            onClick={() => onSave(selectedFacetId, editPoints)}
            className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 disabled:opacity-50"
          >
            Apply changes
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/90 z-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mx-auto mb-3" />
              <p className="text-sm text-gray-300">Loading HD satellite…</p>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/90 z-10 p-6">
            <div className="text-center max-w-md">
              <p className="text-red-400 font-medium mb-2">{error}</p>
              <p className="text-sm text-gray-400 mb-4">
                HD imagery requires Google Solar coverage at this address. Try adjusting on the main map with the HD toggle.
              </p>
              <button type="button" onClick={onClose} className="text-sm text-gray-300 underline">
                Back to map
              </button>
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        />
        <div className="absolute bottom-4 left-4 flex gap-2">
          <button
            type="button"
            onClick={() => setViewScale((s) => Math.min(MAX_VIEW_SCALE, s * 1.25))}
            className="w-10 h-10 rounded-lg bg-gray-900/90 border border-gray-700 text-white text-lg"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setViewScale((s) => Math.max(MIN_VIEW_SCALE, s / 1.25))}
            className="w-10 h-10 rounded-lg bg-gray-900/90 border border-gray-700 text-white text-lg"
            title="Zoom out"
          >
            −
          </button>
        </div>
      </div>
    </div>
  )
}
