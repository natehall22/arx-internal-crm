'use client'

import { useState, useEffect } from 'react'
import type { CanvassPin } from '../page'

// Disposition config from admin settings
interface DispositionConfig {
  id: string
  label: string
  color: string
  active?: boolean
}

interface Props {
  pin: CanvassPin | null
  location: { lat: number; lng: number } | null
  prefillAddress?: string
  onSave: (data: Partial<CanvassPin> & { 
    schedule_inspection?: boolean
    closer_user_id?: string
    inspection_scheduled_for?: string
  }) => void
  onDelete?: (pinId: string) => void
  onClose: () => void
  users?: Array<{ id: string; full_name: string; has_calendar?: boolean }>
  teams?: Array<{ id: string; name: string }>
  inspectionDuration?: number
  isOnline?: boolean
  dispositions?: DispositionConfig[]
}

// Default dispositions (fallback if no admin settings)
const defaultDispositions = [
  { id: 'hot_lead', label: 'Hot Lead', color: '#EF4444', icon: '🔥' },
  { id: 'go_back', label: 'Go Back', color: '#F59E0B', icon: '🔄' },
  { id: 'not_home', label: 'Not Home', color: '#9CA3AF', icon: '🏠' },
  { id: 'not_interested', label: 'Not Interested', color: '#6B7280', icon: '👎' },
  { id: 'bad_roof', label: 'Bad Roof', color: '#78716C', icon: '🏚️' },
  { id: 'renter', label: 'Renter', color: '#A1A1AA', icon: '🔑' },
]

// Icon mapping for dispositions
const dispositionIcons: Record<string, string> = {
  hot_lead: '🔥',
  go_back: '🔄',
  not_home: '🏠',
  not_interested: '👎',
  bad_roof: '🏚️',
  renter: '🔑',
  scheduled: '📅',
}

interface TimeSlot {
  time: string
  display: string
  available: boolean
}

export default function LeadModal({ 
  pin, 
  location, 
  prefillAddress, 
  onSave, 
  onDelete,
  onClose,
  users = [],
  teams = [],
  inspectionDuration = 60,
  isOnline = true,
  dispositions: dispositionsProp = [],
}: Props) {
  // Use admin dispositions if available, otherwise use defaults
  const dispositions = dispositionsProp.length > 0 
    ? dispositionsProp.filter(d => d.active !== false).map(d => ({
        value: d.id,
        label: d.label,
        color: d.color,
        icon: dispositionIcons[d.id] || '📍',
      }))
    : defaultDispositions.map(d => ({
        value: d.id,
        label: d.label,
        color: d.color,
        icon: d.icon,
      }))
  const [formData, setFormData] = useState({
    homeowner_name: '',
    phone: '',
    email: '',
    address_text: '',
    disposition: '',
    notes: '',
  })
  const [showComingSoon, setShowComingSoon] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  
  // Scheduling state
  const [showScheduling, setShowScheduling] = useState(false)
  const [selectedCloser, setSelectedCloser] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [closerTimezone, setCloserTimezone] = useState('America/New_York')

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

  useEffect(() => {
    if (pin) return
    
    if (prefillAddress) {
      setFormData(prev => ({
        ...prev,
        address_text: prefillAddress,
      }))
    } else if (location && typeof google !== 'undefined') {
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
  }, [location, pin, prefillAddress])

  // Load time slots when closer and date are selected
  useEffect(() => {
    if (selectedCloser && selectedDate && isOnline) {
      loadTimeSlots(selectedCloser, selectedDate)
    } else {
      setTimeSlots([])
    }
  }, [selectedCloser, selectedDate, isOnline])

  // Reset date when closer changes
  useEffect(() => {
    setSelectedDate('')
    setSelectedTime('')
    setTimeSlots([])
  }, [selectedCloser])

  const loadTimeSlots = async (closerOrTeamId: string, date: string) => {
    setLoadingSlots(true)
    try {
      let res: Response
      
      if (closerOrTeamId.startsWith('team:')) {
        const teamId = closerOrTeamId.replace('team:', '')
        res = await fetch(`/api/canvass/team-availability?team_id=${teamId}&date=${date}&duration=${inspectionDuration}`)
      } else {
        res = await fetch(`/api/canvass/availability?closer_id=${closerOrTeamId}&date=${date}&duration=${inspectionDuration}`)
      }
      
      if (res.ok) {
        const data = await res.json()
        setTimeSlots(data.slots || [])
        setCloserTimezone(data.timezone || 'America/New_York')
      }
    } catch (error) {
      console.error('Failed to load time slots:', error)
      setTimeSlots([])
    } finally {
      setLoadingSlots(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    const saveData: any = { ...formData }
    
    if (showScheduling && selectedTime) {
      saveData.schedule_inspection = true
      saveData.closer_user_id = selectedCloser
      saveData.inspection_scheduled_for = selectedTime
    }
    
    onSave(saveData)
  }

  const handleDispositionSelect = (value: string) => {
    setFormData(prev => ({ ...prev, disposition: value }))
    // Auto-show scheduling for hot leads
    if (value === 'hot_lead' && !showScheduling) {
      setShowScheduling(true)
    }
  }

  const handlePhotoClick = () => {
    setShowComingSoon(true)
    setTimeout(() => setShowComingSoon(false), 2000)
  }

  const handleDelete = async () => {
    if (!pin?.id || !onDelete) return
    setIsDeleting(true)
    try {
      await onDelete(pin.id)
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  // Generate next 7 days for date selection
  const getDateOptions = () => {
    const formatLocalYmd = (date: Date) => {
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }

    const dates = []
    const today = new Date()
    for (let i = 0; i < 7; i++) {
      const date = new Date(today)
      date.setDate(today.getDate() + i)
      dates.push({
        // Use local date components, not UTC ISO conversion, to avoid day-shift near midnight.
        value: formatLocalYmd(date),
        label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      })
    }
    return dates
  }

  const canSchedule = formData.homeowner_name && formData.phone && formData.address_text

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

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Show previous knock info when editing an existing pin */}
            {pin && pin.created_at && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="flex items-start gap-2">
                  <span className="text-blue-600 mt-0.5">🚪</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-blue-700 uppercase tracking-wide mb-1">Last Knock</p>
                    <p className="text-sm text-blue-900">
                      {new Date(pin.updated_at || pin.created_at).toLocaleDateString('en-US', { 
                        weekday: 'short',
                        month: 'short', 
                        day: 'numeric',
                        year: 'numeric'
                      })} at {new Date(pin.updated_at || pin.created_at).toLocaleTimeString('en-US', { 
                        hour: 'numeric', 
                        minute: '2-digit',
                        hour12: true 
                      })}
                    </p>
                    {pin.owner_name && (
                      <p className="text-sm text-blue-700 mt-1">
                        <span className="font-medium">Setter:</span> {pin.owner_name}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Show existing notes prominently when editing */}
            {pin && pin.notes && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="flex items-start gap-2">
                  <span className="text-amber-600 mt-0.5">📝</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-1">Previous Notes</p>
                    <p className="text-sm text-amber-900 whitespace-pre-wrap">{pin.notes}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Disposition Buttons */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Disposition
              </label>
              <div className="grid grid-cols-3 gap-2">
                {dispositions.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => handleDispositionSelect(d.value)}
                    className={`p-3 rounded-xl border-2 text-center transition-all relative ${
                      formData.disposition === d.value
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span 
                      className="absolute top-2 right-2 w-3 h-3 rounded-full"
                      style={{ backgroundColor: d.color }}
                    ></span>
                    <span className="text-2xl block mb-1">{d.icon}</span>
                    <span className="text-xs font-medium text-gray-900">{d.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Contact Info */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">
                Homeowner Name {showScheduling && <span className="text-red-500">*</span>}
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
              <label className="block text-sm font-medium text-gray-900 mb-1">
                Phone {showScheduling && <span className="text-red-500">*</span>}
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
              <label className="block text-sm font-medium text-gray-900 mb-1">
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
              <label className="block text-sm font-medium text-gray-900 mb-1">
                Address {showScheduling && <span className="text-red-500">*</span>}
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
              <label className="block text-sm font-medium text-gray-900 mb-1">
                Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                rows={2}
                placeholder="Additional notes..."
              />
            </div>

            {/* Schedule Inspection Toggle */}
            {isOnline && (users.length > 0 || teams.length > 0) && (
              <div className="border-t pt-4">
                <button
                  type="button"
                  onClick={() => setShowScheduling(!showScheduling)}
                  className={`w-full py-3 px-4 rounded-xl border-2 flex items-center justify-between ${
                    showScheduling ? 'border-green-500 bg-green-50' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">📅</span>
                    <span className="font-medium text-gray-900">Schedule Inspection</span>
                  </div>
                  <div className={`w-12 h-7 rounded-full transition-colors ${showScheduling ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <div className={`w-5 h-5 bg-white rounded-full mt-1 transition-transform ${showScheduling ? 'translate-x-6' : 'translate-x-1'}`} />
                  </div>
                </button>
                
                {!canSchedule && showScheduling && (
                  <p className="text-sm text-amber-600 mt-2">
                    Name, phone, and address are required to schedule an inspection.
                  </p>
                )}
              </div>
            )}

            {/* Scheduling Section */}
            {showScheduling && canSchedule && (
              <div className="space-y-4 bg-gray-50 -mx-4 px-4 py-4">
                {/* Closer Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Assign To
                  </label>
                  <select
                    value={selectedCloser}
                    onChange={(e) => setSelectedCloser(e.target.value)}
                    className="w-full px-4 py-3 border rounded-xl bg-white text-gray-900 focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select closer or team...</option>
                    {teams.length > 0 && (
                      <optgroup label="Teams (Round-Robin)">
                        {teams.map(team => (
                          <option key={`team:${team.id}`} value={`team:${team.id}`}>
                            {team.name} (Auto-assign)
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {users.length > 0 && (
                      <optgroup label="Individual Closers">
                        {users.map(user => (
                          <option key={user.id} value={user.id}>
                            {user.full_name} {user.has_calendar ? '✓' : '(no calendar)'}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                {/* Date Selection */}
                {selectedCloser && (
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Date
                    </label>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {getDateOptions().map(date => (
                        <button
                          key={date.value}
                          type="button"
                          onClick={() => setSelectedDate(date.value)}
                          className={`flex-shrink-0 px-4 py-2 rounded-lg border text-sm font-medium ${
                            selectedDate === date.value
                              ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                              : 'border-gray-200 bg-white text-gray-900'
                          }`}
                        >
                          {date.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Time Slots */}
                {selectedDate && (
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Time ({closerTimezone.replace('America/', '').replace('_', ' ')})
                    </label>
                    {loadingSlots ? (
                      <div className="flex items-center justify-center py-4">
                        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        <span className="ml-2 text-sm text-gray-500">Loading available times...</span>
                      </div>
                    ) : timeSlots.length > 0 ? (
                      <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                        {timeSlots.map(slot => (
                          <button
                            key={slot.time}
                            type="button"
                            disabled={!slot.available}
                            onClick={() => setSelectedTime(slot.time)}
                            className={`px-3 py-2 rounded-lg text-sm font-medium ${
                              selectedTime === slot.time
                                ? 'bg-indigo-600 text-white'
                                : slot.available
                                ? 'bg-white border border-gray-200 text-gray-900 hover:border-indigo-300'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                          >
                            {slot.display}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 text-center py-4">
                        No available time slots for this date
                      </p>
                    )}
                    <p className="mt-2 text-xs text-gray-500">
                      Buffer times are editable in <strong>Settings → Calendar</strong> (personal) or
                      <strong> Admin → Teams → Closer Queue</strong> (team round-robin).
                    </p>
                  </div>
                )}

                {selectedTime && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-green-800">
                      Inspection will be scheduled and synced to calendar
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Photos */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Photos
              </label>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handlePhotoClick}
                  className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center text-gray-400 hover:border-gray-400 hover:text-gray-500 relative"
                >
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </div>
              
              {/* Coming Soon Toast */}
              {showComingSoon && (
                <div className="mt-2 bg-indigo-100 text-indigo-800 text-sm px-3 py-2 rounded-lg animate-pulse">
                  Photo uploads coming soon!
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t bg-gray-50 safe-area-bottom space-y-3">
            <button
              type="submit"
              disabled={showScheduling && canSchedule && !selectedTime ? true : false}
              className={`w-full py-4 rounded-xl font-semibold text-lg ${
                showScheduling && canSchedule && !selectedTime
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : showScheduling && selectedTime
                  ? 'bg-green-600 text-white active:bg-green-700'
                  : 'bg-indigo-600 text-white active:bg-indigo-700'
              }`}
            >
              {showScheduling && selectedTime
                ? 'Schedule Inspection'
                : showScheduling && canSchedule
                ? 'Select a Time'
                : pin
                ? 'Update Pin'
                : 'Drop Pin'}
            </button>
            
            {/* Delete button - only show for existing pins */}
            {pin && onDelete && !showDeleteConfirm && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full py-3 rounded-xl font-medium text-red-600 border border-red-200 bg-red-50 active:bg-red-100"
              >
                Delete Pin
              </button>
            )}
            
            {/* Delete confirmation */}
            {showDeleteConfirm && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm text-red-800 mb-3">Are you sure you want to delete this pin? This cannot be undone.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-2 rounded-lg font-medium text-gray-700 bg-white border border-gray-300 active:bg-gray-100"
                    disabled={isDeleting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="flex-1 py-2 rounded-lg font-medium text-white bg-red-600 active:bg-red-700 disabled:bg-red-400"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            )}
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
