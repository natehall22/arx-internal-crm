'use client'

import { useRef, useState, useEffect } from 'react'

interface SignaturePadInlineProps {
  onSave: (data: { type: 'typed' | 'draw'; typed?: string; drawn?: string; name: string }) => void
  onCancel: () => void
  title: string
  description?: string
  defaultName?: string
  saving?: boolean
}

export default function SignaturePadInline({ 
  onSave, 
  onCancel, 
  title, 
  description,
  defaultName = '',
  saving = false 
}: SignaturePadInlineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [mode, setMode] = useState<'typed' | 'draw'>('typed')
  const [typedValue, setTypedValue] = useState('')
  const [signedName, setSignedName] = useState(defaultName)
  const [signatureData, setSignatureData] = useState('')
  const [isDrawing, setIsDrawing] = useState(false)

  useEffect(() => {
    if (mode === 'draw' && canvasRef.current) {
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
    }
  }, [mode])

  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'draw') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = '#1f2937'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    ctx.moveTo((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY)
    setIsDrawing(true)
  }

  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || mode !== 'draw') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    ctx.lineTo((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY)
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
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setSignatureData('')
  }

  const handleSave = () => {
    if (!signedName.trim()) {
      alert('Please enter your name')
      return
    }
    if (mode === 'typed' && !typedValue.trim()) {
      alert('Please type your signature')
      return
    }
    if (mode === 'draw' && !signatureData) {
      alert('Please draw your signature')
      return
    }

    onSave({
      type: mode,
      typed: mode === 'typed' ? typedValue : undefined,
      drawn: mode === 'draw' ? signatureData : undefined,
      name: signedName,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
      </div>

      {/* Name Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Full Legal Name</label>
        <input
          type="text"
          value={signedName}
          onChange={(e) => setSignedName(e.target.value)}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500"
          placeholder="Enter your full name"
        />
      </div>

      {/* Mode Toggle */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Signature Method</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('typed')}
            className={`flex-1 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              mode === 'typed'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Type Signature
          </button>
          <button
            type="button"
            onClick={() => setMode('draw')}
            className={`flex-1 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              mode === 'draw'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Draw Signature
          </button>
        </div>
      </div>

      {/* Signature Input */}
      {mode === 'typed' ? (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Type Your Signature</label>
          <input
            type="text"
            value={typedValue}
            onChange={(e) => setTypedValue(e.target.value)}
            className="w-full px-4 py-4 border border-gray-300 rounded-lg text-2xl text-gray-900 focus:ring-2 focus:ring-indigo-500"
            style={{ fontFamily: 'cursive, serif' }}
            placeholder="Type your signature"
          />
          {typedValue && (
            <div className="mt-3 p-4 bg-gray-50 rounded-lg border">
              <p className="text-xs text-gray-500 mb-1">Preview:</p>
              <p className="text-3xl text-gray-900" style={{ fontFamily: 'cursive, serif' }}>
                {typedValue}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Draw Your Signature</label>
          <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-white">
            <canvas
              ref={canvasRef}
              width={600}
              height={200}
              className="w-full touch-none cursor-crosshair"
              style={{ height: '150px' }}
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={endDrawing}
              onPointerLeave={endDrawing}
            />
          </div>
          <div className="flex justify-between items-center mt-2">
            <p className="text-xs text-gray-500">Use your mouse or finger to sign above</p>
            <button
              type="button"
              onClick={clearCanvas}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Legal Agreement */}
      <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
        <p className="text-sm text-amber-800">
          By signing, I acknowledge that I have reviewed this proposal and agree to the terms, 
          scope of work, and pricing outlined above. This electronic signature is legally binding.
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 px-4 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Sign & Confirm'}
        </button>
      </div>
    </div>
  )
}
