import Image from 'next/image'
import Link from 'next/link'

const outcomes = [
  ['60 sec', 'target lead routing'],
  ['1 file', 'from knock to install'],
  ['Live', 'sales and ops view'],
  ['Custom', 'setup and development'],
]

const pipelineRows = [
  ['Miller Residence', 'Inspection booked', '$18.4k', 'Claim docs ready'],
  ['Holloway HOA', 'Proposal sent', '$42.8k', 'Follow-up today'],
  ['Briar Creek', 'Install packet', '$27.1k', 'Materials pending'],
]

const features = [
  {
    eyebrow: 'Front office',
    title: 'Book faster and stop rebuilding the customer story.',
    body: 'Capture calls, web leads, referrals, appointments, notes, and ownership in one clean path from first contact to booked visit.',
  },
  {
    eyebrow: 'Sales workflow',
    title: 'Keep estimates, contracts, photos, and follow-up together.',
    body: 'Give reps the full job file before they arrive, then carry the promise they made straight into the production handoff.',
  },
  {
    eyebrow: 'Operations',
    title: 'Move signed work into install-ready packets.',
    body: 'Track scope, measurements, materials, change orders, invoices, payments, and crew readiness without chasing five systems.',
  },
  {
    eyebrow: 'Owner visibility',
    title: 'See what is moving, stalled, profitable, and risky.',
    body: 'Dashboards and job costing help owners coach the business from real operating data, not memory or end-of-month cleanup.',
  },
]

const walkthroughSteps = [
  'Map how leads enter the business',
  'Review canvassing, setters, closers, and office handoffs',
  'Connect sales promises to production capacity',
  'Scope the build, coaching, and rollout plan',
]

function ArrowIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M3.5 10a1 1 0 0 1 1-1h8.1l-2.8-2.8a1 1 0 1 1 1.4-1.4l4.5 4.5a1 1 0 0 1 0 1.4l-4.5 4.5a1 1 0 0 1-1.4-1.4l2.8-2.8H4.5a1 1 0 0 1-1-1Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 0 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function ProductPreview() {
  return (
    <div className="relative min-w-0">
      <div className="absolute -left-6 -top-7 hidden w-40 rounded-lg bg-[#17130d] p-4 shadow-2xl shadow-black/30 ring-1 ring-[#c7a35a]/30 lg:block">
        <p className="text-xs font-bold uppercase text-[#a69068]">Packet health</p>
        <p className="mt-2 text-3xl font-black text-[#f7efe1]">87%</p>
        <div className="mt-3 h-2 rounded-full bg-white/10">
          <div className="h-2 w-[87%] rounded-full bg-[#c7a35a]" />
        </div>
      </div>

      <div className="w-full overflow-hidden rounded-2xl bg-[#090806] shadow-2xl shadow-black/40 ring-1 ring-[#c7a35a]/25">
        <div className="flex items-center justify-between border-b border-[#c7a35a]/15 bg-[#0f0d0a] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-[#b45f45]" />
            <span className="h-3 w-3 rounded-full bg-[#c7a35a]" />
            <span className="h-3 w-3 rounded-full bg-[#7fb7a3]" />
          </div>
          <p className="text-xs font-bold text-[#a69068]">ARX Command Center</p>
        </div>

        <div className="grid bg-[#f5efe4] lg:grid-cols-[0.72fr_1.28fr]">
          <aside className="border-b border-[#d8c8aa] bg-[#eee4d3] p-5 lg:border-b-0 lg:border-r">
            <p className="text-xs font-bold uppercase text-[#75613d]">Today</p>
            <h3 className="mt-2 text-2xl font-black leading-tight text-[#15110b]">Sales and ops queue</h3>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {outcomes.slice(0, 2).map(([value, label]) => (
                <div key={label} className="rounded-lg bg-[#fffbf3] p-4 shadow-sm ring-1 ring-[#d8c8aa]">
                  <p className="text-2xl font-black text-[#15110b]">{value}</p>
                  <p className="mt-1 text-xs font-semibold text-[#75613d]">{label}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 overflow-hidden rounded-xl ring-1 ring-[#d8c8aa]">
              <div className="relative h-44">
                <Image
                  src="/landing/field-file-hero.png"
                  alt="Roofing paperwork, measurements, and a phone on a truck tailgate"
                  fill
                  priority
                  sizes="(min-width: 1024px) 320px, 90vw"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-[#15110b]/15" />
              </div>
            </div>
          </aside>

          <div className="p-5">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {['Leads', 'Sales', 'Field', 'Ops', 'Finance'].map((tab, index) => (
                <span
                  key={tab}
                  className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-black ${
                    index === 2 ? 'bg-[#15110b] text-[#f7efe1]' : 'bg-[#eadcc4] text-[#75613d]'
                  }`}
                >
                  {tab}
                </span>
              ))}
            </div>

            <div className="mt-5 space-y-3">
              {pipelineRows.map(([customer, stage, amount, signal], index) => (
                <div key={customer} className="rounded-xl border border-[#d8c8aa] bg-[#fffbf3] p-4 shadow-sm shadow-black/5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex gap-3">
                      <span className={`mt-1 h-3 w-3 flex-none rounded-full ${index === 0 ? 'bg-[#c7a35a]' : index === 1 ? 'bg-[#7fb7a3]' : 'bg-[#b45f45]'}`} />
                      <div>
                        <p className="font-black leading-5 text-[#15110b]">{customer}</p>
                        <p className="mt-1 text-sm font-semibold text-[#75613d]">{stage}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-[#f1e5cf] px-3 py-1.5 text-xs font-black text-[#75613d]">{signal}</span>
                      <span className="text-sm font-black text-[#15110b]">{amount}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-xl bg-[#15110b] p-5 text-[#f7efe1]">
              <p className="text-xs font-black uppercase text-[#c7a35a]">Next best move</p>
              <p className="mt-2 text-xl font-black leading-7">Confirm the job notes before the 4:30 appointment.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#090806] text-[#f7efe1]">
      <header className="sticky top-0 z-50 border-b border-[#c7a35a]/15 bg-[#090806]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="ARX home">
            <span className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-[#15110b] ring-1 ring-[#c7a35a]/30">
              <Image src="/brand/arx-shield.png" alt="" fill sizes="44px" className="object-cover" />
            </span>
            <span>
              <span className="block text-base font-black leading-none text-[#f7efe1]">ARX</span>
              <span className="mt-1 block text-xs font-bold text-[#a69068]">Operating system for trade shops</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
            <a href="#platform" className="text-sm font-bold text-[#b9a47d] transition hover:text-[#f7efe1]">Platform</a>
            <a href="#canvass" className="text-sm font-bold text-[#b9a47d] transition hover:text-[#f7efe1]">Canvass</a>
            <a href="#walkthrough" className="text-sm font-bold text-[#b9a47d] transition hover:text-[#f7efe1]">Walkthrough</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden text-sm font-bold text-[#b9a47d] transition hover:text-[#f7efe1] sm:inline">
              Sign in
            </Link>
            <Link href="/trial" className="inline-flex items-center justify-center rounded-full bg-[#c7a35a] px-5 py-2.5 text-sm font-black text-[#15110b] transition hover:bg-[#d8b96f]">
              Get a walkthrough
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(199,163,90,0.22),transparent_32%),linear-gradient(180deg,#090806_0%,#15110b_58%,#090806_100%)]">
        <div className="mx-auto grid min-w-0 max-w-7xl gap-12 px-5 pb-20 pt-14 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:pb-28 lg:pt-20">
          <div className="flex min-w-0 flex-col justify-center">
            <div className="mb-6 inline-flex w-full max-w-full items-center justify-center rounded-full bg-[#c7a35a]/10 px-4 py-2 text-center text-sm font-black text-[#d8b96f] ring-1 ring-[#c7a35a]/25 sm:w-fit">
              Built for field sales and service teams
            </div>
            <h1 className="max-w-4xl text-4xl font-black leading-[1.04] text-[#fff8ea] sm:text-6xl sm:leading-none lg:text-7xl">
              Run every job from first knock to final payment.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#cfc2aa]">
              ARX brings canvassing, leads, appointments, estimates, contracts, job packets, costs, invoices, and owner visibility into one polished operating system for local trade businesses.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/trial" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#c7a35a] px-7 py-4 text-base font-black text-[#15110b] shadow-lg shadow-black/20 transition hover:bg-[#d8b96f]">
                Request a walkthrough
                <ArrowIcon />
              </Link>
              <a href="#canvass" className="inline-flex items-center justify-center rounded-full border border-[#c7a35a]/30 bg-white/[0.03] px-7 py-4 text-base font-black text-[#f7efe1] transition hover:border-[#c7a35a]">
                See canvassing
              </a>
            </div>
            <div className="mt-10 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
              {outcomes.map(([value, label]) => (
                <div key={label} className="border-l border-[#c7a35a]/30 pl-4">
                  <p className="text-2xl font-black text-[#fff8ea]">{value}</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-[#a69068] sm:text-sm">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section id="canvass" className="border-y border-[#c7a35a]/15 bg-[#120f0b] px-5 py-10 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-black uppercase text-[#c7a35a]">Included field app</p>
            <h2 className="mt-3 text-3xl font-black leading-tight text-[#fff8ea] md:text-4xl">
              Canvassing feeds the same CRM.
            </h2>
            <p className="mt-4 text-base leading-7 text-[#cfc2aa]">
              Reps can drop pins, tag door outcomes, and move hot leads toward scheduled appointments without creating a separate field data silo.
            </p>
          </div>
          <div className="grid gap-4 lg:min-w-[520px]">
            <div className="overflow-hidden rounded-2xl bg-[#070604] shadow-2xl shadow-black/30 ring-1 ring-[#c7a35a]/20">
              <div className="relative aspect-[16/10]">
                <Image
                  src="/landing/canvass-device-mockup.png"
                  alt="Tablet showing a map-first canvassing app interface"
                  fill
                  unoptimized
                  sizes="(min-width: 1024px) 520px, 100vw"
                  className="object-cover"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
            {['Map-first pins', 'Go-backs', 'Appointment handoff'].map((item) => (
              <div key={item} className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-[#c7a35a]/15">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-[#c7a35a] text-[#15110b]">
                  <CheckIcon />
                </div>
                <p className="font-black text-[#f7efe1]">{item}</p>
              </div>
            ))}
            </div>
          </div>
        </div>
      </section>

      <section id="platform" className="bg-[#090806] px-5 py-16 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[0.74fr_1.26fr] lg:items-end">
            <div>
              <p className="text-sm font-black uppercase text-[#c7a35a]">All-in-one platform</p>
              <h2 className="mt-4 text-4xl font-black leading-tight text-[#fff8ea] md:text-5xl">
                Replace scattered tools with one job record everyone trusts.
              </h2>
            </div>
            <p className="max-w-3xl text-lg leading-8 text-[#cfc2aa]">
              ARX is workflow software for the whole shop: field activity, front office clarity, rep context, production handoffs, and owner numbers under one roof.
            </p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {features.map((feature) => (
              <article key={feature.title} className="rounded-2xl bg-[#1a1510] p-7 shadow-xl shadow-black/15 ring-1 ring-[#c7a35a]/15">
                <p className="text-sm font-black uppercase text-[#c7a35a]">{feature.eyebrow}</p>
                <h3 className="mt-4 text-2xl font-black leading-8 text-[#fff8ea]">{feature.title}</h3>
                <p className="mt-4 text-base leading-7 text-[#cfc2aa]">{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-[#c7a35a]/15 bg-[#120f0b] px-5 py-16 lg:px-8 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <p className="text-sm font-black uppercase text-[#c7a35a]">Built to scale cleanly</p>
            <h2 className="mt-4 text-4xl font-black leading-tight text-[#fff8ea] md:text-5xl">
              Growth feels better when sales and operations move together.
            </h2>
            <p className="mt-5 text-lg leading-8 text-[#cfc2aa]">
              More booked work only helps when your system can carry the details. ARX keeps the promise, packet, schedule, cost, and payment trail connected.
            </p>
          </div>
          <div className="rounded-3xl bg-[#17130d] p-6 text-[#f7efe1] shadow-2xl shadow-black/30 ring-1 ring-[#c7a35a]/20">
            <div className="grid gap-3 sm:grid-cols-2">
              {['Sales sees what operations can handle', 'Operations sees what was promised', 'Owners coach from daily numbers', 'Custom workflows fit the shop'].map((item) => (
                <div key={item} className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-[#c7a35a]/15">
                  <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-[#c7a35a] text-[#15110b]">
                    <CheckIcon />
                  </div>
                  <p className="text-base font-bold leading-6 text-[#f7efe1]">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="walkthrough" className="bg-[#090806] px-5 py-16 lg:px-8 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 rounded-3xl bg-[linear-gradient(135deg,#17130d_0%,#2a2115_55%,#10251f_100%)] p-6 text-[#f7efe1] shadow-2xl shadow-black/35 ring-1 ring-[#c7a35a]/20 lg:grid-cols-[1fr_0.82fr] lg:p-10">
          <div className="flex flex-col justify-center">
            <p className="text-sm font-black uppercase text-[#c7a35a]">Personalized walkthrough</p>
            <h2 className="mt-4 text-4xl font-black leading-tight text-[#fff8ea] md:text-5xl">
              First we learn the shop. Then we price the build.
            </h2>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-[#cfc2aa]">
              ARX is scoped around your actual handoffs, team structure, reports, forms, coaching needs, and any custom development that should be part of the rollout.
            </p>
            <Link href="/trial" className="mt-8 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-[#c7a35a] px-7 py-4 text-base font-black text-[#15110b] transition hover:bg-[#d8b96f]">
              Schedule a walkthrough
              <ArrowIcon />
            </Link>
          </div>

          <div className="rounded-2xl bg-[#f5efe4] p-5 text-[#15110b]">
            <div className="space-y-4">
              {walkthroughSteps.map((step, index) => (
                <div key={step} className="flex gap-4 rounded-xl bg-[#fffbf3] p-4 ring-1 ring-[#d8c8aa]">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[#15110b] text-sm font-black text-[#f7efe1]">
                    {index + 1}
                  </span>
                  <p className="pt-1 text-base font-bold leading-6 text-[#332817]">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#c7a35a]/15 bg-[#090806] px-5 py-8 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <p className="text-sm font-bold text-[#a69068]">ARX CRM for trade businesses</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold text-[#a69068]">
            <a href="#platform" className="hover:text-[#f7efe1]">Platform</a>
            <a href="#canvass" className="hover:text-[#f7efe1]">Canvass</a>
            <Link href="/terms" className="hover:text-[#f7efe1]">Terms</Link>
            <Link href="/privacy" className="hover:text-[#f7efe1]">Privacy</Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
