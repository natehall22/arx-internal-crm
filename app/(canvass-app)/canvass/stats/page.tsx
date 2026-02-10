'use client'

import { useEffect, useState } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'
import Link from 'next/link'

interface DailyStats {
  date: string
  total_pins: number
  hot_leads: number
  go_backs: number
  not_home: number
  not_interested: number
  other: number
}

interface WeeklyStats {
  total_pins: number
  hot_leads: number
  conversion_rate: number
  avg_per_day: number
}

export default function CanvassStatsPage() {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<any>(null)
  const [todayStats, setTodayStats] = useState<DailyStats | null>(null)
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats | null>(null)
  const [recentDays, setRecentDays] = useState<DailyStats[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'week' | 'month'>('today')

  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    const supabase = createClientBrowser()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      window.location.href = '/login?redirect=/canvass/stats'
      return
    }

    const { data: profileData } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    setProfile(profileData)

    // Get today's date range
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Get week start
    const weekStart = new Date(today)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())

    // Fetch today's leads
    const { data: todayLeads } = await supabase
      .from('leads')
      .select('canvass_disposition')
      .eq('owner_user_id', user.id)
      .gte('created_at', today.toISOString())
      .lt('created_at', tomorrow.toISOString())
      .not('lat', 'is', null)

    if (todayLeads) {
      setTodayStats({
        date: today.toISOString(),
        total_pins: todayLeads.length,
        hot_leads: todayLeads.filter(l => l.canvass_disposition === 'hot_lead').length,
        go_backs: todayLeads.filter(l => l.canvass_disposition === 'go_back').length,
        not_home: todayLeads.filter(l => l.canvass_disposition === 'not_home').length,
        not_interested: todayLeads.filter(l => l.canvass_disposition === 'not_interested').length,
        other: todayLeads.filter(l => !['hot_lead', 'go_back', 'not_home', 'not_interested'].includes(l.canvass_disposition || '')).length,
      })
    }

    // Fetch week's leads
    const { data: weekLeads } = await supabase
      .from('leads')
      .select('canvass_disposition, created_at')
      .eq('owner_user_id', user.id)
      .gte('created_at', weekStart.toISOString())
      .not('lat', 'is', null)

    if (weekLeads) {
      const daysWithData = new Set(weekLeads.map(l => new Date(l.created_at).toDateString())).size
      setWeeklyStats({
        total_pins: weekLeads.length,
        hot_leads: weekLeads.filter(l => l.canvass_disposition === 'hot_lead').length,
        conversion_rate: weekLeads.length > 0 
          ? Math.round((weekLeads.filter(l => l.canvass_disposition === 'hot_lead').length / weekLeads.length) * 100)
          : 0,
        avg_per_day: daysWithData > 0 ? Math.round(weekLeads.length / daysWithData) : 0,
      })

      // Group by day for recent days
      const dayMap = new Map<string, DailyStats>()
      weekLeads.forEach(lead => {
        const dateStr = new Date(lead.created_at).toDateString()
        if (!dayMap.has(dateStr)) {
          dayMap.set(dateStr, {
            date: dateStr,
            total_pins: 0,
            hot_leads: 0,
            go_backs: 0,
            not_home: 0,
            not_interested: 0,
            other: 0,
          })
        }
        const day = dayMap.get(dateStr)!
        day.total_pins++
        if (lead.canvass_disposition === 'hot_lead') day.hot_leads++
        else if (lead.canvass_disposition === 'go_back') day.go_backs++
        else if (lead.canvass_disposition === 'not_home') day.not_home++
        else if (lead.canvass_disposition === 'not_interested') day.not_interested++
        else day.other++
      })

      setRecentDays(Array.from(dayMap.values()).sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      ))
    }

    setLoading(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-20">
      {/* Header */}
      <header className="bg-indigo-600 text-white px-4 py-4 safe-area-top">
        <div className="flex items-center gap-3">
          <Link href="/canvass" className="p-1 -ml-1">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="font-bold text-lg">Your Stats</h1>
            <p className="text-xs text-indigo-200">{profile?.full_name}</p>
          </div>
        </div>
      </header>

      {/* Period Selector */}
      <div className="px-4 py-3 bg-white border-b">
        <div className="flex gap-2">
          {(['today', 'week', 'month'] as const).map((period) => (
            <button
              key={period}
              onClick={() => setSelectedPeriod(period)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedPeriod === period
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {period.charAt(0).toUpperCase() + period.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="p-4 space-y-4">
        {/* Main Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-sm text-gray-500">Total Pins</p>
            <p className="text-3xl font-bold text-gray-900">
              {selectedPeriod === 'today' ? todayStats?.total_pins || 0 : weeklyStats?.total_pins || 0}
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-sm text-gray-500">Hot Leads</p>
            <p className="text-3xl font-bold text-red-600">
              {selectedPeriod === 'today' ? todayStats?.hot_leads || 0 : weeklyStats?.hot_leads || 0}
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-sm text-gray-500">Conversion Rate</p>
            <p className="text-3xl font-bold text-green-600">
              {weeklyStats?.conversion_rate || 0}%
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-sm text-gray-500">Avg/Day</p>
            <p className="text-3xl font-bold text-indigo-600">
              {weeklyStats?.avg_per_day || 0}
            </p>
          </div>
        </div>

        {/* Today's Breakdown */}
        {todayStats && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-3">Today's Breakdown</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-500"></span>
                  <span className="text-sm text-gray-600">Hot Leads</span>
                </div>
                <span className="font-semibold">{todayStats.hot_leads}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
                  <span className="text-sm text-gray-600">Go Backs</span>
                </div>
                <span className="font-semibold">{todayStats.go_backs}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-gray-400"></span>
                  <span className="text-sm text-gray-600">Not Home</span>
                </div>
                <span className="font-semibold">{todayStats.not_home}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-gray-500"></span>
                  <span className="text-sm text-gray-600">Not Interested</span>
                </div>
                <span className="font-semibold">{todayStats.not_interested}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-indigo-500"></span>
                  <span className="text-sm text-gray-600">Other</span>
                </div>
                <span className="font-semibold">{todayStats.other}</span>
              </div>
            </div>
          </div>
        )}

        {/* Recent Days */}
        {recentDays.length > 0 && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-3">Recent Days</h3>
            <div className="space-y-3">
              {recentDays.map((day) => (
                <div key={day.date} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-gray-900">
                      {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </p>
                    <p className="text-xs text-gray-500">
                      {day.hot_leads} hot leads
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-gray-900">{day.total_pins}</p>
                    <p className="text-xs text-gray-500">pins</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {(!todayStats || todayStats.total_pins === 0) && recentDays.length === 0 && (
          <div className="text-center py-12">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-gray-500">No canvassing data yet</p>
            <p className="text-sm text-gray-400 mt-1">Start dropping pins to see your stats</p>
            <Link
              href="/canvass"
              className="inline-block mt-4 px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium"
            >
              Start Canvassing
            </Link>
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t px-4 py-2 safe-area-bottom">
        <div className="flex items-center justify-around">
          <Link href="/canvass" className="flex flex-col items-center py-2 px-6 text-gray-500">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <span className="text-xs mt-1 font-medium">Map</span>
          </Link>
          <Link href="/canvass" className="flex flex-col items-center py-2 px-6 text-gray-500">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            <span className="text-xs mt-1 font-medium">List</span>
          </Link>
          <div className="flex flex-col items-center py-2 px-6 text-indigo-600 bg-indigo-50 rounded-xl">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="text-xs mt-1 font-medium">Stats</span>
          </div>
          <Link href="/canvass/settings" className="flex flex-col items-center py-2 px-6 text-gray-500">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs mt-1 font-medium">Settings</span>
          </Link>
        </div>
      </nav>
    </div>
  )
}
