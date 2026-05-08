import Link from 'next/link'

const metrics = [
  { label: 'Speed to lead', value: '< 60s', detail: 'Route every new lead before momentum dies.' },
  { label: 'Field visibility', value: 'Live', detail: 'See teams, visits, and opportunities in one place.' },
  { label: 'Revenue handoff', value: '1 flow', detail: 'Move from inquiry to quote to job without re-entry.' },
]

const pipelineSteps = [
  { label: 'Lead captured', value: 'Website, phone, or ad source', tone: 'bg-sky-500' },
  { label: 'Owner assigned', value: 'Round robin: best-fit team', tone: 'bg-emerald-500' },
  { label: 'Visit booked', value: 'Today, 4:30 PM', tone: 'bg-amber-400' },
  { label: 'Estimate ready', value: 'Photos, notes, scope, history', tone: 'bg-rose-500' },
]

const features = [
  {
    title: 'Canvassing that managers can trust',
    description: 'Map territories, capture field activity, and keep every opportunity tied to the rep, team, source, and next action.',
  },
  {
    title: 'Scheduling built for service teams',
    description: 'Book visits into real availability, protect drive time, and keep office, sales, and field teams aligned automatically.',
  },
  {
    title: 'Outcome feedback without the chase',
    description: 'Your team logs results from the field so managers know what moved, what stalled, and what needs attention next.',
  },
  {
    title: 'Proposals, contracts, and jobs connected',
    description: 'Keep scope, photos, measurements, contracts, invoices, and operations context moving with the customer record.',
  },
]

const roles = [
  {
    role: 'Owners',
    promise: 'Know what is happening before the end-of-day meeting.',
    points: ['Revenue pipeline by source', 'Team performance trends', 'Job and fulfillment visibility'],
  },
  {
    role: 'Sales managers',
    promise: 'Coach from real behavior, not scattered updates.',
    points: ['Rep and estimator scorecards', 'Open follow-up queues', 'Calendar and attribution clarity'],
  },
  {
    role: 'Field teams',
    promise: 'Move fast from the driveway without fighting software.',
    points: ['Mobile field workflow', 'One-tap lead updates', 'Instant handoff notifications'],
  },
]

const outcomes = [
  'Fewer forgotten follow-ups',
  'Cleaner office-to-field handoffs',
  'Less spreadsheet cleanup',
  'Faster job intake after a signed agreement',
  'Custom reporting around your process',
  'A team that can see the same truth',
]

const serviceTypes = ['HVAC', 'Roofing', 'Restoration', 'Plumbing', 'Electrical', 'Solar', 'Windows', 'Landscaping']

function CheckIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.31a1 1 0 0 1-1.42.002L3.29 9.206a1 1 0 1 1 1.42-1.408l4.04 4.09 6.54-6.592a1 1 0 0 1 1.414-.006Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function ArrowIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M3 10a1 1 0 0 1 1-1h9.586l-3.293-3.293a1 1 0 1 1 1.414-1.414l5 5a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414-1.414L13.586 11H4a1 1 0 0 1-1-1Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function ProductPreview() {
  return (
    <div className="relative overflow-hidden rounded-lg border border-white/15 bg-slate-950 shadow-2xl shadow-cyan-500/20 ring-1 ring-cyan-300/10">
      <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-8 h-56 w-56 rounded-full bg-amber-300/20 blur-3xl" />
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </div>
        <span className="text-xs font-medium text-slate-400">ARX command center</span>
      </div>

      <div className="grid gap-0 md:grid-cols-[0.9fr_1.35fr]">
        <div className="border-b border-slate-800 bg-slate-900/70 p-5 md:border-b-0 md:border-r">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Today</p>
              <h3 className="mt-1 text-lg font-semibold text-white">Revenue lane</h3>
            </div>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
              Live
            </span>
          </div>

          <div className="space-y-3">
            {pipelineSteps.map((step) => (
              <div key={step.label} className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${step.tone}`} />
                  <p className="text-sm font-semibold text-white">{step.label}</p>
                </div>
                <p className="mt-2 text-sm text-slate-400">{step.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[radial-gradient(circle_at_25%_20%,rgba(251,191,36,0.14),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(56,189,248,0.16),transparent_26%),linear-gradient(135deg,#020617,#111827)] p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['New leads', '27', '+9 today'],
              ['Visits', '14', '6 need briefs'],
              ['Open value', '$486k', 'active pipeline'],
            ].map(([label, value, detail]) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
                <p className="text-xs text-slate-400">{label}</p>
                <p className="mt-2 text-2xl font-bold text-white">{value}</p>
                <p className="mt-1 text-xs text-emerald-200">{detail}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.06] p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Team heat map</p>
                <p className="text-xs text-slate-400">Leads, visits, estimates, and booked jobs</p>
              </div>
              <span className="text-xs font-medium text-amber-200">Active market</span>
            </div>
            <div className="relative h-52 overflow-hidden rounded-lg bg-slate-900">
              <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(148,163,184,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.2)_1px,transparent_1px)] [background-size:32px_32px]" />
              {[
                ['left-[18%] top-[24%] bg-emerald-400', 'Booked'],
                ['left-[42%] top-[36%] bg-amber-300', 'Follow-up'],
                ['left-[68%] top-[22%] bg-sky-400', 'New'],
                ['left-[56%] top-[66%] bg-rose-400', 'Hot'],
                ['left-[24%] top-[70%] bg-emerald-400', 'Booked'],
              ].map(([position, label]) => (
                <div key={`${position}-${label}`} className={`absolute ${position}`}>
                  <span className="relative flex h-4 w-4">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-25" />
                    <span className={`relative inline-flex h-4 w-4 rounded-full ${position.split(' ').at(-1)}`} />
                  </span>
                </div>
              ))}
              <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-white/10 bg-slate-950/80 p-3 backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Next best action</p>
                <p className="mt-1 text-sm font-medium text-white">Send estimate brief before the 4:30 customer visit.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-950">
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-400 text-lg font-black text-slate-950 shadow-lg shadow-amber-400/25">
              A
            </div>
            <div>
              <p className="text-base font-black leading-none tracking-tight text-white">ARX</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Service Growth OS</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 md:flex">
            <a href="#platform" className="text-sm font-semibold text-slate-300 transition hover:text-white">Platform</a>
            <a href="#teams" className="text-sm font-semibold text-slate-300 transition hover:text-white">Teams</a>
            <a href="#outcomes" className="text-sm font-semibold text-slate-300 transition hover:text-white">Outcomes</a>
            <a href="#demo" className="text-sm font-semibold text-slate-300 transition hover:text-white">Presentation</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden text-sm font-bold text-slate-300 transition hover:text-white sm:inline">
              Sign in
            </Link>
            <Link
              href="/trial"
              className="rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-black text-slate-950 shadow-sm shadow-amber-300/40 transition hover:bg-amber-300"
            >
              Schedule presentation
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden pt-28 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(251,191,36,0.28),transparent_24%),radial-gradient(circle_at_82%_24%,rgba(34,211,238,0.26),transparent_28%),linear-gradient(125deg,#020617_0%,#0f172a_44%,#111827_100%)]" />
        <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="absolute -left-24 top-32 h-96 w-96 rounded-full bg-amber-300/20 blur-3xl" />
        <div className="absolute -right-24 bottom-10 h-[34rem] w-[34rem] rounded-full bg-cyan-300/20 blur-3xl" />

        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-10 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:pb-24 lg:pt-16">
          <div className="flex flex-col justify-center">
            <div className="mb-6 inline-flex w-fit items-center gap-3 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-cyan-100 shadow-sm backdrop-blur">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/70" />
              Custom-built for service companies that sell in the field
            </div>
            <h1 className="max-w-4xl text-5xl font-black leading-[0.92] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Own every lead from first call to finished job.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-200 sm:text-xl">
              ARX helps service businesses install a custom CRM around the way they actually sell, schedule, estimate, dispatch, fulfill, and follow up.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {serviceTypes.map((type) => (
                <span key={type} className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-white/85">
                  {type}
                </span>
              ))}
            </div>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/trial"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-6 py-4 text-base font-black text-slate-950 shadow-xl shadow-amber-400/25 transition hover:bg-amber-300"
              >
                Schedule a custom setup call
                <ArrowIcon />
              </Link>
              <a
                href="#demo"
                className="inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/10 px-6 py-4 text-base font-black text-white backdrop-blur transition hover:bg-white/15"
              >
                See how pricing works
              </a>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded-lg border border-white/15 bg-white/10 p-4 shadow-sm backdrop-blur">
                  <p className="text-2xl font-black text-white">{metric.value}</p>
                  <p className="mt-1 text-sm font-bold text-cyan-100">{metric.label}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-300">{metric.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative lg:pt-8">
            <div className="absolute -left-6 top-0 hidden rotate-[-5deg] rounded-lg border border-amber-300/40 bg-amber-300 px-4 py-3 text-sm font-black text-slate-950 shadow-2xl shadow-amber-300/20 lg:block">
              Custom setup, not a template
            </div>
            <div className="absolute -right-4 bottom-8 z-10 hidden rotate-[4deg] rounded-lg border border-cyan-300/30 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 shadow-2xl shadow-cyan-300/20 lg:block">
              Pricing by presentation
            </div>
            <ProductPreview />
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white px-5 py-8 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-[0.8fr_1.2fr] md:items-center">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">The expensive problem</p>
          <p className="text-2xl font-black leading-tight text-slate-950 md:text-3xl">
            Most service companies do not need another generic CRM. They need a custom operating system that matches how their customers, crews, sales team, and jobs actually move.
          </p>
        </div>
      </section>

      <section id="platform" className="px-5 py-20 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-black uppercase tracking-[0.2em] text-sky-700">Platform</p>
            <h2 className="mt-4 text-4xl font-black tracking-tight text-slate-950 md:text-5xl">
              Designed around the way service revenue actually moves.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {features.map((feature, index) => (
              <div key={feature.title} className="rounded-lg border border-slate-200 bg-white p-7 shadow-sm">
                <div className="mb-8 flex h-11 w-11 items-center justify-center rounded-lg bg-slate-950 text-sm font-black text-white">
                  0{index + 1}
                </div>
                <h3 className="text-xl font-black text-slate-950">{feature.title}</h3>
                <p className="mt-3 text-base leading-7 text-slate-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="teams" className="bg-slate-950 px-5 py-20 text-white lg:px-8 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-300">For the whole team</p>
              <h2 className="mt-4 text-4xl font-black tracking-tight md:text-5xl">
                Everyone sees the same playbook.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-300">
                The promise is simple: stop asking five people for the status of one customer. ARX keeps each handoff visible and accountable.
              </p>
            </div>

            <div className="grid gap-4">
              {roles.map((role) => (
                <div key={role.role} className="rounded-lg border border-white/10 bg-white/[0.04] p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-black uppercase tracking-[0.18em] text-slate-400">{role.role}</p>
                      <h3 className="mt-2 text-2xl font-black text-white">{role.promise}</h3>
                    </div>
                    <div className="grid gap-2 sm:min-w-64">
                      {role.points.map((point) => (
                        <div key={point} className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                          <CheckIcon className="h-4 w-4 text-emerald-300" />
                          {point}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="outcomes" className="px-5 py-20 lg:px-8 lg:py-28">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-rose-700">What changes</p>
            <h2 className="mt-4 text-4xl font-black tracking-tight text-slate-950 md:text-5xl">
              Sell control, clarity, and a setup built around them.
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              Service-company buyers are not shopping for another dashboard. They are trying to stop revenue from slipping through messy handoffs. ARX starts with a scheduled presentation, then maps the platform to the customer's actual workflow.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {outcomes.map((outcome) => (
              <div key={outcome} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <CheckIcon className="mt-0.5 h-5 w-5 flex-none text-emerald-600" />
                <p className="font-bold leading-6 text-slate-800">{outcome}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="demo" className="px-5 pb-20 lg:px-8 lg:pb-28">
        <div className="mx-auto overflow-hidden rounded-lg bg-slate-950 text-white shadow-2xl shadow-slate-950/20">
          <div className="grid gap-0 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="p-8 sm:p-12 lg:p-16">
              <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-300">Ready for customers</p>
              <h2 className="mt-4 text-4xl font-black tracking-tight md:text-5xl">
                Pricing comes after the fit is clear.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-300">
                Every service company is different, so the next step is a scheduled presentation. We walk the customer through the platform, identify their custom setup, and price the engagement around their company.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/trial"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-6 py-4 text-base font-black text-slate-950 transition hover:bg-amber-300"
                >
                  Schedule presentation
                  <ArrowIcon />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-lg border border-white/20 px-6 py-4 text-base font-black text-white transition hover:bg-white/10"
                >
                  Sign in
                </Link>
              </div>
            </div>

            <div className="border-t border-white/10 bg-white/[0.04] p-8 sm:p-12 lg:border-l lg:border-t-0">
              <div className="rounded-lg border border-white/10 bg-slate-900 p-5">
                <p className="text-sm font-black uppercase tracking-[0.18em] text-slate-400">Demo agenda</p>
                <div className="mt-6 space-y-5">
                  {[
                    ['01', 'Understand the company, team, and lead sources'],
                    ['02', 'Map the sales, scheduling, and field workflow'],
                    ['03', 'Show the custom CRM setup that fits'],
                    ['04', 'Present pricing based on the actual scope'],
                  ].map(([number, label]) => (
                    <div key={number} className="flex gap-4">
                      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
                        {number}
                      </span>
                      <p className="pt-1.5 text-base font-semibold text-slate-200">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-5 py-10 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-lg font-black text-white">
              A
            </div>
            <div>
              <p className="font-black text-slate-950">ARX Service Growth OS</p>
              <p className="text-sm text-slate-500">Custom CRM setup for service companies.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-slate-500">
            <a href="#platform" className="hover:text-slate-950">Platform</a>
            <a href="#teams" className="hover:text-slate-950">Teams</a>
            <a href="#demo" className="hover:text-slate-950">Demo</a>
            <Link href="/privacy" className="hover:text-slate-950">Privacy</Link>
            <Link href="/terms" className="hover:text-slate-950">Terms</Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
