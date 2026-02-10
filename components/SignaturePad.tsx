'use client'

import { useRef, useState } from 'react'

type SignaturePadProps = {
  name: string
  label: string
  defaultTyped?: string
}

export default function SignaturePad({ name, label, defaultTyped }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [mode, setMode] = useState<'typed' | 'draw'>('typed')
  const [typedValue, setTypedValue] = useState(defaultTyped ?? '')
  const [signatureData, setSignatureData] = useState('')
  const [isDrawing, setIsDrawing] = useState(false)

  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'draw') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.beginPath()
    const rect = canvas.getBoundingClientRect()
    ctx.moveTo(event.clientX - rect.left, event.clientY - rect.top)
    setIsDrawing(true)
  }

  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || mode !== 'draw') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.lineTo(event.clientX - rect.left, event.clientY - rect.top)
    ctx.stroke()
  }

  const endDrawing = () => {
    if (!isDrawing || mode !== 'draw') return
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')
    setSignatureData(dataUrl)
    setIsDrawing(false)
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setSignatureData('')
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-200">{label}</label>
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setMode('typed')}
          className={`rounded-md px-2 py-1 ${
            mode === 'typed' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          Type
        </button>
        <button
          type="button"
          onClick={() => setMode('draw')}
          className={`rounded-md px-2 py-1 ${
            mode === 'draw' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          Draw
        </button>
      </div>

      {mode === 'typed' ? (
        <input
          value={typedValue}
          onChange={(event) => setTypedValue(event.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          placeholder="Type your name"
          required
        />
      ) : (
        <div className="space-y-2">
          <canvas
            ref={canvasRef}
            width={520}
            height={160}
            className="w-full rounded-md border border-slate-700 bg-white"
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={endDrawing}
            onPointerLeave={endDrawing}
          />
          <button
            type="button"
            onClick={clearCanvas}
            className="text-xs text-slate-300 hover:text-white"
          >
            Clear signature
          </button>
        </div>
      )}

      <input type="hidden" name={`${name}_type`} value={mode} />
      <input type="hidden" name={`${name}_data`} value={mode === 'draw' ? signatureData : ''} />
      <input type="hidden" name={`${name}_typed`} value={mode === 'typed' ? typedValue : ''} />
    </div>
  )
}
