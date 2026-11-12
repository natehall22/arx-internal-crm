'use client'

import { useState, useEffect, useCallback } from 'react'

interface Position {
  lat: number
  lng: number
  accuracy: number
  heading: number | null
  speed: number | null
  timestamp: number
}

interface GeolocationState {
  position: Position | null
  error: string | null
  loading: boolean
  watching: boolean
}

export function useGeolocation(options?: PositionOptions) {
  const [state, setState] = useState<GeolocationState>({
    position: null,
    error: null,
    loading: true,
    watching: false,
  })

  const [watchId, setWatchId] = useState<number | null>(null)

  const defaultOptions: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0,
    ...options,
  }

  const handleSuccess = useCallback((pos: GeolocationPosition) => {
    setState({
      position: {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        heading: pos.coords.heading,
        speed: pos.coords.speed,
        timestamp: pos.timestamp,
      },
      error: null,
      loading: false,
      watching: true,
    })
  }, [])

  const handleError = useCallback((err: GeolocationPositionError) => {
    let errorMessage = 'Could not get your location. Check that Location is turned on for your phone, then try again.'

    switch (err.code) {
      case err.PERMISSION_DENIED:
        errorMessage =
          'Location is blocked. iPhone: Settings → Privacy & Security → Location Services → Safari Websites (or the Canvass app). ' +
          'Android: tap the lock icon next to the address → Permissions → Location → Allow.'
        break
      case err.POSITION_UNAVAILABLE:
        errorMessage =
          'No GPS signal. Make sure Location is turned on in your phone settings and step away from buildings or walls, then try again.'
        break
      case err.TIMEOUT:
        errorMessage = 'Finding your location is taking too long. Step outside or move to an open spot, then try again.'
        break
    }

    setState((prev) => {
      // A slow GPS fix is not a lost one: keep the last known position and say nothing.
      if (err.code === err.TIMEOUT && prev.position) {
        return { ...prev, loading: false }
      }
      return { ...prev, error: errorMessage, loading: false }
    })
  }, [])

  const requestPermission = useCallback(() => {
    if (!navigator.geolocation) {
      setState((prev) => ({
        ...prev,
        error: 'This phone or browser cannot share its location. Try Chrome (Android) or Safari (iPhone).',
        loading: false,
      }))
      return
    }

    setState((prev) => ({ ...prev, loading: true }))

    // Get initial position
    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, defaultOptions)

    // Start watching
    const id = navigator.geolocation.watchPosition(handleSuccess, handleError, defaultOptions)
    setWatchId(id)
  }, [handleSuccess, handleError])

  const stopWatching = useCallback(() => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      setWatchId(null)
      setState((prev) => ({ ...prev, watching: false }))
    }
  }, [watchId])

  useEffect(() => {
    // Auto-start watching on mount
    requestPermission()

    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId)
      }
    }
  }, [])

  return {
    ...state,
    requestPermission,
    stopWatching,
  }
}
