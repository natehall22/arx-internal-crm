'use client'

import { useEffect } from 'react'

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      // Canvass registers its own SW; dual registration lets sw.js cache stale chunks
      if (window.location.pathname.startsWith('/canvass')) {
        return
      }

      const registerServiceWorker = async () => {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js')
          console.log('Service Worker registered with scope:', registration.scope)
          
          // Handle updates properly
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('New service worker available, refresh to update')
                }
              })
            }
          })
          
          // Check for updates periodically, but handle errors gracefully
          const updateInterval = setInterval(async () => {
            try {
              // Only update if not already updating
              if (registration.installing === null && registration.waiting === null) {
                await registration.update()
              }
            } catch (error) {
              // Ignore InvalidStateError - happens when update is already in progress
              if (error instanceof Error && error.name !== 'InvalidStateError') {
                console.error('Service Worker update check failed:', error)
              }
            }
          }, 60 * 60 * 1000) // Check every hour
          
          // Cleanup interval on unmount
          return () => clearInterval(updateInterval)
        } catch (error) {
          // Handle registration errors gracefully
          if (error instanceof Error) {
            if (error.name === 'InvalidStateError') {
              console.log('Service Worker registration skipped - already updating')
            } else {
              console.error('Service Worker registration failed:', error)
            }
          }
        }
      }

      registerServiceWorker()

      // Listen for messages from service worker
      const messageHandler = (event: MessageEvent) => {
        if (event.data && event.data.type === 'SYNC_PINS') {
          window.dispatchEvent(new CustomEvent('sw-sync-pins'))
        }
      }
      
      navigator.serviceWorker.addEventListener('message', messageHandler)
      
      return () => {
        navigator.serviceWorker.removeEventListener('message', messageHandler)
      }
    }
  }, [])

  return null
}
