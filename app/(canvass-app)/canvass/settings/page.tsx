'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function CanvassSettingsPage() {
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState({
    autoSync: true,
    highAccuracyGPS: true,
    showLegend: true,
    defaultDisposition: '',
    vibration: true,
  })

  useEffect(() => {
    loadProfile()
    loadSettings()
  }, [])

  const loadProfile = async () => {
    try {
      const response = await fetch('/api/canvass/data?usersOnly=true')
      
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = '/login?next=/canvass/settings'
          return
        }
        console.error('Failed to load profile:', response.status)
        setLoading(false)
        return
      }

      const data = await response.json()
      setProfile({
        id: data.currentUserId,
        full_name: data.currentUserName,
        role: data.currentUserRole,
        org_id: data.orgId,
      })
      setLoading(false)
    } catch (error) {
      console.error('Error loading profile:', error)
      setLoading(false)
    }
  }

  const loadSettings = () => {
    const saved = localStorage.getItem('canvass-settings')
    if (!saved) return
    try {
      const parsed = JSON.parse(saved) as Record<string, unknown>
      const hadLegacy = 'mapDataMode' in parsed
      delete parsed.mapDataMode
      setSettings((prev) => {
        const merged = { ...prev, ...parsed }
        if (hadLegacy) {
          localStorage.setItem('canvass-settings', JSON.stringify(merged))
        }
        return merged
      })
    } catch {
      // ignore
    }
  }

  const updateSetting = (key: string, value: any) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    localStorage.setItem('canvass-settings', JSON.stringify(newSettings))
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  const handleClearCache = async () => {
    if (confirm('Clear all cached data? This will remove offline pins.')) {
      localStorage.removeItem('canvass-offline-store')
      if ('caches' in window) {
        const cacheNames = await caches.keys()
        await Promise.all(cacheNames.map(name => caches.delete(name)))
      }
      alert('Cache cleared')
    }
  }

  const handleInstallPWA = async () => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      alert('App is already installed!')
      return
    }

    // Show install instructions
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    if (isIOS) {
      alert('To install:\n1. Tap the Share button\n2. Scroll down and tap "Add to Home Screen"')
    } else {
      alert('To install:\n1. Tap the menu (⋮) in your browser\n2. Tap "Install app" or "Add to Home Screen"')
    }
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
          <h1 className="font-bold text-lg">Settings</h1>
        </div>
      </header>

      <div className="p-4 space-y-4">
        {/* Profile Section */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center">
              <span className="text-2xl font-bold text-indigo-600">
                {profile?.full_name?.charAt(0) || 'U'}
              </span>
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">{profile?.full_name}</h2>
              <p className="text-sm text-gray-500">{profile?.email}</p>
              <p className="text-xs text-gray-400 capitalize">{profile?.role}</p>
            </div>
          </div>
        </div>

        {/* App Settings */}
        <div className="bg-white rounded-xl shadow-sm divide-y">
          <div className="p-4">
            <h3 className="font-semibold text-gray-900 mb-1">App Settings</h3>
            <p className="text-xs text-gray-500">Configure canvassing behavior</p>
          </div>

          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">Auto-sync when online</p>
              <p className="text-xs text-gray-500">Automatically sync pins when connected</p>
            </div>
            <button
              onClick={() => updateSetting('autoSync', !settings.autoSync)}
              className={`w-12 h-7 rounded-full transition-colors ${
                settings.autoSync ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span className={`block w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                settings.autoSync ? 'translate-x-6' : 'translate-x-1'
              }`}></span>
            </button>
          </div>

          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">High accuracy GPS</p>
              <p className="text-xs text-gray-500">Uses more battery but more precise</p>
            </div>
            <button
              onClick={() => updateSetting('highAccuracyGPS', !settings.highAccuracyGPS)}
              className={`w-12 h-7 rounded-full transition-colors ${
                settings.highAccuracyGPS ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span className={`block w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                settings.highAccuracyGPS ? 'translate-x-6' : 'translate-x-1'
              }`}></span>
            </button>
          </div>

          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">Show map legend</p>
              <p className="text-xs text-gray-500">Display pin color legend on map</p>
            </div>
            <button
              onClick={() => updateSetting('showLegend', !settings.showLegend)}
              className={`w-12 h-7 rounded-full transition-colors ${
                settings.showLegend ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span className={`block w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                settings.showLegend ? 'translate-x-6' : 'translate-x-1'
              }`}></span>
            </button>
          </div>

          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">Vibration feedback</p>
              <p className="text-xs text-gray-500">Vibrate when dropping pins</p>
            </div>
            <button
              onClick={() => updateSetting('vibration', !settings.vibration)}
              className={`w-12 h-7 rounded-full transition-colors ${
                settings.vibration ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span className={`block w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                settings.vibration ? 'translate-x-6' : 'translate-x-1'
              }`}></span>
            </button>
          </div>
        </div>

        {/* Map loading (viewport-only) */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h3 className="font-semibold text-gray-900 mb-1">Map loading</h3>
          <p className="text-xs text-gray-500 mb-2">Pins load as you pan and zoom (viewport mode).</p>
          <p className="text-xs text-indigo-600 bg-indigo-50 p-2 rounded">
            Suited for large territories: supports high pin counts with marker clustering. Offline-created pins still sync when you&apos;re back online.
          </p>
        </div>

        {/* Install & Data */}
        <div className="bg-white rounded-xl shadow-sm divide-y">
          <div className="p-4">
            <h3 className="font-semibold text-gray-900 mb-1">App & Data</h3>
          </div>

          <button
            onClick={handleInstallPWA}
            className="w-full p-4 flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <div>
                <p className="font-medium text-gray-900">Install App</p>
                <p className="text-xs text-gray-500">Add to home screen for quick access</p>
              </div>
            </div>
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button
            onClick={handleClearCache}
            className="w-full p-4 flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <div>
                <p className="font-medium text-gray-900">Clear Cache</p>
                <p className="text-xs text-gray-500">Remove offline data and cached files</p>
              </div>
            </div>
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* CRM Link */}
        <div className="bg-white rounded-xl shadow-sm">
          <a
            href="/"
            className="p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <div>
                <p className="font-medium text-gray-900">Open Full CRM</p>
                <p className="text-xs text-gray-500">Access the complete CRM dashboard</p>
              </div>
            </div>
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full bg-white rounded-xl p-4 shadow-sm text-red-600 font-medium text-center"
        >
          Sign Out
        </button>

        {/* Version */}
        <p className="text-center text-xs text-gray-400 pt-4">
          Canvass App v1.0.0
        </p>
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
                <clipPath id="sisuNavCutSettings">
                  <path d="M0 -2 L64 -2 L64 30.84 L0 36.44 Z M0 39.29 L64 33.69 L64 66 L0 66 Z" />
                </clipPath>
              </defs>
              <rect width="64" height="64" rx="14" fill="#0A0A0B" />
              <g fill="#D8FF3D" clipPath="url(#sisuNavCutSettings)">
                <path d="M29.93 51.17Q24.77 51.17 22.85 48.60Q20.93 46.04 21.72 40.43L22.24 36.75H29.69L29.02 41.46Q28.84 42.76 29.13 43.50Q29.42 44.24 30.41 44.24Q31.44 44.24 31.92 43.64Q32.40 43.04 32.59 41.67Q32.83 39.94 32.65 38.77Q32.47 37.61 31.78 36.55Q31.08 35.49 29.78 34.08L26.85 30.87Q23.57 27.29 24.22 22.69Q24.89 17.88 27.48 15.35Q30.07 12.83 34.31 12.83Q39.49 12.83 41.27 15.59Q43.06 18.35 42.26 23.98H34.60L34.97 21.39Q35.08 20.62 34.70 20.19Q34.32 19.76 33.57 19.76Q32.67 19.76 32.18 20.26Q31.70 20.77 31.58 21.56Q31.47 22.35 31.77 23.27Q32.07 24.19 33.16 25.39L36.92 29.56Q38.05 30.80 38.95 32.18Q39.85 33.56 40.25 35.39Q40.66 37.22 40.29 39.85Q39.54 45.16 37.16 48.16Q34.78 51.17 29.93 51.17Z" />
              </g>
            </svg>
            <span className="text-[11px] font-medium leading-tight">Sisu</span>
          </Link>
          <div
            aria-current="page"
            className="flex flex-1 basis-0 flex-col items-center gap-1 rounded-2xl py-2 text-indigo-600 bg-indigo-50 select-none"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-[11px] font-semibold leading-tight">Settings</span>
          </div>
        </div>
      </nav>
    </div>
  )
}
