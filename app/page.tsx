import type { Metadata } from 'next'
import Link from 'next/link'
import Reveal from '@/components/landing/Reveal'
import RoofStory from '@/components/landing/RoofStory'

export const metadata: Metadata = {
  title: 'ARX — CRM for roofing & trade shops',
  description:
    'One file from the first knock to the final invoice: canvassing app, roof measurement, proposals, crews, job costing, and commissions.',
}

/* ARX brand palette
   night  #1A1917  dark sections
   ink    #211F1D  headings on light
   gold   #E2BF73  accent on dark   ·  #8A6D3B accent text on light
   cream  #F6F1E7  light background
   muted  #5A544A  body text on light                                     */

const modules = [
  { title: 'Pipeline & CRM', body: 'Every call, text, web lead, and knock lands in one place with the next step attached.', icon: 'M4 6h16M4 12h11M4 18h7' },
  { title: 'Canvassing app', body: 'Offline-first field app with live territories, dispositions, and GPS-tagged knocks.', icon: 'M12 21s-7-6.5-7-12a7 7 0 1 1 14 0c0 5.5-7 12-7 12Zm0-9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z' },
  { title: 'Roof measurement', body: 'Aerial squares, ridge, hips, valleys, and waste — slope-corrected, straight into the proposal.', icon: 'M3 17 17 3l4 4L7 21l-4-4Zm4-4 2 2m1-5 2 2m1-5 2 2' },
  { title: 'Proposals & contracts', body: 'Priced proposals with add-ons, signed on the spot on a phone or tablet.', icon: 'M7 3h7l5 5v13H7V3Zm7 0v5h5M10 13h6M10 17h4' },
  { title: 'Crew scheduling', body: 'A crew per trade, calendar invites to subs, and photo check-off at install.', icon: 'M4 6h16v14H4V6Zm0 4h16M8 3v4m8-4v4' },
  { title: 'Job costing', body: 'Materials, labor, subs, and fees against what was sold — real margin on every job.', icon: 'M12 3v18m5-13.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.6 5 3 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3' },
  { title: 'Commissions & payroll', body: 'Comp plans and approvals calculated from the job, not rebuilt in a spreadsheet.', icon: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6.5 9c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5m2 3.8c1.8.6 3 2.4 3.5 5.2' },
  { title: 'Reporting', body: 'What happened today, what is stuck, and what the month is on pace for.', icon: 'M4 20V10m6 10V4m6 16v-7M3 20h18' },
]

const outcomes = [
  {
    title: 'Know what a job really costs',
    body: 'Most shops grow without knowing their margin. ARX ties sold scope to actual material, labor, and sub costs, so pricing stops being a gut feeling.',
  },
  {
    title: 'Nothing lives in someone’s head',
    body: 'Follow-ups, photos, contracts, and the ops handoff sit on the job, so the office stops rebuilding the story from texts and whiteboards.',
  },
  {
    title: 'Grow without burying the office',
    body: 'Sales and production run off the same file, so more booked work shows up as a schedule — not a pile of callbacks.',
  },
]

const setupCovers = [
  { title: 'Custom setup', body: 'Shaped around your team, your paperwork, and your handoffs before day one.' },
  { title: 'Custom development', body: 'When a workflow or report your shop needs doesn’t exist yet, we build it in.' },
  { title: 'Business coaching', body: 'Optional coaching on costs, sales habits, and cleaner operations.' },
]

const walkthroughSteps = [
  'Map how calls, texts, and web leads come in',
  'Find the handoffs that cause callbacks',
  'Connect what sales promises to what ops can carry',
  'Scope custom work only where it pays off',
]

function ArrowIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M3.5 10a1 1 0 0 1 1-1h8.09l-2.8-2.8a1 1 0 1 1 1.42-1.4l4.5 4.5a1 1 0 0 1 0 1.4l-4.5 4.5a1 1 0 0 1-1.42-1.4l2.8-2.8H4.5a1 1 0 0 1-1-1Z" clipRule="evenodd" />
    </svg>
  )
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="ARX home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/arx-mark-cream.png" alt="" className="h-9 w-auto" />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-[#F6F1E7]">ARX</span>
        <span className="mt-1 text-[11px] font-medium text-[#A49C8C]">CRM for service shops</span>
      </span>
    </Link>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#8A6D3B]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#B0904E]" />
      {children}
    </span>
  )
}

export default function Home() {
  return (
    <main className="min-h-screen bg-[#F6F1E7] text-[#211F1D] antialiased">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.07] bg-[#1A1917]/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 lg:px-8">
          <Wordmark />
          <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
            <a href="#platform" className="text-sm font-medium text-[#C9C2B4] transition hover:text-[#F6F1E7]">Platform</a>
            <a href="#why" className="text-sm font-medium text-[#C9C2B4] transition hover:text-[#F6F1E7]">Why ARX</a>
            <a href="#pricing" className="text-sm font-medium text-[#C9C2B4] transition hover:text-[#F6F1E7]">Pricing</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-5">
            <Link href="/login" className="hidden text-sm font-medium text-[#C9C2B4] transition hover:text-[#F6F1E7] sm:inline">
              Sign in
            </Link>
            <Link
              href="/trial"
              className="inline-flex items-center rounded-lg bg-[#E2BF73] px-4 py-2.5 text-sm font-semibold text-[#1A1917] transition hover:bg-[#EBCD8B]"
            >
              Book a walkthrough
            </Link>
          </div>
        </div>
      </header>

      <RoofStory />

      {/* Platform */}
      <section id="platform" className="scroll-mt-16 px-5 py-20 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-6xl">
          <Reveal className="max-w-3xl">
            <SectionLabel>The platform</SectionLabel>
            <h2 className="mt-5 text-3xl font-semibold leading-[1.1] tracking-[-0.02em] md:text-5xl">
              Everything the shop runs on, in one file.
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[#5A544A]">
              No re-keying between the field app, the estimate, the schedule, and payroll. Every seat gets all of it.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-[#E2D8C3] bg-[#E2D8C3] sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((m, i) => (
              <Reveal key={m.title} delay={(i % 4) * 70} className="bg-[#FCFAF5] p-6 transition-colors hover:bg-white">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1A1917] text-[#E2BF73]">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={m.icon} />
                  </svg>
                </span>
                <h3 className="mt-5 text-base font-semibold text-[#211F1D]">{m.title}</h3>
                <p className="mt-2 text-[15px] leading-6 text-[#5A544A]">{m.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Why */}
      <section id="why" className="scroll-mt-16 bg-white px-5 py-20 lg:px-8 lg:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <Reveal>
            <SectionLabel>Why shops switch</SectionLabel>
            <h2 className="mt-5 text-3xl font-semibold leading-[1.1] tracking-[-0.02em] md:text-5xl">
              Built by a roofing company, for the shop it actually is.
            </h2>
            <p className="mt-5 text-lg leading-8 text-[#5A544A]">
              ARX runs a working storm and insurance roofing business every day. Roofing, restoration,
              HVAC, and plumbing teams get the same system — not a generic CRM bent into shape.
            </p>
          </Reveal>
          <div className="divide-y divide-[#EAE2D0] border-y border-[#EAE2D0]">
            {outcomes.map((o, i) => (
              <Reveal key={o.title} delay={i * 80} className="grid gap-2 py-7 sm:grid-cols-[3rem_1fr]">
                <span className="font-mono text-sm font-semibold text-[#8A6D3B]">0{i + 1}</span>
                <div>
                  <h3 className="text-xl font-semibold text-[#211F1D]">{o.title}</h3>
                  <p className="mt-2 text-[15px] leading-7 text-[#5A544A]">{o.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-16 px-5 py-20 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-6xl">
          <Reveal className="max-w-3xl">
            <SectionLabel>Pricing</SectionLabel>
            <h2 className="mt-5 text-3xl font-semibold leading-[1.1] tracking-[-0.02em] md:text-5xl">Simple, honest pricing.</h2>
          </Reveal>
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <Reveal className="flex flex-col rounded-3xl bg-[#1A1917] p-8 text-[#F6F1E7] shadow-2xl shadow-[#211F1D]/20 sm:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#E2BF73]">ARX Platform</p>
              <div className="mt-5 flex items-end gap-2">
                <span className="text-6xl font-semibold tracking-tight">$35</span>
                <span className="mb-2 text-base font-medium text-[#C9C2B4]">/ seat / month</span>
              </div>
              <p className="mt-3 text-[15px] text-[#C9C2B4]">Every module, every seat. No tiers.</p>
              <div className="mt-8 flex items-baseline justify-between border-t border-white/10 pt-6">
                <span className="text-[15px] text-[#C9C2B4]">One-time startup</span>
                <span className="text-2xl font-semibold">$1,200</span>
              </div>
              <Link
                href="/trial"
                className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#E2BF73] px-6 py-3.5 text-base font-semibold text-[#1A1917] transition hover:bg-[#EBCD8B]"
              >
                Book a walkthrough
                <ArrowIcon />
              </Link>
            </Reveal>
            <Reveal delay={100} className="rounded-3xl border border-[#E2D8C3] bg-[#FCFAF5] p-8 sm:p-10">
              <p className="text-sm font-semibold text-[#211F1D]">The startup covers</p>
              <ul className="mt-6 space-y-6">
                {setupCovers.map((s) => (
                  <li key={s.title} className="flex gap-4">
                    <span className="mt-1 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#B0904E]/15 text-[#8A6D3B]">
                      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.3 6.8-6.8a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
                      </svg>
                    </span>
                    <div>
                      <p className="font-semibold text-[#211F1D]">{s.title}</p>
                      <p className="mt-1 text-[15px] leading-6 text-[#5A544A]">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-[#1A1917] px-5 py-20 text-[#F6F1E7] lg:px-8 lg:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-16">
          <Reveal>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#E2BF73]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#E2BF73]" />
              The next step
            </p>
            <h2 className="mt-5 text-3xl font-semibold leading-[1.1] tracking-[-0.02em] md:text-5xl">
              First we learn the shop. Then we price the build.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-[#C9C2B4]">
              The walkthrough is a working session on how your leads come in, where jobs get stuck, and how
              sales and production hand off.
            </p>
          </Reveal>
          <Reveal delay={100} className="rounded-2xl border border-white/10 bg-white/[0.04] p-7">
            <ol className="space-y-5">
              {walkthroughSteps.map((item, index) => (
                <li key={item} className="flex gap-4">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-[#E2BF73] text-sm font-semibold text-[#1A1917]">
                    {index + 1}
                  </span>
                  <p className="pt-0.5 text-[15px] font-medium leading-6 text-[#EDE7DA]">{item}</p>
                </li>
              ))}
            </ol>
            <Link
              href="/trial"
              className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#E2BF73] px-6 py-3.5 text-base font-semibold text-[#1A1917] transition hover:bg-[#EBCD8B]"
            >
              Schedule a walkthrough
              <ArrowIcon />
            </Link>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-white/[0.07] bg-[#1A1917] px-5 py-10 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <Wordmark />
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-[#A49C8C]">
            <a href="#platform" className="transition hover:text-[#F6F1E7]">Platform</a>
            <a href="#why" className="transition hover:text-[#F6F1E7]">Why ARX</a>
            <a href="#pricing" className="transition hover:text-[#F6F1E7]">Pricing</a>
            <Link href="/login" className="transition hover:text-[#F6F1E7]">Sign in</Link>
            <Link href="/terms" className="transition hover:text-[#F6F1E7]">Terms</Link>
          </div>
          <p className="text-sm text-[#8A8272]">© {new Date().getFullYear()} ARX</p>
        </div>
      </footer>
    </main>
  )
}
