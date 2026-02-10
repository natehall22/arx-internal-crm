import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <div className="text-lg font-semibold tracking-wide">ARX Roofing & Exteriors</div>
          <Link
            href="/login"
            className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-200"
          >
            Login
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-slate-400">
              Internal CRM
            </p>
            <h1 className="mt-4 text-4xl font-bold leading-tight sm:text-5xl">
              One place to manage leads, projects, and estimates.
            </h1>
            <p className="mt-4 text-lg text-slate-300">
              Track your pipeline, stay on top of project status, and generate estimates
              without jumping between tools.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/login"
                className="rounded-md bg-indigo-500 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-400"
              >
                Get started
              </Link>
              <Link
                href="/dashboard"
                className="rounded-md border border-slate-700 px-5 py-3 text-sm font-semibold text-white hover:border-slate-500"
              >
                Go to dashboard
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8">
            <div className="grid gap-6">
              <div>
                <h3 className="text-lg font-semibold">Pipeline visibility</h3>
                <p className="mt-2 text-sm text-slate-300">
                  See lead and project status at a glance with live counts and recent activity.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Estimate control</h3>
                <p className="mt-2 text-sm text-slate-300">
                  Build estimates from pricebooks, apply adjustments, and export PDFs fast.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Team alignment</h3>
                <p className="mt-2 text-sm text-slate-300">
                  Keep notes, activity, and files tied to each lead and project.
                </p>
              </div>
            </div>
          </div>
        </div>

        <section className="mt-16 grid gap-6 md:grid-cols-3">
          {[
            { label: 'Leads', value: 'Organized by status' },
            { label: 'Projects', value: 'Progress tracked daily' },
            { label: 'Customers', value: 'Details in one place' },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <p className="text-sm uppercase tracking-wide text-slate-400">{item.label}</p>
              <p className="mt-2 text-lg font-semibold text-white">{item.value}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}
