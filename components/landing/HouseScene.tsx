'use client'

import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import type { StoryProgress } from './house-scene-three'

/**
 * Mounts the three.js house (dynamically imported, so three is its own chunk)
 * and fades it in on its first rendered frame. If WebGL is unavailable or the
 * module fails to load, `fallback` (the CSS-3D house) renders instead.
 */
export default function HouseScene({
  progress,
  fallback,
}: {
  progress: MutableRefObject<StoryProgress>
  fallback: ReactNode
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    let disposed = false
    let unmount: (() => void) | undefined
    import('./house-scene-three')
      .then(({ mountHouseScene }) => {
        if (disposed || !hostRef.current) return
        unmount = mountHouseScene(hostRef.current, progress, () => {
          if (!disposed) setStatus('ready')
        })
      })
      .catch((err) => {
        console.warn('[landing] 3D scene unavailable, using CSS fallback', err)
        if (!disposed) setStatus('failed')
      })
    return () => {
      disposed = true
      unmount?.()
    }
  }, [progress])

  return (
    <>
      {status === 'failed' && fallback}
      <div
        ref={hostRef}
        className="pointer-events-none absolute -inset-x-[12%] -inset-y-[6%] transition-opacity duration-700"
        style={{
          opacity: status === 'ready' ? 1 : 0,
          // feather the canvas edges so the ground never ends in a hard box
          WebkitMaskImage: 'radial-gradient(ellipse 50% 50% at 50% 50%, #000 62%, transparent 100%)',
          maskImage: 'radial-gradient(ellipse 50% 50% at 50% 50%, #000 62%, transparent 100%)',
        }}
        aria-hidden="true"
      />
    </>
  )
}
