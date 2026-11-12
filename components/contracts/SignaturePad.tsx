'use client'

import { useRef, useEffect, useState } from 'react'

interface SignaturePadProps {
  /** Controlled use (the signing pages, contract and change-order modals). Optional when `name` is given. */
  onChange?: (dataUrl: string | null) => void
  value?: string | null
  /** Plain-form use: posts the drawn signature as `<name>_type` ("draw") and `<name>_data` (PNG data URL). */
  name?: string
  disabled?: boolean
  width?: number
  height?: number
}

const MAX_DPR = 3
// The server refuses a signature over MAX_SIGNATURE_CHARS (lib/signing-input.ts); a very dense scribble at 3x could approach it.
const SAFE_CHARS = 300_000

/** The PNG the pad hands out. Sharp (backing-store size) unless that is too big to save, then the old 1x size. */
function exportPng(canvas: HTMLCanvasElement, width: number, height: number): string {
  const full = canvas.toDataURL('image/png')
  if (full.length <= SAFE_CHARS) return full
  const small = document.createElement('canvas')
  small.width = width
  small.height = height
  const ctx = small.getContext('2d')
  if (!ctx) return full
  ctx.drawImage(canvas, 0, 0, width, height)
  return small.toDataURL('image/png')
}

export default function SignaturePad({
  onChange,
  value,
  name,
  disabled = false,
  width = 400,
  height = 150,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Refs, not state, for the stroke itself: pointer events arrive faster than React re-renders.
  const drawingRef = useRef<number | null>(null) // pointerId of the stroke in progress
  const inkRef = useRef(false)
  const lastEmittedRef = useRef<string | null>(null)
  // Known limits (not handled): iOS 12 has no pointer events; Android palm rejection may drop a stroke when a palm rests on the pad.
  const [hasSignature, setHasSignature] = useState(false)
  // What a plain <form> posts when the pad is used with `name` (controlled callers read it from onChange instead).
  const [drawn, setDrawn] = useState<string>(value ?? '')

  // The drawing space stays `width` x `height` (what the PDFs were always fed); only the backing store is sharper.
  const paint = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
  }

  /** Size the backing store to the on-screen size x device pixel ratio (cap 3), keeping what is already drawn. */
  const fitBackingStore = (canvas: HTMLCanvasElement) => {
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DPR)
    const cssW = canvas.getBoundingClientRect().width || width
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round((w * height) / width))
    if (canvas.width === w && canvas.height === h) return
    const old = canvas.width > 0 && canvas.height > 0 ? document.createElement('canvas') : null
    if (old) {
      old.width = canvas.width
      old.height = canvas.height
      old.getContext('2d')?.drawImage(canvas, 0, 0)
    }
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    if (old) ctx.drawImage(old, 0, 0, w, h)
    paint(ctx, canvas)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    fitBackingStore(canvas)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => fitBackingStore(canvas))
    ro.observe(canvas)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height])

  // Redraw only when the PARENT hands in a signature we did not just emit. Every caller echoes our own onChange back as
  // `value`; clearing + async-redrawing that echo would wipe a fast second stroke (an i-dot) before the image loads.
  useEffect(() => {
    if (value && value === lastEmittedRef.current) return
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    paint(ctx, canvas)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    lastEmittedRef.current = value ?? null

    if (!value) {
      // The parent emptied the pad: a tap must not export a blank PNG.
      inkRef.current = false
      setHasSignature(false)
      setDrawn('')
    } else {
      const img = new Image()
      img.onload = () => {
        if (cancelled) return // the value changed or was cleared while this loaded
        ctx.drawImage(img, 0, 0, width, height)
        inkRef.current = true
        setHasSignature(true)
      }
      img.src = value
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const getCoordinates = (e: React.PointerEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / (rect.width || width)) * width,
      y: ((e.clientY - rect.top) / (rect.height || height)) * height,
    }
  }

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || drawingRef.current !== null) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    try { canvas.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    const { x, y } = getCoordinates(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    drawingRef.current = e.pointerId
  }

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingRef.current !== e.pointerId || disabled) return
    e.preventDefault()

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return

    const { x, y } = getCoordinates(e)
    ctx.lineTo(x, y)
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    inkRef.current = true
    setHasSignature(true)
  }

  // Up AND cancel (a call, a system gesture, the browser taking the touch) end the stroke, so it can never stay "down".
  const stopDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingRef.current !== e.pointerId) return
    drawingRef.current = null
    const canvas = canvasRef.current
    try { canvas?.releasePointerCapture(e.pointerId) } catch { /* already released */ }

    if (canvas && inkRef.current) {
      const dataUrl = exportPng(canvas, width, height)
      lastEmittedRef.current = dataUrl
      setDrawn(dataUrl)
      onChange?.(dataUrl)
    }
  }

  const clearSignature = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return

    drawingRef.current = null
    paint(ctx, canvas)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    inkRef.current = false
    setHasSignature(false)
    lastEmittedRef.current = null
    setDrawn('')
    onChange?.(null)
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={width * MAX_DPR}
          height={height * MAX_DPR}
          className={`border-2 border-dashed rounded-lg w-full touch-none ${
            disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white cursor-crosshair border-gray-300'
          }`}
          style={{ maxWidth: `${width}px`, aspectRatio: `${width} / ${height}` }}
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
        />
        {!hasSignature && !disabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-600 text-sm">Sign here</span>
          </div>
        )}
      </div>
      {name && (
        <>
          <input type="hidden" name={`${name}_type`} value="draw" />
          <input type="hidden" name={`${name}_data`} value={drawn} />
        </>
      )}
      {!disabled && (
        <button
          type="button"
          onClick={clearSignature}
          className="inline-flex min-h-[44px] items-center px-2 text-sm text-gray-800 hover:text-gray-900 underline"
        >
          Clear signature
        </button>
      )}
    </div>
  )
}
