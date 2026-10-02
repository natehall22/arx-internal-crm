'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import HouseScene from './HouseScene'
import type { StoryProgress } from './house-scene-three'
import RoofModel from './RoofModel'

/**
 * Pinned, scroll-driven hero. One 3D house carries the story: it turns as you
 * scroll, a pin drops (knock), gold lines trace the ridge and hips (measure),
 * then the roof lifts apart into the layers that become the material order
 * (build). Scroll progress is written to CSS variables, never React state, so
 * scrolling doesn't re-render; only the active phase index is state.
 */

const PHASES = [
  { key: 'start', label: 'Start', at: 0 },
  { key: 'knock', label: 'Knock', at: 0.2 },
  { key: 'measure', label: 'Measure', at: 0.45 },
  { key: 'build', label: 'Build', at: 0.7 },
] as const

const STEPS = [
  {
    n: '01',
    title: 'Every door, tracked.',
    body: 'Reps work a live territory map from an offline-first field app. Each knock is GPS-tagged, and the lead is in the pipeline before they reach the next house.',
  },
  {
    n: '02',
    title: 'Measure the roof from the truck.',
    body: 'Trace the aerial and get squares, ridge, hips, valleys, and waste — slope-corrected — flowing straight into a priced proposal.',
  },
  {
    n: '03',
    title: 'What was sold is what gets built.',
    body: 'The signed proposal becomes the material order, the crew schedule, and the job cost — so ops builds the sold scope and the owner sees the real margin.',
  },
]

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function ArrowIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M3.5 10a1 1 0 0 1 1-1h8.09l-2.8-2.8a1 1 0 1 1 1.42-1.4l4.5 4.5a1 1 0 0 1 0 1.4l-4.5 4.5a1 1 0 0 1-1.42-1.4l2.8-2.8H4.5a1 1 0 0 1-1-1Z" clipRule="evenodd" />
    </svg>
  )
}

function Chip({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`absolute rounded-xl border border-white/10 bg-[#2A2825]/90 px-3.5 py-2.5 shadow-2xl shadow-black/40 backdrop-blur ${className}`}
      style={style}
    >
      {children}
    </div>
  )
}

export default function RoofStory() {
  const sectionRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState(0)
  const progressRef = useRef<StoryProgress>({ p: 0, draw: 0, lift: 0, pin: 0 })

  useEffect(() => {
    const section = sectionRef.current
    const stage = stageRef.current
    if (!section || !stage) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = -1

    const update = () => {
      raf = 0
      const total = section.offsetHeight - window.innerHeight
      const p = total > 0 ? clamp01(-section.getBoundingClientRect().top / total) : 0
      const draw = clamp01((p - 0.47) / 0.16)
      const lift = clamp01((p - 0.72) / 0.18)
      const pin = clamp01((p - 0.2) / 0.07) * (1 - clamp01((p - 0.44) / 0.05))
      progressRef.current = { p, draw, lift, pin }
      stage.style.setProperty('--rot', `${reduced ? -32 : -32 + p * 250}deg`)
      stage.style.setProperty('--draw', draw.toFixed(3))
      stage.style.setProperty('--lift', lift.toFixed(3))
      stage.style.setProperty('--pin', pin.toFixed(3))
      let idx = 0
      PHASES.forEach((ph, i) => {
        if (p >= ph.at) idx = i
      })
      if (idx !== last) {
        last = idx
        setPhase(idx)
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const jumpTo = (i: number) => {
    const section = sectionRef.current
    if (!section) return
    const total = section.offsetHeight - window.innerHeight
    const target = PHASES[i].at + (i === 0 ? 0 : 0.06)
    window.scrollTo({ top: section.offsetTop + total * target, behavior: 'smooth' })
  }

  const panel = (i: number) =>
    `[grid-area:1/1] transition-all ease-out ${
      phase === i
        ? 'opacity-100 translate-y-0 duration-500 delay-150'
        : 'pointer-events-none opacity-0 translate-y-4 duration-150'
    }`

  return (
    <section ref={sectionRef} className="relative h-[420vh] bg-[#1A1917] text-[#F6F1E7]">
      <style>{`
        @keyframes arxSway { 0%,100% { transform: rotateY(-5deg) } 50% { transform: rotateY(5deg) } }
      `}</style>

      <div className="sticky top-0 flex h-[100svh] flex-col overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(48rem 34rem at 72% 48%, rgba(176,144,78,0.20), transparent 62%), radial-gradient(40rem 30rem at 0% 100%, rgba(176,144,78,0.08), transparent 60%)',
          }}
        />

        <div className="relative mx-auto grid w-full max-w-6xl flex-1 grid-rows-[minmax(0,1fr)_auto] gap-2 px-5 pb-6 pt-20 lg:grid-cols-[0.9fr_1.1fr] lg:grid-rows-1 lg:items-center lg:gap-10 lg:px-8 lg:pb-0 lg:pt-16">
          {/* Stage */}
          <div
            ref={stageRef}
            className="relative order-1 h-full min-h-[260px] w-full lg:order-2 lg:h-[600px]"
            style={{ ['--rot' as string]: '-32deg' }}
          >
            <HouseScene
              progress={progressRef}
              fallback={
                <>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-[520px] w-[640px] scale-[0.58] sm:scale-[0.85] lg:scale-[1.2]" style={{ perspective: '1700px' }}>
                      <div
                        className="relative h-full w-full motion-safe:[animation:arxSway_9s_ease-in-out_infinite]"
                        style={{ transformStyle: 'preserve-3d' }}
                      >
                        <RoofModel />
                      </div>
                    </div>
                  </div>
                  <div
                    className="pointer-events-none absolute left-1/2 top-[14%]"
                    style={{ opacity: 'var(--pin, 0)', transform: 'translate(-50%, calc((1 - var(--pin, 0)) * -40px))' }}
                    aria-hidden="true"
                  >
                    <svg className="h-11 w-11 drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#E2BF73" d="M12 2C8.1 2 5 5.1 5 9c0 5 7 13 7 13s7-8 7-13c0-3.9-3.1-7-7-7Z" />
                      <circle cx="12" cy="9" r="2.6" fill="#1A1917" />
                    </svg>
                  </div>
                </>
              }
            />

            <Chip className="left-[4%] top-[8%] sm:left-[8%]" style={{ opacity: 'var(--pin, 0)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#E2BF73]">Hot lead</p>
              <p className="mt-0.5 text-sm font-semibold">412 Maple Ridge Dr</p>
              <p className="text-[11px] text-[#B8B0A0]">GPS-tagged knock · 4:12 pm</p>
            </Chip>

            {/* Measure: readouts */}
            <Chip className="right-[3%] top-[6%] sm:right-[6%]" style={{ opacity: 'calc(var(--draw, 0) * (1 - var(--lift, 0)))' }}>
              <p className="text-[11px] font-medium text-[#B8B0A0]">Roof total</p>
              <p className="text-2xl font-semibold tracking-tight">
                14.9 <span className="text-sm font-semibold text-[#E2BF73]">sq</span>
              </p>
            </Chip>
            <Chip className="bottom-[8%] left-[4%] sm:left-[8%]" style={{ opacity: 'calc(var(--draw, 0) * (1 - var(--lift, 0)))' }}>
              <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-[11px]">
                <span className="text-[#B8B0A0]">Ridge</span>
                <span className="text-[#B8B0A0]">Hips</span>
                <span className="text-[#B8B0A0]">Pitch</span>
                <span className="font-semibold">13 LF</span>
                <span className="font-semibold">91 LF</span>
                <span className="font-semibold">8/12</span>
              </div>
            </Chip>

            {/* Build: the layers become the order */}
            <Chip className="right-[3%] top-[6%] sm:right-[4%]" style={{ opacity: 'var(--lift, 0)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#E2BF73]">Material order</p>
              <ul className="mt-1.5 space-y-1 text-[12px]">
                <li className="flex justify-between gap-6"><span>Shingles</span><span className="font-semibold">16.5 sq</span></li>
                <li className="flex justify-between gap-6"><span>Underlayment</span><span className="font-semibold">2 rolls</span></li>
                <li className="flex justify-between gap-6"><span>Hip &amp; ridge cap</span><span className="font-semibold">104 LF</span></li>
              </ul>
            </Chip>
            <Chip className="bottom-[8%] left-[4%] bg-[#E2BF73] text-[#1A1917] sm:left-[8%]" style={{ opacity: 'var(--lift, 0)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em]">Signed · scheduled</p>
              <p className="text-sm font-semibold">Install Tue · roofing crew</p>
            </Chip>
          </div>

          {/* Copy */}
          <div className="relative order-2 lg:order-1">
            <div className="grid">
              <div className={panel(0)} aria-hidden={phase !== 0}>
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#E2BF73]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#E2BF73]" />
                  CRM for roofing &amp; trade shops
                </p>
                <h1 className="mt-4 text-[2.4rem] font-semibold leading-[1.02] tracking-[-0.025em] sm:text-6xl lg:text-[4.25rem]">
                  Run the shop on <span className="text-[#E2BF73]">systems</span>, not memory.
                </h1>
                <p className="mt-5 max-w-md text-base leading-7 text-[#C9C2B4] sm:text-lg sm:leading-8">
                  One file follows every job from the first knock to the final invoice — field app,
                  measurements, proposals, crews, costs, and commissions.
                </p>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/trial"
                    tabIndex={phase === 0 ? 0 : -1}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#E2BF73] px-6 py-3.5 text-base font-semibold text-[#1A1917] transition hover:bg-[#EBCD8B]"
                  >
                    Book a walkthrough
                    <ArrowIcon />
                  </Link>
                  <button
                    type="button"
                    tabIndex={phase === 0 ? 0 : -1}
                    onClick={() => jumpTo(1)}
                    className="hidden items-center justify-center rounded-xl border border-white/15 px-6 py-3.5 text-base font-semibold text-[#F6F1E7] transition hover:border-[#E2BF73] sm:inline-flex"
                  >
                    Watch a job move ↓
                  </button>
                </div>
              </div>

              {STEPS.map((s, i) => (
                <div key={s.n} className={panel(i + 1)} aria-hidden={phase !== i + 1}>
                  <p className="font-mono text-sm font-semibold text-[#E2BF73]">
                    {s.n} <span className="text-[#6F685C]">/ 03</span>
                  </p>
                  <h2 className="mt-3 text-3xl font-semibold leading-[1.08] tracking-[-0.02em] sm:text-5xl">{s.title}</h2>
                  <p className="mt-4 max-w-md text-base leading-7 text-[#C9C2B4] sm:text-lg sm:leading-8">{s.body}</p>
                </div>
              ))}
            </div>

            <nav className="mt-6 flex gap-2 lg:mt-12" aria-label="Story progress">
              {PHASES.map((ph, i) => (
                <button
                  key={ph.key}
                  type="button"
                  onClick={() => jumpTo(i)}
                  className="group flex-1 text-left sm:flex-none"
                  aria-current={phase === i ? 'step' : undefined}
                >
                  <span
                    className={`block h-1 rounded-full transition-all duration-500 sm:w-16 ${
                      phase >= i ? 'bg-[#E2BF73]' : 'bg-white/15 group-hover:bg-white/30'
                    }`}
                  />
                  <span className={`mt-2 block text-[11px] font-semibold uppercase tracking-[0.1em] ${phase === i ? 'text-[#F6F1E7]' : 'text-[#8A8272]'}`}>
                    {ph.label}
                  </span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </section>
  )
}
