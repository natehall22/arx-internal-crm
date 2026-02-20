'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface SatelliteImageEditorProps {
  address: string
  apiKey: string
  onSave: (imageBlob: Blob) => Promise<void>
  onCancel: () => void
  initialImageUrl?: string
}

export default function SatelliteImageEditor({
  address,
  apiKey,
  onSave,
  onCancel,
  initialImageUrl,
}: SatelliteImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  
  const [zoom, setZoom] = useState(19) // Google Maps zoom level (1-21)
  const [centerLat, setCenterLat] = useState<number | null>(null)
  const [centerLng, setCenterLng] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  
  const imageRef = useRef<HTMLImageElement | null>(null)
  const offsetRef = useRef({ x: 0, y: 0 })

  // Geocode address to get lat/lng
  useEffect(() => {
    const geocodeAddress = async () => {
      if (!address || !apiKey) {
        setError('Missing address or API key')
        setLoading(false)
        return
      }

      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
        )
        const data = await response.json()
        
        if (data.status === 'OK' && data.results[0]) {
          const { lat, lng } = data.results[0].geometry.location
          setCenterLat(lat)
          setCenterLng(lng)
          setError(null)
        } else {
          setError('Could not find location for this address')
        }
      } catch (err) {
        setError('Failed to geocode address')
        console.error('Geocoding error:', err)
      }
      setLoading(false)
    }

    geocodeAddress()
  }, [address, apiKey])

  // Load satellite image when center or zoom changes
  useEffect(() => {
    if (centerLat === null || centerLng === null || !apiKey) return

    setImageLoaded(false)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    // Request a larger image for better quality when panning
    const imageUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${centerLat},${centerLng}&zoom=${zoom}&size=800x600&maptype=satellite&scale=2&key=${apiKey}`
    
    img.onload = () => {
      imageRef.current = img
      setImageLoaded(true)
      offsetRef.current = { x: 0, y: 0 }
      drawImage()
    }
    
    img.onerror = () => {
      setError('Failed to load satellite image')
    }
    
    img.src = imageUrl
  }, [centerLat, centerLng, zoom, apiKey])

  // Draw image on canvas
  const drawImage = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const img = imageRef.current
    
    if (!canvas || !ctx || !img) return

    // Clear canvas
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    
    // Calculate draw position with offset
    const drawX = (canvas.width - img.width) / 2 + offsetRef.current.x
    const drawY = (canvas.height - img.height) / 2 + offsetRef.current.y
    
    ctx.drawImage(img, drawX, drawY)
    
    // Draw crop guide overlay
    const cropWidth = 600
    const cropHeight = 300
    const cropX = (canvas.width - cropWidth) / 2
    const cropY = (canvas.height - cropHeight) / 2
    
    // Darken areas outside crop zone
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillRect(0, 0, canvas.width, cropY) // Top
    ctx.fillRect(0, cropY + cropHeight, canvas.width, canvas.height - cropY - cropHeight) // Bottom
    ctx.fillRect(0, cropY, cropX, cropHeight) // Left
    ctx.fillRect(cropX + cropWidth, cropY, canvas.width - cropX - cropWidth, cropHeight) // Right
    
    // Draw crop border
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.strokeRect(cropX, cropY, cropWidth, cropHeight)
    ctx.setLineDash([])
  }, [])

  // Redraw when image loads
  useEffect(() => {
    if (imageLoaded) {
      drawImage()
    }
  }, [imageLoaded, drawImage])

  // Mouse/touch handlers for panning
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX, y: e.clientY })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    
    const dx = e.clientX - dragStart.x
    const dy = e.clientY - dragStart.y
    
    offsetRef.current = {
      x: offsetRef.current.x + dx,
      y: offsetRef.current.y + dy,
    }
    
    setDragStart({ x: e.clientX, y: e.clientY })
    drawImage()
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true)
      setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY })
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return
    
    const dx = e.touches[0].clientX - dragStart.x
    const dy = e.touches[0].clientY - dragStart.y
    
    offsetRef.current = {
      x: offsetRef.current.x + dx,
      y: offsetRef.current.y + dy,
    }
    
    setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY })
    drawImage()
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
  }

  // Zoom controls
  const handleZoomIn = () => {
    if (zoom < 21) {
      setZoom(z => z + 1)
    }
  }

  const handleZoomOut = () => {
    if (zoom > 15) {
      setZoom(z => z - 1)
    }
  }

  // Reset position
  const handleReset = () => {
    offsetRef.current = { x: 0, y: 0 }
    setZoom(19)
    drawImage()
  }

  // Save cropped image
  const handleSave = async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    setSaving(true)
    
    try {
      // Create a new canvas for the cropped area
      const cropCanvas = document.createElement('canvas')
      const cropWidth = 600
      const cropHeight = 300
      cropCanvas.width = cropWidth
      cropCanvas.height = cropHeight
      
      const cropCtx = cropCanvas.getContext('2d')
      if (!cropCtx) throw new Error('Could not get canvas context')
      
      // Calculate crop area from main canvas
      const cropX = (canvas.width - cropWidth) / 2
      const cropY = (canvas.height - cropHeight) / 2
      
      // Draw the cropped portion
      cropCtx.drawImage(
        canvas,
        cropX, cropY, cropWidth, cropHeight,
        0, 0, cropWidth, cropHeight
      )
      
      // Convert to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        cropCanvas.toBlob(
          (b) => {
            if (b) resolve(b)
            else reject(new Error('Failed to create image blob'))
          },
          'image/jpeg',
          0.9
        )
      })
      
      await onSave(blob)
    } catch (err) {
      console.error('Error saving image:', err)
      setError('Failed to save image')
    }
    
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4" />
        <p className="text-gray-600">Loading satellite view...</p>
      </div>
    )
  }

  if (error && !imageLoaded) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <svg className="w-12 h-12 text-red-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="text-red-600 font-medium mb-2">{error}</p>
        <button
          onClick={onCancel}
          className="text-gray-600 hover:text-gray-800"
        >
          Go back
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
        <p className="text-sm text-blue-800">
          <strong>Drag</strong> to pan the image and position the correct building in the frame. 
          Use <strong>zoom</strong> controls to adjust the view. The area inside the dashed box will be saved.
        </p>
      </div>

      {/* Canvas container */}
      <div 
        ref={containerRef}
        className="relative bg-slate-900 rounded-lg overflow-hidden"
        style={{ height: '400px' }}
      >
        <canvas
          ref={canvasRef}
          width={800}
          height={400}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
        
        {/* Loading overlay */}
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
          </div>
        )}

        {/* Zoom controls */}
        <div className="absolute top-3 right-3 flex flex-col gap-1">
          <button
            onClick={handleZoomIn}
            disabled={zoom >= 21}
            className="w-10 h-10 bg-white rounded-lg shadow-lg flex items-center justify-center text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Zoom in"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </button>
          <button
            onClick={handleZoomOut}
            disabled={zoom <= 15}
            className="w-10 h-10 bg-white rounded-lg shadow-lg flex items-center justify-center text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Zoom out"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <button
            onClick={handleReset}
            className="w-10 h-10 bg-white rounded-lg shadow-lg flex items-center justify-center text-gray-700 hover:bg-gray-100"
            title="Reset view"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Zoom level indicator */}
        <div className="absolute bottom-3 left-3 px-3 py-1.5 bg-black/60 rounded-lg text-white text-sm">
          Zoom: {zoom}x
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex justify-end gap-3 mt-4">
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !imageLoaded}
          className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              Saving...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Save Image
            </>
          )}
        </button>
      </div>
    </div>
  )
}
