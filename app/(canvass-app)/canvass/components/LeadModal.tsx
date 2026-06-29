'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { getInspectionSubmitCooldownRemainingMs } from '../lib/inspectionSubmitCooldown'
import type { CanvassPin } from '../page'
import { lookupPinStorm, type WeatherContext } from '../lib/weather-overlay'

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
  }) => void | Promise<void>
  onDelete?: (pinId: string) => void
  onClose: () => void
  users?: Array<{ id: string; full_name: string; has_calendar?: boolean }>
  teams?: Array<{ id: string; name: string }>
  inspectionDuration?: number
  isOnline?: boolean
  dispositions?: DispositionConfig[]
  weatherContext?: WeatherContext | null
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
  weatherContext = null,
}: Props) {
  const [stormExpanded, setStormExpanded] = useState(false)

  const pinLat = pin?.lat ?? location?.lat
  const pinLng = pin?.lng ?? location?.lng
  const stormSummary = useMemo(() => {
    if (!weatherContext || pinLat == null || pinLng == null) return null
    return lookupPinStorm(weatherContext.layer, weatherContext.features, pinLat, pinLng)
  }, [weatherContext, pinLat, pinLng])

  useEffect(() => {
    setStormExpanded(false)
  }, [pin?.id, location?.lat, location?.lng, weatherContext?.layer])
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
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    address_text: '',
    disposition: '',
    notes: '',
  })
  const [showComingSoon, setShowComingSoon] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  /** Synchronous guard — React state can lag one frame and allow double submit. */
  const submitLockRef = useRef(false)
  
  // Scheduling state
  const [showScheduling, setShowScheduling] = useState(false)
  const [selectedCloser, setSelectedCloser] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [slotsError, setSlotsError] = useState<string | null>(null)
  const [closerTimezone, setCloserTimezone] = useState('America/New_York')

  useEffect(() => {
    if (pin) {
      // Parse homeowner_name into first/last (split on first space)
      const full = (pin.homeowner_name || '').trim()
      const spaceIdx = full.indexOf(' ')
      const first_name = spaceIdx > 0 ? full.slice(0, spaceIdx) : full
      const last_name = spaceIdx > 0 ? full.slice(spaceIdx + 1) : ''
      setFormData({
        first_name,
        last_name,
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
      setSlotsError(null)
      loadTimeSlots(selectedCloser, selectedDate)
    } else {
      setTimeSlots([])
      setSlotsError(null)
    }
  }, [selectedCloser, selectedDate, isOnline])

  // Reset date when closer changes
  useEffect(() => {
    setSelectedDate('')
    setSelectedTime('')
    setTimeSlots([])
  }, [selectedCloser])

  const loadTimeSlots = async (closerOrTeamId: string, date: string, isRetry = false) => {
    setLoadingSlots(true)
    setSlotsError(null)
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
        const slots = data.slots || []
        setTimeSlots(slots)
        setCloserTimezone(data.timezone || 'America/New_York')
        if (slots.length === 0 && !isRetry && data.hasCalendar !== false) {
          // First attempt returned empty - retry once after short delay (fixes cold-start / auth race)
          await new Promise(r => setTimeout(r, 800))
          await loadTimeSlots(closerOrTeamId, date, true)
        }
      } else {
        const errData = await res.json().catch(() => ({}))
        const msg = errData.error || `Failed to load (${res.status})`
        setSlotsError(msg)
        setTimeSlots([])
      }
    } catch (error) {
      console.error('Failed to load time slots:', error)
      setSlotsError('Network error. Tap Refresh to retry.')
      setTimeSlots([])
    } finally {
      setLoadingSlots(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSaving || submitLockRef.current) return

    const homeowner_name = [formData.first_name.trim(), formData.last_name.trim()].filter(Boolean).join(' ').trim() || null
    const saveData: any = {
      homeowner_name: homeowner_name || '',
      phone: formData.phone,
      email: formData.email,
      address_text: formData.address_text,
      disposition: formData.disposition,
      notes: formData.notes,
    }

    if (showScheduling && selectedTime && selectedCloser) {
      const remaining = getInspectionSubmitCooldownRemainingMs()
      if (remaining > 0) {
        const secs = Math.max(1, Math.ceil(remaining / 1000))
        alert(
          `Please wait ${secs}s before scheduling another inspection (helps prevent duplicate bookings).`
        )
        return
      }
      saveData.schedule_inspection = true
      saveData.closer_user_id = selectedCloser
      saveData.inspection_scheduled_for = selectedTime
    }

    submitLockRef.current = true
    setIsSaving(true)
    try {
      await onSave(saveData)
    } finally {
      submitLockRef.current = false
      setIsSaving(false)
    }
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

  const hasRequiredName = !!(formData.first_name?.trim() && formData.last_name?.trim())
  const canSchedule = hasRequiredName && formData.phone?.trim() && formData.address_text?.trim()
  // Scheduling requires closer/team + time; otherwise allow drop pin without those fields
  const canSubmit =
    !showScheduling ||
    (canSchedule && Boolean(selectedCloser?.trim()) && Boolean(selectedTime?.trim()))

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
            {stormSummary && stormSummary.kind !== 'none' && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 overflow-hidden px-3 py-3 space-y-2">
                {/* Data headline — always visible, sized to read in sun */}
                <p className="text-base font-semibold text-[#2c2c2a] leading-snug">
                  {stormSummary.headline.replace(' ▸', '')}
                </p>
                {/* The line the rep actually says — shown by default, not a tap away */}
                {stormSummary.talkTrack && (
                  <p className="text-base text-[#2c2c2a] leading-snug">
                    “{stormSummary.talkTrack}”
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setStormExpanded((value) => !value)}
                  className="text-xs font-medium text-violet-700 underline"
                >
                  {stormExpanded ? 'Hide details' : 'Details'}
                </button>
                {stormExpanded && (
                  <div className="space-y-1 border-t border-violet-200 pt-2">
                    <p className="text-sm font-semibold text-[#2c2c2a]">
                      {stormSummary.expandedHeadline}
                    </p>
                    {stormSummary.dateLabel && stormSummary.kind === 'report' && (
                      <p className="text-xs text-[#2c2c2a]">Event date: {stormSummary.dateLabel}</p>
                    )}
                    {stormSummary.kind === 'warning' && stormSummary.expiresLabel && (
                      <p className="text-xs text-[#2c2c2a]">
                        Active warning until {stormSummary.expiresLabel}
                      </p>
                    )}
                    <p className="text-[11px] text-[#2c2c2a]">
                      This area may have been impacted — free inspection
                    </p>
                  </div>
                )}
              </div>
            )}
            {stormSummary && stormSummary.kind === 'none' && weatherContext && (
              <div className="px-3 py-3 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
                {/* No dot here ≠ no damage — still hand the rep a sayable, safe line */}
                {stormSummary.talkTrack && (
                  <p className="text-base text-[#2c2c2a] leading-snug">“{stormSummary.talkTrack}”</p>
                )}
                <p className="text-xs text-[#2c2c2a]">{stormSummary.emptyMessage}</p>
              </div>
            )}

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
                
                {showScheduling && (
                  <p className="text-sm text-gray-600 mt-2">
                    Pick the open slot first, then add the customer details before saving.
                  </p>
                )}
              </div>
            )}

            {/* Scheduling Section */}
            {showScheduling && (
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
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-900">
                        Time ({closerTimezone.replace('America/', '').replace('_', ' ')})
                      </label>
                      {!loadingSlots && selectedCloser && (
                        <button
                          type="button"
                          onClick={() => loadTimeSlots(selectedCloser, selectedDate)}
                          className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                        >
                          Refresh
                        </button>
                      )}
                    </div>
                    {loadingSlots ? (
                      <div className="flex items-center justify-center py-4">
                        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        <span className="ml-2 text-sm text-gray-500">Loading available times...</span>
                      </div>
                    ) : slotsError ? (
                      <div className="py-4 px-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-sm text-amber-800">{slotsError}</p>
                        <button
                          type="button"
                          onClick={() => loadTimeSlots(selectedCloser, selectedDate)}
                          className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          Tap to retry
                        </button>
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
                        No available time slots. Tap Refresh above to try again.
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
                      Time selected — add customer details below, then tap Schedule Inspection to save.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Contact Info */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  First Name {showScheduling && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  value={formData.first_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                  className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="John"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  Last Name {showScheduling && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  value={formData.last_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                  className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Smith"
                />
              </div>
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
          <div className="px-4 pt-4 pb-safe border-t bg-gray-50 space-y-3">
            <button
              type="submit"
              disabled={!canSubmit || isSaving}
              className={`w-full py-4 rounded-xl font-semibold text-lg ${
                !canSubmit || isSaving
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : showScheduling && selectedTime && selectedCloser
                  ? 'bg-green-600 text-white active:bg-green-700'
                  : 'bg-indigo-600 text-white active:bg-indigo-700'
              }`}
            >
              {isSaving
                ? 'Saving...'
                : showScheduling && selectedTime && selectedCloser
                ? 'Schedule Inspection'
                : showScheduling && canSchedule
                ? !selectedCloser
                  ? 'Select closer or team'
                  : !selectedTime
                  ? 'Select a time'
                  : 'Schedule Inspection'
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
