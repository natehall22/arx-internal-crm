import * as React from 'react'

export type PortalCompany = { name: string; phone: string; email: string; logoHref: string | null }

/** The company's own header (logo + name) on every portal screen. Never the product name. Text is dark on white for sun and age. */
export default function PortalShell({ company, children, wide = false, signOut = false }: { company: PortalCompany; children: React.ReactNode; wide?: boolean; signOut?: boolean }) {
  const contact = [company.phone, company.email].filter(Boolean).join(' · ')
  return (
    <main className="min-h-[100dvh] bg-[#f7f6f2] px-3 py-5 text-[#2c2c2a]">
      <div className={`mx-auto ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <header className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {company.logoHref ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoHref} alt="" className="h-12 w-auto max-w-[140px] object-contain" />
            ) : null}
            <span className="truncate text-lg font-bold">{company.name}</span>
          </div>
          {signOut ? (
            <form method="post" action="/api/portal/logout">
              <button type="submit" className="min-h-[44px] px-2 text-base font-semibold underline">
                Sign out
              </button>
            </form>
          ) : null}
        </header>
        {children}
        {contact ? <p className="mt-6 text-center text-base">Questions? {contact}</p> : null}
      </div>
    </main>
  )
}

export function Panel({ title, children, id }: { title?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="mb-4 rounded-2xl border border-[#e5e3dc] bg-white p-4 shadow-sm">
      {title ? <h2 className="mb-3 text-xl font-bold">{title}</h2> : null}
      {children}
    </section>
  )
}
