'use client'

import { useState, useEffect, useRef } from 'react'
import type { CanvassPin } from '../page'

interface Props {
  pin: CanvassPin | null
  location: { lat: number; lng: number } | null
  onSave: (data: Partial<CanvassPin>) => void
  onClose: () => void
}

const dispositions = [
  { value: 'hot_lead', label: 'Hot Lead', color: 'bg-red-500', icon: '🔥' },
  { value: 'go_back', label: 'Go Back', color: 'bg-yellow-500', icon: '🔄' },
  { value: 'not_home', label: 'Not Home', color: 'bg-gray-400', icon: '🏠' },
  { value: 'not_interested', label: 'Not Interested', color: 'bg-gray-500', icon: '👎' },
  { value: 'bad_roof', label: 'Bad Roof', color: 'bg-stone-500', icon: '🏚️' },
  { value: 'renter', label: 'Renter', color: 'bg-zinc-400', icon: '🔑' },
]

export default function LeadModal({ pin, location, onSave, onClose }: Props) {
  const [formData, setFormData] = useState({
    homeowner_name: '',
    phone: '',
    email: '',
    address_text: '',
    disposition: '',
    notes: '',
  })
  const [showCamera, setShowCamera] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (pin) {
      setFormData({
        homeowner_name: pin.homeowner_name || '',
        phone: pin.phone || '',
        email: pin.email || '',
        address_text: pin.address_text || '',
        disposition: pin.disposition || '',
        notes: pin.notes || '',
      })
    }
  }, [pin])

  // Reverse geocode location to get address
  useEffect(() => {
    if (location && !pin && typeof google !== 'undefined') {
      const geocoder = new google.maps.Geocoder()
      geocoder.geocode({ location }, (results, status) => {
        if (status === 'OK' && results?.[0]) {
          setFormData(prev => ({
            ...prev,
            address_text: results[0].formatted_address,
          }))
        }
      })
    }
  }, [location, pin])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData)
  }

  const handleDispositionSelect = (value: string) => {
    setFormData(prev => ({ ...prev, disposition: value }))
  }

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setShowCamera(true)
    } catch (err) {
      console.error('Camera error:', err)
      alert('Unable to access camera')
    }
  }

  const capturePhoto = () => {
    if (!videoRef.current) return

    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(videoRef.current, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    setPhotos(prev => [...prev, dataUrl])
    stopCamera()
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setShowCamera(false)
  }

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center">
      <div className="bg-white w-full max-w-lg rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col animate-slide-up">
        {/* Header */}
        <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
          <h2 className="font-semibold text-lg">
            {pin ? 'Edit Pin' : 'New Pin'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Camera View */}
        {showCamera && (
          <div className="relative bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-64 object-cover"
            />
            <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
              <button
                onClick={stopCamera}
                className="w-12 h-12 bg-gray-600 text-white rounded-full"
              >
                <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <button
                onClick={capturePhoto}
                className="w-16 h-16 bg-white rounded-full border-4 border-gray-300"
              />
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Quick Disposition Buttons */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Disposition
              </label>
              <div className="grid grid-cols-3 gap-2">
                {dispositions.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => handleDispositionSelect(d.value)}
                    className={`p-3 rounded-xl border-2 text-center transition-all ${
                      formData.disposition === d.value
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-2xl block mb-1">{d.icon}</span>
                    <span className="text-xs font-medium">{d.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Contact Info */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Homeowner Name
              </label>
              <input
                type="text"
                value={formData.homeowner_name}
                onChange={(e) => setFormData(prev => ({ ...prev, homeowner_name: e.target.value }))}
                className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="John Smith"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="(555) 123-4567"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="john@email.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Address
              </label>
              <input
                type="text"
                value={formData.address_text}
                onChange={(e) => setFormData(prev => ({ ...prev, address_text: e.target.value }))}
                className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="123 Main St, City, ST 12345"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                rows={3}
                placeholder="Additional notes..."
              />
            </div>

            {/* Photos */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Photos
              </label>
              <div className="flex gap-2 flex-wrap">
                {photos.map((photo, index) => (
                  <div key={index} className="relative w-20 h-20">
                    <img
                      src={photo}
                      alt={`Photo ${index + 1}`}
                      className="w-full h-full object-cover rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(index)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {!showCamera && (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center text-gray-400 hover:border-gray-400 hover:text-gray-500"
                  >
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t bg-gray-50 safe-area-bottom">
            <button
              type="submit"
              className="w-full py-4 bg-indigo-600 text-white rounded-xl font-semibold text-lg active:bg-indigo-700"
            >
              {pin ? 'Update Pin' : 'Drop Pin'}
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        @keyframes slide-up {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </div>
  )
}
