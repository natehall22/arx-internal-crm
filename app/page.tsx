import Link from 'next/link'
import HeroScene3D from '@/components/landing/HeroScene3D'
import { CanvassShot, MeasureShot, PipelineShot } from '@/components/landing/ProductShots'
import Reveal from '@/components/landing/Reveal'

/* ARX brand palette
   ink    #211F1D  charcoal (dark sections, headings)
   gold   #B0904E  olive-gold (single accent)
   cream  #F6F1E7  warm background
   line   #E7DECB  hairline borders on light
   muted  #6B655A  body text on light                                    */

const metrics = [
  { value: '< 60 sec', label: 'Lead routing target' },
  { value: 'One file', label: 'From first call to install' },
  { value: 'Live', label: 'Sales + operations in sync' },
]

const replaces = [
  {
    title: 'Built around how the shop already works',
    body: 'ARX starts with the calls, whiteboards, field photos, and paper handoffs your team already depends on — then custom development fills the gaps during setup.',
  },
  {
    title: 'Less chasing for the office',
    body: 'Follow-ups, files, customer history, and next steps sit together, so the office is not rebuilding the story from scratch all day long.',
  },
  {
    title: 'Software plus real coaching',
    body: 'Plans can include business coaching around sales process, follow-up discipline, and cleaner operations — not just another login.',
  },
]

const audience = [
  'Roofing, restoration, HVAC, plumbing, and trade teams',
  'Office managers keeping calls and schedules straight',
  'Owners who need to know what actually happened today',
  'Field crews handing off signed work cleanly',
]

const growth = [
  { label: 'Know the real cost', detail: 'Track materials, labor, subs, commissions, deposits, and job expenses so pricing is never built on a gut feeling.' },
  { label: 'See what is profitable', detail: 'Compare sold work against actual job costs to spot which services, crews, and lead sources are worth scaling.' },
  { label: 'Grow without chaos', detail: 'Scale sales and operations together, so more booked work does not bury the office, the crews, or the owner.' },
]

const plans = [
  { label: 'Custom setup', detail: 'We shape the CRM around your shop, your team, your paperwork, and your handoffs.' },
  { label: 'Custom development', detail: 'When a setup needs a workflow, report, or handoff that does not exist yet, we build it into the engagement.' },
  { label: 'Business coaching', detail: 'Optional coaching helps owners understand costs, tighten sales habits, and build a healthier company.' },
]

const pricingIncludes = [
  'Full CRM & pipeline',
  'Canvassing app (offline)',
  'Roof measurement tool',
  'Estimating & proposals',
  'Job costing & ops board',
  'Commissions & payroll',
  'Reporting & dashboards',
  'Onboarding & support',
]

const presentationSteps = [
  'Map how calls, texts, and web leads come in',
  'Find the handoffs that cause callbacks or confusion',
  'Connect sales promises to operational capacity',
  'Scope custom development and coaching only where useful',
]

function ArrowIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M3.5 10a1 1 0 0 1 1-1h8.09l-2.8-2.8a1 1 0 1 1 1.42-1.4l4.5 4.5a1 1 0 0 1 0 1.4l-4.5 4.5a1 1 0 0 1-1.42-1.4l2.8-2.8H4.5a1 1 0 0 1-1-1Z" clipRule="evenodd" />
    </svg>
  )
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="ARX home">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#211F1D] text-sm font-semibold tracking-tight text-[#F6F1E7] ring-1 ring-[#B0904E]/40">
        A
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-[#211F1D]">ARX</span>
        <span className="mt-1 text-[11px] font-medium text-[#8A8272]">CRM for service shops</span>
      </span>
    </Link>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#8A6D3B]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#B0904E]" />
      {children}
    </span>
  )
}

function CheckDot() {
  return (
    <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#B0904E]/15 text-[#8A6D3B]">
      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.3 6.8-6.8a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
      </svg>
    </span>
  )
}

function FeatureRow({
  eyebrow,
  title,
  body,
  points,
  flip = false,
  children,
}: {
  eyebrow: string
  title: string
  body: string
  points: string[]
  flip?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
      <div className={flip ? 'lg:order-2' : ''}>
        <SectionLabel>{eyebrow}</SectionLabel>
        <h3 className="mt-4 text-2xl font-semibold leading-[1.15] tracking-[-0.01em] text-[#211F1D] md:text-[2rem]">
          {title}
        </h3>
        <p className="mt-4 max-w-lg text-lg leading-8 text-[#5A544A]">{body}</p>
        <ul className="mt-6 space-y-3">
          {points.map((p) => (
            <li key={p} className="flex items-center gap-3 text-[15px] font-medium text-[#3E3A33]">
              <CheckDot />
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className={`flex justify-center ${flip ? 'lg:order-1' : ''}`}>{children}</div>
    </div>
  )
}

export default function Home() {
  return (
    <main className="min-h-screen bg-[#F6F1E7] text-[#211F1D] antialiased">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[#211F1D]/[0.07] bg-[#F6F1E7]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 lg:px-8">
          <Wordmark />
          <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
            <a href="#platform" className="text-sm font-medium text-[#6B655A] transition hover:text-[#211F1D]">Platform</a>
            <a href="#fit" className="text-sm font-medium text-[#6B655A] transition hover:text-[#211F1D]">Who it&apos;s for</a>
            <a href="#plans" className="text-sm font-medium text-[#6B655A] transition hover:text-[#211F1D]">Plans</a>
            <a href="#pricing" className="text-sm font-medium text-[#6B655A] transition hover:text-[#211F1D]">Pricing</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href="/login" className="hidden text-sm font-medium text-[#6B655A] transition hover:text-[#211F1D] sm:inline">
              Sign in
            </Link>
            <Link
              href="/trial"
              className="inline-flex items-center rounded-lg bg-[#211F1D] px-4 py-2.5 text-sm font-semibold text-[#F6F1E7] shadow-sm transition hover:bg-[#332F2B]"
            >
              Book a walkthrough
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.5]"
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(60rem 40rem at 85% -10%, rgba(176,144,78,0.16), transparent 60%), radial-gradient(50rem 40rem at -10% 20%, rgba(176,144,78,0.10), transparent 55%)',
          }}
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 lg:grid-cols-[1fr_1.05fr] lg:gap-16 lg:px-8 lg:pb-28 lg:pt-20">
          <div>
            <SectionLabel>The operating system for service shops</SectionLabel>
            <h1 className="mt-6 text-[2.75rem] font-semibold leading-[1.05] tracking-[-0.02em] text-[#211F1D] sm:text-6xl">
              Run the shop on{' '}
              <span className="relative whitespace-nowrap text-[#8A6D3B]">
                systems
                <span className="absolute -bottom-1 left-0 h-[3px] w-full rounded-full bg-[#B0904E]/50" />
              </span>
              ,<br className="hidden sm:block" /> not memory.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#5A544A]">
              ARX gives service shops one serious operating system for calls, estimates, field notes,
              contracts, job costs, and the handoffs that usually live in someone&apos;s head.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/trial"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#211F1D] px-6 py-3.5 text-base font-semibold text-[#F6F1E7] shadow-lg shadow-[#211F1D]/15 transition hover:bg-[#332F2B]"
              >
                Book a walkthrough
                <ArrowIcon />
              </Link>
              <a
                href="#platform"
                className="inline-flex items-center justify-center rounded-xl border border-[#DDD2BB] bg-white/70 px-6 py-3.5 text-base font-semibold text-[#211F1D] transition hover:border-[#B0904E] hover:bg-white"
              >
                See how it works
              </a>
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-2">
              {['CRM', 'Estimating', 'Job costing', 'Ops handoff'].map((item, i) => (
                <div key={item} className="flex items-center gap-3">
                  {i > 0 && <span className="h-1 w-1 rounded-full bg-[#C9BFA6]" aria-hidden="true" />}
                  <span className="text-sm font-semibold text-[#6B655A]">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative lg:pl-4">
            <HeroScene3D />
          </div>
        </div>
      </section>

      {/* Metrics band */}
      <section className="border-y border-[#211F1D]/[0.07] bg-white">
        <div className="mx-auto grid max-w-6xl gap-px bg-[#EFE7D5] px-5 sm:grid-cols-3 lg:px-8">
          {metrics.map((m, i) => (
            <Reveal key={m.label} delay={i * 90} className="bg-white px-2 py-8 text-center sm:py-10">
              <p className="text-3xl font-semibold tracking-tight text-[#211F1D]">{m.value}</p>
              <p className="mt-2 text-sm font-medium text-[#6B655A]">{m.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Product tour */}
      <section id="tour" className="bg-[#F6F1E7] px-5 py-20 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-6xl">
          <Reveal className="max-w-3xl">
            <SectionLabel>See ARX in action</SectionLabel>
            <h2 className="mt-5 text-3xl font-semibold leading-[1.12] tracking-[-0.01em] text-[#211F1D] md:text-[2.75rem]">
              From the doorstep to the deposit, one system.
            </h2>
            <p className="mt-6 text-lg leading-8 text-[#5A544A]">
              The same record follows the customer through every hand — the field app, the measurement,
              the proposal, and the ops board — so nothing gets re-keyed and nothing falls through.
            </p>
          </Reveal>

          <div className="mt-16 space-y-20 lg:mt-20 lg:space-y-28">
            <Reveal>
              <FeatureRow
                eyebrow="Canvassing"
                title="Knock smarter. Every door, tracked."
                body="Reps drop dispositions on a live territory map — hot leads, not-homes, go-backs — with GPS-tagged knocks and 444 progress that keep syncing even with no signal."
                points={['Offline-first field PWA', 'Live territory + rep GPS', 'Leads auto-attributed to the rep']}
              >
                <CanvassShot />
              </FeatureRow>
            </Reveal>

            <Reveal>
              <FeatureRow
                eyebrow="Roof measure"
                title="Measure the roof from the truck."
                body="Pull aerial imagery, trace the facets, and get squares, ridge, hips, valleys, and waste in seconds — flowing straight into a priced proposal."
                flip
                points={['Aerial + slope-corrected lengths', 'Squares feed the proposal', 'Waste and material list included']}
              >
                <MeasureShot />
              </FeatureRow>
            </Reveal>

            <Reveal>
              <FeatureRow
                eyebrow="The office"
                title="One living file, from first call to install."
                body="Calls, contracts, job costs, and the ops handoff sit on a single pipeline — so sales knows what ops can carry, and owners see what happened today."
                points={['Sales + operations in one view', 'Job costing on every ticket', 'Clean, trackable handoffs']}
              >
                <PipelineShot />
              </FeatureRow>
            </Reveal>
          </div>
        </div>
      </section>

      {/* What it replaces */}
      <section id="platform" className="bg-white px-5 py-20 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-6xl">
          <Reveal className="max-w-3xl">
            <SectionLabel>What it replaces</SectionLabel>
            <h2 className="mt-5 text-3xl font-semibold leading-[1.12] tracking-[-0.01em] text-[#211F1D] md:text-[2.75rem]">
              Less spreadsheet cleanup. Fewer missed callbacks. No mystery handoffs.
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {replaces.map((item, i) => (
              <Reveal key={item.title} delay={i * 100}>
                <article className="h-full rounded-2xl border border-[#EFE8D7] bg-[#FCFAF4] p-7 transition hover:border-[#B0904E]/50 hover:shadow-lg hover:shadow-[#211F1D]/[0.05]">
                  <h3 className="text-lg font-semibold leading-7 text-[#211F1D]">{item.title}</h3>
                  <p className="mt-3 text-[15px] leading-7 text-[#6B655A]">{item.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for — dark */}
      <section id="fit" className="bg-[#211F1D] px-5 py-20 text-[#F6F1E7] lg:px-8 lg:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
          <Reveal>
            <SectionLabel>Who it&apos;s for</SectionLabel>
            <h2 className="mt-5 text-3xl font-semibold leading-[1.12] tracking-[-0.01em] md:text-[2.75rem]">
              Built for shops where everyone wears three hats and the phone never really stops.
            </h2>
            <p className="mt-6 max-w-lg text-lg leading-8 text-[#C9C2B4]">
              A business is only as strong as the systems it runs on. ARX is enterprise-grade,
              built and priced for real local shops.
            </p>
          </Reveal>
          <div className="grid gap-3 sm:grid-cols-2">
            {audience.map((item, i) => (
              <Reveal key={item} delay={i * 80} className="h-full rounded-xl border border-white/10 bg-white/[0.04] p-5">
                <p className="text-[15px] font-medium leading-6 text-[#EDE7DA]">{item}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Growth / costs */}
      <section className="bg-[#F6F1E7] px-5 py-20 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-6xl">
          <Reveal className="max-w-3xl">
            <SectionLabel>Built for sustainable growth</SectionLabel>
            <h2 className="mt-5 text-3xl font-semibold leading-[1.12] tracking-[-0.01em] text-[#211F1D] md:text-[2.75rem]">
              A lot of shops are growing without knowing what the work really costs.
            </h2>
            <p className="mt-6 text-lg leading-8 text-[#5A544A]">
              ARX gets owners out of guesswork — cleaner numbers, cleaner process, and stronger systems
              where sales growth and operational capacity move together.
            </p>
          </Reveal>
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {growth.map((item, i) => (
              <Reveal key={item.label} delay={i * 100}>
                <article className="h-full rounded-2xl border border-[#E7DECB] bg-white p-7">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#B0904E]/12 text-sm font-semibold text-[#8A6D3B]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <p className="mt-5 text-lg font-semibold text-[#211F1D]">{item.label}</p>
                  <p className="mt-2.5 text-[15px] leading-7 text-[#6B655A]">{item.detail}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="bg-white px-5 py-20 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-6xl">
          <Reveal className="max-w-3xl">
            <SectionLabel>Not one-size-fits-all</SectionLabel>
            <h2 className="mt-5 text-3xl font-semibold leading-[1.12] tracking-[-0.01em] text-[#211F1D] md:text-[2.75rem]">
              The plan can include the build, the numbers, and the coaching.
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {plans.map((item, i) => (
              <Reveal key={item.label} delay={i * 100}>
                <article className="h-full rounded-2xl border border-[#EFE8D7] bg-[#FCFAF4] p-7">
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#8A6D3B]">{item.label}</p>
                  <p className="mt-4 text-lg font-semibold leading-7 text-[#211F1D]">{item.detail}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-[#F6F1E7] px-5 py-20 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-6xl">
          <Reveal className="max-w-3xl">
            <SectionLabel>Pricing</SectionLabel>
            <h2 className="mt-5 text-3xl font-semibold leading-[1.12] tracking-[-0.01em] text-[#211F1D] md:text-[2.75rem]">
              Simple, honest pricing.
            </h2>
            <p className="mt-6 text-lg leading-8 text-[#5A544A]">
              One platform, one per-seat price, and a one-time setup so ARX is shaped around your
              shop before day one.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch">
            <Reveal>
              <div className="flex h-full flex-col rounded-3xl border border-[#E7DECB] bg-white p-8 shadow-xl shadow-[#211F1D]/[0.06]">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8A6D3B]">ARX Platform</p>
                <div className="mt-4 flex items-end gap-2">
                  <span className="text-5xl font-semibold tracking-tight text-[#211F1D]">$35</span>
                  <span className="mb-1.5 text-base font-medium text-[#6B655A]">/ seat / month</span>
                </div>
                <div className="mt-6 flex items-center gap-3 rounded-xl bg-[#F5F0E4] px-4 py-3.5">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-[#B0904E]/15 text-[#8A6D3B]">
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M10 2a1 1 0 0 1 1 1v1.06a4 4 0 0 1 3 3.87 1 1 0 1 1-2 0 2 2 0 0 0-2-2H8.5a1.5 1.5 0 0 0 0 3H11a3.5 3.5 0 0 1 .5 6.94V17a1 1 0 1 1-2 0v-1.06a4 4 0 0 1-3-3.87 1 1 0 1 1 2 0 2 2 0 0 0 2 2h1.5a1.5 1.5 0 0 0 0-3H9A3.5 3.5 0 0 1 8.5 4.06V3a1 1 0 0 1 1-1Z" />
                    </svg>
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[#211F1D]">$1,200 one-time startup</p>
                    <p className="text-xs text-[#6B655A]">Custom setup for a small business</p>
                  </div>
                </div>
                <Link
                  href="/trial"
                  className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#211F1D] px-6 py-3.5 text-base font-semibold text-[#F6F1E7] shadow-lg shadow-[#211F1D]/15 transition hover:bg-[#332F2B]"
                >
                  Book a walkthrough
                  <ArrowIcon />
                </Link>
                <p className="mt-3 text-center text-xs text-[#8A8272]">
                  Custom development and coaching scoped per shop.
                </p>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="h-full rounded-3xl border border-[#E7DECB] bg-[#FCFAF4] p-8">
                <p className="text-sm font-semibold text-[#211F1D]">Every seat includes</p>
                <ul className="mt-6 grid gap-3.5 sm:grid-cols-2">
                  {pricingIncludes.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-[15px] font-medium text-[#3E3A33]">
                      <CheckDot />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-[#211F1D] px-5 py-20 text-[#F6F1E7] lg:px-8 lg:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-16">
          <Reveal>
            <SectionLabel>The next step</SectionLabel>
            <h2 className="mt-5 text-3xl font-semibold leading-[1.12] tracking-[-0.01em] md:text-[2.75rem]">
              First we learn the shop. Then we price the build.
            </h2>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#C9C2B4]">
              The walkthrough is a working session. We look at how leads come in, who answers, where jobs
              get stuck, and how sales and operations work together — then ARX is scoped around that reality.
            </p>
          </Reveal>

          <Reveal delay={120} className="rounded-2xl border border-white/10 bg-white/[0.04] p-7">
            <div className="space-y-5">
              {presentationSteps.map((item, index) => (
                <div key={item} className="flex gap-4">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-[#B0904E] text-sm font-semibold text-[#211F1D]">
                    {index + 1}
                  </span>
                  <p className="pt-0.5 text-[15px] font-medium leading-6 text-[#EDE7DA]">{item}</p>
                </div>
              ))}
            </div>
            <Link
              href="/trial"
              className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#B0904E] px-6 py-3.5 text-base font-semibold text-[#211F1D] transition hover:bg-[#C9A961]"
            >
              Schedule a walkthrough
              <ArrowIcon />
            </Link>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#211F1D]/[0.07] bg-[#F6F1E7] px-5 py-10 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <Wordmark />
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-[#6B655A]">
            <a href="#platform" className="transition hover:text-[#211F1D]">Platform</a>
            <a href="#fit" className="transition hover:text-[#211F1D]">Who it&apos;s for</a>
            <a href="#plans" className="transition hover:text-[#211F1D]">Plans</a>
            <a href="#pricing" className="transition hover:text-[#211F1D]">Pricing</a>
            <Link href="/login" className="transition hover:text-[#211F1D]">Sign in</Link>
            <Link href="/terms" className="transition hover:text-[#211F1D]">Terms</Link>
          </div>
          <p className="text-sm text-[#8A8272]">© {new Date().getFullYear()} ARX</p>
        </div>
      </footer>
    </main>
  )
}
