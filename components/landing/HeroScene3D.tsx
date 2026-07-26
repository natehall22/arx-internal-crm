'use client'

import { useEffect, useRef, useState } from 'react'
import { PipelineShot } from './ProductShots'

/**
 * Interactive 3D hero. Pure CSS 3D (perspective + preserve-3d) so it renders
 * reliably everywhere and degrades gracefully — the product UI and floating
 * accents sit at different depths and parallax as the cursor moves.
 */
export default function HeroScene3D() {
  const ref = useRef<HTMLDivElement>(null)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || reduced) return
    const rest = { rx: 7, ry: -14 }
    const target = { ...rest }
    const cur = { ...rest }
    let raf = 0
    let running = false

    // Self-stopping rAF: eases toward the target, then halts once settled so the
    // page can go idle (a perpetual loop blocks screenshots and wastes battery).
    const loop = () => {
      const dx = target.rx - cur.rx
      const dy = target.ry - cur.ry
      cur.rx += dx * 0.08
      cur.ry += dy * 0.08
      el.style.setProperty('--rx', `${cur.rx.toFixed(2)}deg`)
      el.style.setProperty('--ry', `${cur.ry.toFixed(2)}deg`)
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
        running = false
        return
      }
      raf = requestAnimationFrame(loop)
    }
    const kick = () => {
      if (!running) {
        running = true
        raf = requestAnimationFrame(loop)
      }
    }
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      const px = (e.clientX - (r.left + r.width / 2)) / r.width
      const py = (e.clientY - (r.top + r.height / 2)) / r.height
      target.ry = rest.ry + px * 18
      target.rx = rest.rx - py * 16
      kick()
    }
    // Ease back to rest only when the cursor actually leaves the document —
    // `relatedTarget === null` on mouseout means it left the window, whereas a
    // plain window 'mouseout' fires on every element boundary and would cancel
    // the parallax on each move.
    const onLeave = (e: MouseEvent) => {
      if (e.relatedTarget === null) {
        target.rx = rest.rx
        target.ry = rest.ry
        kick()
      }
    }
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseout', onLeave)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseout', onLeave)
    }
  }, [reduced])

  return (
    <div
      className="relative mx-auto h-[440px] w-full max-w-[520px] select-none sm:h-[500px] lg:h-[580px]"
      style={{ perspective: '1500px' }}
      aria-hidden="true"
    >
      <style>{`
        @keyframes arxFloatA { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-12px) } }
        @keyframes arxFloatB { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(10px) } }
      `}</style>

      {/* ambient glow */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[22rem] w-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#B0904E]/20 blur-3xl" />

      <div
        ref={ref}
        className="relative h-full w-full"
        style={{
          transformStyle: 'preserve-3d',
          transform: 'rotateX(var(--rx,7deg)) rotateY(var(--ry,-14deg))',
        }}
      >
        {/* depth backdrop panel */}
        <div
          className="absolute left-1/2 top-1/2 h-[78%] w-[86%] rounded-3xl border border-[#E7DECB]/70 bg-white/40"
          style={{ transform: 'translate(-50%, -50%) translateZ(-90px)' }}
        />

        {/* main product card */}
        <div
          className="absolute left-1/2 top-1/2 w-[90%]"
          style={{ transform: 'translate(-50%, -50%) translateZ(10px) scale(0.92)' }}
        >
          <PipelineShot />
        </div>

        {/* floating: new lead (canvass) */}
        <div className="absolute left-[-6%] top-[8%]" style={{ transform: 'translateZ(90px)' }}>
          <div style={{ animation: reduced ? undefined : 'arxFloatA 6s ease-in-out infinite' }}>
            <div className="flex items-center gap-2.5 rounded-xl border border-[#EFE8D7] bg-white/95 px-3.5 py-2.5 shadow-xl shadow-[#211F1D]/15 backdrop-blur">
              <span className="relative flex h-6 w-6 items-center justify-center">
                <span className="absolute inline-flex h-6 w-6 rounded-full bg-[#B0904E]/25" />
                <svg className="relative h-3.5 w-3.5 text-[#8A6D3B]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C8.1 2 5 5.1 5 9c0 5 7 13 7 13s7-8 7-13c0-3.9-3.1-7-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
                </svg>
              </span>
              <div>
                <p className="text-[13px] font-semibold leading-tight text-[#211F1D]">New lead</p>
                <p className="text-[11px] leading-tight text-[#8A8272]">GPS-tagged knock</p>
              </div>
            </div>
          </div>
        </div>

        {/* floating: measured chip */}
        <div className="absolute right-[-4%] top-[20%]" style={{ transform: 'translateZ(130px)' }}>
          <div style={{ animation: reduced ? undefined : 'arxFloatB 7s ease-in-out infinite' }}>
            <div className="rounded-xl border border-[#EFE8D7] bg-white/95 px-3.5 py-2.5 shadow-xl shadow-[#211F1D]/15 backdrop-blur">
              <p className="text-[11px] font-medium text-[#8A8272]">Roof measured</p>
              <p className="text-lg font-semibold tracking-tight text-[#211F1D]">
                28.4 <span className="text-xs font-bold text-[#8A6D3B]">sq</span>
              </p>
            </div>
          </div>
        </div>

        {/* floating: commission chip */}
        <div className="absolute bottom-[6%] right-[2%]" style={{ transform: 'translateZ(70px)' }}>
          <div style={{ animation: reduced ? undefined : 'arxFloatA 8s ease-in-out infinite' }}>
            <div className="flex items-center gap-2 rounded-xl bg-[#211F1D] px-3.5 py-2.5 shadow-xl shadow-[#211F1D]/25">
              <span className="h-1.5 w-1.5 rounded-full bg-[#7C8A5A]" />
              <p className="text-[12px] font-semibold text-[#F6F1E7]">Install ready · $24.7k</p>
            </div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-[#211F1D]/10 bg-white/70 px-3 py-1 text-[11px] font-medium text-[#6B655A] backdrop-blur">
        Move your cursor to explore
      </div>
    </div>
  )
}
