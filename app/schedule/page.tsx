'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { createClientBrowser } from '@/lib/supabase/client'

interface TimeSlot {
  time: string
  available: boolean
}

export default function SchedulePage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const rescheduleId = searchParams.get('reschedule')
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [originalAppointment, setOriginalAppointment] = useState<any>(null)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [selectedTime, setSelectedTime] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const supabase = createClientBrowser()

  useEffect(() => {
    if (rescheduleId) {
      loadAppointment()
    } else {
      setLoading(false)
    }
  }, [rescheduleId])

  const loadAppointment = async () => {
    try {
      const { data, error } = await supabase
        .from('scheduled_appointments')
        .select(`
          *,
          leads(homeowner_name, address_text)
        `)
        .eq('id', rescheduleId)
        .single()

      if (error) throw error
      setOriginalAppointment(data)
      
      // Set default date to tomorrow
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      setSelectedDate(tomorrow.toISOString().split('T')[0])
    } catch (err) {
      console.error('Error loading appointment:', err)
      setError('Failed to load appointment')
    } finally {
      setLoading(false)
    }
  }

  const handleReschedule = async () => {
    if (!selectedDate || !selectedTime) {
      setError('Please select a date and time')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const newScheduledFor = new Date(`${selectedDate}T${selectedTime}`)
      
      const res = await fetch('/api/inspections/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_appointment_id: rescheduleId,
          new_scheduled_for: newScheduledFor.toISOString(),
          notes,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to reschedule')
      }

      // Redirect back to dashboard
      router.push('/dashboard')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Generate time slots (8 AM - 8 PM)
  const timeSlots: TimeSlot[] = []
  for (let hour = 8; hour <= 20; hour++) {
    for (let min = 0; min < 60; min += 30) {
      // Don't add slots after 8:00 PM
      if (hour === 20 && min > 0) break
      const time = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
      timeSlots.push({ time, available: true })
    }
  }

  // Generate next 14 days
  const availableDates: string[] = []
  const today = new Date()
  for (let i = 1; i <= 14; i++) {
    const date = new Date(today)
    date.setDate(today.getDate() + i)
    availableDates.push(date.toISOString().split('T')[0])
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/2 mb-8"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {rescheduleId ? 'Reschedule Appointment' : 'Schedule Appointment'}
        </h1>
        
        {originalAppointment && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-amber-800">
              Rescheduling appointment for{' '}
              <span className="font-semibold">
                {originalAppointment.leads?.homeowner_name || 'Customer'}
              </span>
            </p>
            <p className="text-xs text-amber-600 mt-1">
              Original: {new Date(originalAppointment.scheduled_for).toLocaleString()}
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">
            {error}
          </div>
        )}

        {/* Date Selection */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Date</h2>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {availableDates.map((date) => {
              const d = new Date(date)
              const isSelected = selectedDate === date
              const dayName = d.toLocaleDateString([], { weekday: 'short' })
              const dayNum = d.getDate()
              const month = d.toLocaleDateString([], { month: 'short' })
              
              return (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`p-3 rounded-lg text-center transition-colors ${
                    isSelected
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-900'
                  }`}
                >
                  <p className={`text-xs ${isSelected ? 'text-indigo-200' : 'text-gray-500'}`}>
                    {dayName}
                  </p>
                  <p className="text-lg font-bold">{dayNum}</p>
                  <p className={`text-xs ${isSelected ? 'text-indigo-200' : 'text-gray-500'}`}>
                    {month}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Time Selection */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Time</h2>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {timeSlots.map((slot) => {
              const isSelected = selectedTime === slot.time
              const hour = parseInt(slot.time.split(':')[0])
              const isPM = hour >= 12
              const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour
              const displayTime = `${displayHour}:${slot.time.split(':')[1]} ${isPM ? 'PM' : 'AM'}`
              
              return (
                <button
                  key={slot.time}
                  onClick={() => setSelectedTime(slot.time)}
                  disabled={!slot.available}
                  className={`p-3 rounded-lg text-center transition-colors ${
                    isSelected
                      ? 'bg-indigo-600 text-white'
                      : slot.available
                      ? 'bg-gray-50 hover:bg-gray-100 text-gray-900'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  <p className="text-sm font-medium">{displayTime}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Notes (Optional)</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any notes about this appointment..."
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
          />
        </div>

        {/* Summary */}
        {selectedDate && selectedTime && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-indigo-800">
              <span className="font-semibold">New appointment:</span>{' '}
              {new Date(`${selectedDate}T${selectedTime}`).toLocaleString([], {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-4">
          <button
            onClick={() => router.back()}
            className="flex-1 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleReschedule}
            disabled={saving || !selectedDate || !selectedTime}
            className="flex-1 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : rescheduleId ? 'Reschedule' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
