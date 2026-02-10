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
    timeout: 10000,
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
    let errorMessage = 'Unable to get location'
    
    switch (err.code) {
      case err.PERMISSION_DENIED:
        errorMessage = 'Location permission denied'
        break
      case err.POSITION_UNAVAILABLE:
        errorMessage = 'Location unavailable'
        break
      case err.TIMEOUT:
        errorMessage = 'Location request timed out'
        break
    }

    setState((prev) => ({
      ...prev,
      error: errorMessage,
      loading: false,
    }))
  }, [])

  const requestPermission = useCallback(() => {
    if (!navigator.geolocation) {
      setState((prev) => ({
        ...prev,
        error: 'Geolocation not supported',
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
