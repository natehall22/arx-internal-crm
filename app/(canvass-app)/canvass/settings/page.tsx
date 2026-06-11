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
          <Link href="/sisu" className="flex flex-col items-center py-2 px-6 text-gray-500">
            {/* Sisu flame mark (see public/brand/sisu-mark.svg) */}
            <svg className="w-6 h-6" viewBox="0 0 64 64" fill="none">
              <defs>
                <linearGradient id="sisuNavFlameSettings" x1="32" y1="3" x2="32" y2="61" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#818cf8" />
                  <stop offset="0.55" stopColor="#6366f1" />
                  <stop offset="1" stopColor="#7c3aed" />
                </linearGradient>
                <linearGradient id="sisuNavCoreSettings" x1="32" y1="22" x2="32" y2="54" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#fde68a" />
                  <stop offset="0.5" stopColor="#fbbf24" />
                  <stop offset="1" stopColor="#f59e0b" />
                </linearGradient>
              </defs>
              <path
                d="M32 3 C33.5 13 44 17 47 26 C50 34.5 48 44.5 42 51.5 C39 55 35.5 58.5 32 61 C28.5 58.5 25 55 22 51.5 C16 44.5 14 34.5 17 26 C20 17 30.5 13 32 3 Z"
                fill="url(#sisuNavFlameSettings)"
              />
              <path
                d="M32 23 C33 29.5 39.5 32.5 40.5 39 C41.5 45 38 50.5 32 54 C26 50.5 22.5 45 23.5 39 C24.5 32.5 31 29.5 32 23 Z"
                fill="url(#sisuNavCoreSettings)"
              />
              <circle cx="45.5" cy="11.5" r="2.5" fill="#fbbf24" />
            </svg>
            <span className="text-xs mt-1 font-medium">Sisu</span>
          </Link>
          <div className="flex flex-col items-center py-2 px-6 text-indigo-600 bg-indigo-50 rounded-xl">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs mt-1 font-medium">Settings</span>
          </div>
        </div>
      </nav>
    </div>
  )
}
