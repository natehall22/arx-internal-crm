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
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-gray-200 px-3 pt-1.5 pb-1.5 safe-area-bottom shadow-[0_-6px_20px_rgba(15,15,20,0.06)]">
        <div className="flex items-stretch gap-1 max-w-lg mx-auto">
          <Link
            href="/canvass"
            className="flex flex-1 basis-0 flex-col items-center gap-1 rounded-2xl py-2 text-gray-500 transition-all duration-150 hover:text-indigo-600 active:scale-[0.96] select-none"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <span className="text-[11px] font-medium leading-tight">Map</span>
          </Link>
          <Link
            href="/sisu"
            className="flex flex-1 basis-0 flex-col items-center gap-1 rounded-2xl py-2 text-gray-500 transition-all duration-150 hover:text-indigo-600 active:scale-[0.96] select-none"
          >
            {/* Sisu cut-S mark (see public/brand/sisu-mark.svg) */}
            <svg className="w-6 h-6" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <defs>
                <clipPath id="sisuNavCutStats">
                  <path d="M0 -2 L64 -2 L64 30.84 L0 36.44 Z M0 39.29 L64 33.69 L64 66 L0 66 Z" />
                </clipPath>
              </defs>
              <rect width="64" height="64" rx="14" fill="#0A0A0B" />
              <g fill="#D8FF3D" clipPath="url(#sisuNavCutStats)">
                <path d="M29.93 51.17Q24.77 51.17 22.85 48.60Q20.93 46.04 21.72 40.43L22.24 36.75H29.69L29.02 41.46Q28.84 42.76 29.13 43.50Q29.42 44.24 30.41 44.24Q31.44 44.24 31.92 43.64Q32.40 43.04 32.59 41.67Q32.83 39.94 32.65 38.77Q32.47 37.61 31.78 36.55Q31.08 35.49 29.78 34.08L26.85 30.87Q23.57 27.29 24.22 22.69Q24.89 17.88 27.48 15.35Q30.07 12.83 34.31 12.83Q39.49 12.83 41.27 15.59Q43.06 18.35 42.26 23.98H34.60L34.97 21.39Q35.08 20.62 34.70 20.19Q34.32 19.76 33.57 19.76Q32.67 19.76 32.18 20.26Q31.70 20.77 31.58 21.56Q31.47 22.35 31.77 23.27Q32.07 24.19 33.16 25.39L36.92 29.56Q38.05 30.80 38.95 32.18Q39.85 33.56 40.25 35.39Q40.66 37.22 40.29 39.85Q39.54 45.16 37.16 48.16Q34.78 51.17 29.93 51.17Z" />
              </g>
            </svg>
            <span className="text-[11px] font-medium leading-tight">Sisu</span>
          </Link>
          <Link
            href="/canvass/settings"
            className="flex flex-1 basis-0 flex-col items-center gap-1 rounded-2xl py-2 text-gray-500 transition-all duration-150 hover:text-indigo-600 active:scale-[0.96] select-none"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-[11px] font-medium leading-tight">Settings</span>
          </Link>
        </div>
      </nav>
    </div>
  )
}
