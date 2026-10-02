'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Fade + rise on scroll into view. Server-rendered visible, and only content
 * that mounts below the fold is hidden, so a slow or failed hydrate never
 * leaves the page blank and nothing already on screen flashes. One-shot;
 * disabled under prefers-reduced-motion.
 */
export default function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'ssr' | 'hidden' | 'shown'>('ssr')

  useEffect(() => {
    const el = ref.current
    if (
      !el ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !('IntersectionObserver' in window) ||
      el.getBoundingClientRect().top < window.innerHeight
    ) {
      return
    }
    setState('hidden')
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState('shown')
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -6% 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={className}
      style={
        state === 'ssr'
          ? undefined
          : {
              opacity: state === 'shown' ? 1 : 0,
              transform: state === 'shown' ? 'none' : 'translateY(18px)',
              transition: `opacity 600ms cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 600ms cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
            }
      }
    >
      {children}
    </div>
  )
}
