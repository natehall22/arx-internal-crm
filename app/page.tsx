import Image from 'next/image'
import Link from 'next/link'

const operatingRows = [
  {
    label: 'New roof claim',
    owner: 'Inside sales',
    status: 'Qualified',
    value: '$18.4k',
    accent: 'bg-cyan-500',
  },
  {
    label: 'Storm follow-up',
    owner: 'Setter team',
    status: 'Booked',
    value: '$11.9k',
    accent: 'bg-amber-400',
  },
  {
    label: 'Signed install',
    owner: 'Ops',
    status: 'Ready',
    value: '$24.7k',
    accent: 'bg-emerald-500',
  },
]

const capabilities = [
  'Lead',
  'Visit',
  'Scope',
  'Contract',
  'Packet',
  'Install',
]

const principles = [
  {
    title: 'Built around how the shop already works',
    body: 'ARX starts with the calls, whiteboards, field photos, paper notes, and handoffs your team already depends on, then custom development fills the gaps during setup.',
  },
  {
    title: 'Less chasing for the office',
    body: 'Follow-ups, files, customer history, and next steps sit together so the office is not rebuilding the story all day.',
  },
  {
    title: 'Software plus real coaching',
    body: 'For shops that want it, plan subscriptions can include business coaching around sales process, follow-up discipline, and cleaner operations.',
  },
]

const planDetails = [
  {
    label: 'Custom setup',
    detail: 'We shape the CRM around your shop, your team, your paperwork, and your handoffs.',
  },
  {
    label: 'Custom development',
    detail: 'When a setup needs a workflow, report, form, or handoff that does not exist yet, we can build it into the engagement.',
  },
  {
    label: 'Business coaching',
    detail: 'Optional coaching plans help owners understand costs, tighten sales habits, clean up operations, and build a healthier company.',
  },
]

const growthFoundations = [
  {
    label: 'Know the real cost',
    detail: 'Track materials, labor, subs, commissions, deposits, and job expenses so pricing is not built on a gut feeling.',
  },
  {
    label: 'See what is profitable',
    detail: 'Compare sold work against actual job costs so owners can spot which services, crews, and lead sources are worth scaling.',
  },
  {
    label: 'Grow without chaos',
    detail: 'Scale sales and operations together so more booked work does not bury the office, the crews, or the owner.',
  },
]

const teamScale = [
  'Sales knows what ops can handle',
  'Ops sees what was promised before the job lands',
  'Owners can coach the whole system, not just one department',
  'Growth decisions come from numbers, not pressure',
]

const proof = [
  ['< 60 sec', 'lead routing target'],
  ['1 record', 'from inquiry to job'],
  ['Live view', 'sales, office, and ops'],
]

function ArrowIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M3.5 10a1 1 0 0 1 1-1h8.09l-2.8-2.8a1 1 0 1 1 1.42-1.4l4.5 4.5a1 1 0 0 1 0 1.4l-4.5 4.5a1 1 0 0 1-1.42-1.4l2.8-2.8H4.5a1 1 0 0 1-1-1Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function ProductSignal() {
  return (
    <div className="relative bg-slate-950 p-3 shadow-2xl shadow-slate-950/20">
      <div className="absolute -right-3 top-8 hidden bg-[#9b3f2f] px-4 py-2 text-xs font-black uppercase text-white lg:block">
        Shop file
      </div>

      <div className="border border-slate-800 bg-[#f7f3ea]">
        <div className="relative h-64 overflow-hidden border-b border-slate-800 sm:h-72">
          <Image
            src="/landing/field-file-hero.png"
            alt="Roofing job paperwork, measurements, and a phone on a truck tailgate"
            fill
            priority
            sizes="(min-width: 1024px) 720px, 100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/65 via-slate-950/10 to-transparent" />
          <div className="absolute bottom-5 left-5 max-w-sm text-white">
            <p className="text-xs font-black uppercase text-amber-200">Real shop rhythm</p>
            <p className="mt-2 text-2xl font-black leading-7">Paperwork, phone calls, field notes, one living record.</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-[0.78fr_1.22fr]">
          <aside className="border-b border-slate-300 bg-[#e9dcc1] p-5 lg:border-b-0 lg:border-r">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase text-slate-600">Today&apos;s job file</p>
                <h3 className="mt-3 text-4xl font-black leading-none text-slate-950">Cullingford Lane</h3>
              </div>
              <span className="border-2 border-[#9b3f2f] px-3 py-2 text-xs font-black uppercase text-[#9b3f2f]">
                Booked
              </span>
            </div>

            <div className="mt-8 grid gap-3">
              {proof.map(([value, label]) => (
                <div key={label} className="border border-slate-300 bg-[#f7f3ea] p-4">
                  <p className="text-3xl font-black text-slate-950">{value}</p>
                  <p className="mt-1 text-xs font-bold text-slate-600">{label}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 border-t border-slate-400 pt-5">
              <p className="text-xs font-black uppercase text-slate-600">No loose ends</p>
              <p className="mt-3 text-base font-bold leading-7 text-slate-800">
                The customer story moves as one file, from first call to install packet, with room for custom setup and coaching where the shop needs it.
              </p>
            </div>
          </aside>

          <div className="bg-white">
            <div className="grid grid-cols-3 border-b border-slate-200">
              {capabilities.map((item) => (
                <div key={item} className="border-r border-slate-200 px-3 py-3 text-center text-xs font-black uppercase text-slate-600 last:border-r-0 lg:px-4">
                  {item}
                </div>
              ))}
            </div>

            <div className="p-5">
              <div className="grid gap-4">
                {operatingRows.map((row) => (
                  <div key={row.label} className="grid gap-4 border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5 sm:grid-cols-[1fr_auto]">
                    <div className="flex gap-4">
                      <span className={`mt-1 h-4 w-4 flex-none ${row.accent}`} />
                      <div>
                        <p className="text-lg font-black leading-6 text-slate-950">{row.label}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-500">{row.owner}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 sm:justify-end">
                      <span className="bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700">{row.status}</span>
                      <span className="text-sm font-black text-slate-950">{row.value}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.86fr]">
                <div className="border border-slate-200 bg-slate-950 p-5 text-white">
                  <p className="text-xs font-black uppercase text-cyan-200">Next move</p>
                  <p className="mt-3 text-2xl font-black leading-8">Confirm roof measurements before the 4:30 visit.</p>
                  <div className="mt-6 h-2 bg-slate-800">
                    <div className="h-2 w-[74%] bg-amber-400" />
                  </div>
                  <p className="mt-3 text-xs font-semibold text-slate-400">Ops packet readiness: 74%</p>
                </div>

                <div className="border border-slate-200 bg-[#f7f3ea] p-5">
                  <p className="text-xs font-black uppercase text-slate-600">Handoff trail</p>
                  <div className="mt-5 space-y-4">
                    {['Call logged', 'Setter assigned', 'Visit brief drafted', 'Photos requested'].map((item) => (
                      <div key={item} className="flex items-center gap-3">
                        <span className="h-2.5 w-2.5 bg-[#9b3f2f]" />
                        <p className="text-sm font-bold text-slate-700">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
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
    <main className="min-h-screen bg-[#f7f3ea] text-slate-950">
      <header className="sticky top-0 z-50 border-b border-slate-900/10 bg-[#f7f3ea]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="ARX home">
            <span className="flex h-10 w-10 items-center justify-center bg-slate-950 text-base font-black text-white">
              A
            </span>
            <span>
              <span className="block text-base font-black leading-none text-slate-950">ARX</span>
              <span className="mt-1 block text-xs font-bold text-slate-500">CRM for service shops</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 md:flex" aria-label="Main navigation">
            <a href="#platform" className="text-sm font-bold text-slate-600 transition hover:text-slate-950">Platform</a>
            <a href="#fit" className="text-sm font-bold text-slate-600 transition hover:text-slate-950">Fit</a>
            <a href="#presentation" className="text-sm font-bold text-slate-600 transition hover:text-slate-950">Presentation</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden text-sm font-bold text-slate-600 transition hover:text-slate-950 sm:inline">
              Sign in
            </Link>
            <Link
              href="/trial"
              className="bg-slate-950 px-4 py-2.5 text-sm font-black text-white transition hover:bg-slate-800"
            >
              Schedule presentation
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-slate-900/10">
        <div className="absolute inset-x-0 top-0 h-24 bg-[#e9dcc1]" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-14 lg:grid-cols-[0.86fr_1.14fr] lg:px-8 lg:pb-20 lg:pt-20">
          <div className="flex flex-col justify-center">
            <p className="mb-5 max-w-xl text-sm font-black uppercase text-[#9b3f2f]">
              For owner-operated service shops
            </p>
            <h1 className="max-w-3xl text-5xl font-black leading-none text-slate-950 sm:text-6xl lg:text-7xl">
              Run the day without running it from memory.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-700 sm:text-xl">
              ARX gives small service companies one practical place for the calls, estimates, field notes, photos, contracts, job costs, and expenses that usually get spread across phones, paper, and somebody&apos;s head.
            </p>
            <p className="mt-4 max-w-2xl text-base font-bold leading-7 text-slate-700">
              Setup can include custom development, and some plans include business coaching for owners who want help understanding their numbers and scaling sales and operations together as one team.
            </p>
            <p className="mt-6 max-w-2xl text-2xl font-black leading-8 text-slate-950">
              A business is only as strong as the systems it runs on.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/trial"
                className="inline-flex items-center justify-center gap-2 bg-slate-950 px-6 py-4 text-base font-black text-white transition hover:bg-slate-800"
              >
                Walk through your shop
                <ArrowIcon />
              </Link>
              <a
                href="#platform"
                className="inline-flex items-center justify-center border border-slate-300 bg-white px-6 py-4 text-base font-black text-slate-950 transition hover:border-slate-950"
              >
                See the field file
              </a>
            </div>

            <div className="mt-10 max-w-xl border-l-4 border-[#9b3f2f] pl-5">
              <p className="text-sm font-bold leading-6 text-slate-600">
                It should feel familiar on day one: the same job jacket your team already understands, only live, searchable, and harder to lose.
              </p>
            </div>
          </div>

          <div className="relative">
            <ProductSignal />
          </div>
        </div>
      </section>

      <section id="platform" className="bg-white px-5 py-16 lg:px-8 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-black uppercase text-cyan-700">What it replaces</p>
            <h2 className="mt-4 text-4xl font-black leading-tight text-slate-950 md:text-5xl">
              Less spreadsheet cleanup. Fewer missed callbacks. No mystery handoffs.
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {principles.map((item) => (
              <article key={item.title} className="border border-slate-200 bg-white p-6">
                <h3 className="text-xl font-black leading-7 text-slate-950">{item.title}</h3>
                <p className="mt-4 text-base leading-7 text-slate-600">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="fit" className="border-y border-slate-900/10 bg-slate-950 px-5 py-16 text-white lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
          <h2 className="text-4xl font-black leading-tight md:text-5xl">
            Built for shops where everyone wears three hats and the phone never really stops.
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              'Roofing, restoration, HVAC, plumbing, and trade teams',
              'Office managers keeping calls and schedules straight',
              'Owners who need to know what happened today',
              'Field crews handing off signed work cleanly',
            ].map((item) => (
              <div key={item} className="border border-white/10 bg-white/[0.06] p-5">
                <p className="text-base font-bold leading-6 text-slate-100">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#e9dcc1] px-5 py-16 lg:px-8 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <div>
            <p className="text-sm font-black uppercase text-[#9b3f2f]">Built for sustainable growth</p>
            <h2 className="mt-4 text-4xl font-black leading-tight text-slate-950 md:text-5xl">
              A lot of shops are growing without knowing what the work really costs.
            </h2>
            <p className="mt-5 text-lg font-bold leading-8 text-slate-700">
              ARX is designed to help owners get out of guesswork: cleaner numbers, cleaner process, and stronger systems for a business where sales growth and operational capacity move together.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {growthFoundations.map((item) => (
              <article key={item.label} className="border border-slate-900/10 bg-white p-6">
                <p className="text-sm font-black uppercase text-[#9b3f2f]">{item.label}</p>
                <p className="mt-4 text-base font-bold leading-7 text-slate-700">{item.detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white px-5 py-16 lg:px-8 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div>
            <p className="text-sm font-black uppercase text-[#9b3f2f]">Not one-size-fits-all</p>
            <h2 className="mt-4 text-4xl font-black leading-tight text-slate-950 md:text-5xl">
              The plan can include the build, the numbers, and the coaching.
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {planDetails.map((item) => (
              <article key={item.label} className="border border-slate-200 bg-[#f7f3ea] p-6">
                <p className="text-sm font-black uppercase text-slate-500">{item.label}</p>
                <p className="mt-4 text-lg font-black leading-7 text-slate-950">{item.detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-slate-900/10 bg-slate-950 px-5 py-16 text-white lg:px-8 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div>
            <p className="text-sm font-black uppercase text-amber-300">Sales and operations together</p>
            <h2 className="mt-4 text-4xl font-black leading-tight md:text-5xl">
              More sales only works when the systems can carry them.
            </h2>
            <p className="mt-5 text-lg font-bold leading-8 text-slate-300">
              ARX helps owners connect demand, scheduling, estimating, job packets, materials, crews, and cost tracking so growth does not turn into daily firefighting.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {teamScale.map((item) => (
              <div key={item} className="border border-white/10 bg-white/[0.06] p-5">
                <p className="text-base font-bold leading-6 text-slate-100">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="presentation" className="bg-[#f7f3ea] px-5 py-16 lg:px-8 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_0.86fr] lg:items-end">
          <div>
            <p className="text-sm font-black uppercase text-[#9b3f2f]">The next step</p>
            <h2 className="mt-4 text-4xl font-black leading-tight text-slate-950 md:text-5xl">
              First we learn the shop. Then we price the build.
            </h2>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-700">
              The presentation is a working session. We look at how leads come in, who answers, who schedules, what the field needs, where jobs get stuck, how sales and operations work together, what the owner knows about costs and expenses, and whether coaching or custom development belongs in the plan. Then ARX is scoped around that reality.
            </p>
          </div>

          <div className="border border-slate-300 bg-white p-6">
            <div className="space-y-5">
              {[
                'Map how calls, texts, and web leads come in',
                'Find the handoffs that cause callbacks or confusion',
                'Connect sales promises to operational capacity',
                'Scope custom development and coaching only where useful',
              ].map((item, index) => (
                <div key={item} className="flex gap-4">
                  <span className="flex h-8 w-8 flex-none items-center justify-center bg-slate-950 text-sm font-black text-white">
                    {index + 1}
                  </span>
                  <p className="pt-1 text-base font-bold leading-6 text-slate-700">{item}</p>
                </div>
              ))}
            </div>
            <Link
              href="/trial"
              className="mt-8 inline-flex w-full items-center justify-center gap-2 bg-[#9b3f2f] px-6 py-4 text-base font-black text-white transition hover:bg-[#823326]"
            >
              Schedule a walkthrough
              <ArrowIcon />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-900/10 bg-white px-5 py-8 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <p className="text-sm font-bold text-slate-600">ARX CRM for service shops</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold text-slate-500">
            <a href="#platform" className="hover:text-slate-950">Platform</a>
            <a href="#fit" className="hover:text-slate-950">Fit</a>
            <Link href="/privacy" className="hover:text-slate-950">Privacy</Link>
            <Link href="/terms" className="hover:text-slate-950">Terms</Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
