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

export default function SignaturePad({
  onChange,
  value,
  name,
  disabled = false,
  width = 400,
  height = 150,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  // What a plain <form> posts when the pad is used with `name` (controlled callers read it from onChange instead).
  const [drawn, setDrawn] = useState<string>(value ?? '')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (value) {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0)
        setHasSignature(true)
      }
      img.src = value
    }
  }, [value])

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }

    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    if ('touches' in e) {
      const touch = e.touches[0]
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      }
    }

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return
    e.preventDefault()

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return

    const { x, y } = getCoordinates(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    setIsDrawing(true)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || disabled) return
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
    setHasSignature(true)
  }

  const stopDrawing = () => {
    if (!isDrawing) return
    setIsDrawing(false)

    const canvas = canvasRef.current
    if (canvas && hasSignature) {
      const dataUrl = canvas.toDataURL('image/png')
      setDrawn(dataUrl)
      onChange?.(dataUrl)
    }
  }

  const clearSignature = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
    setDrawn('')
    onChange?.(null)
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className={`border-2 border-dashed rounded-lg w-full touch-none ${
            disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white cursor-crosshair border-gray-300'
          }`}
          style={{ maxWidth: `${width}px` }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {!hasSignature && !disabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-400 text-sm">Sign here</span>
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
