import type { ReactNode } from 'react'

/* Shared frame for the signed-out pages (/login, /reset-password).
   Palette matches the public landing page (app/page.tsx):
   night #1A1917 · gold #E2BF73 · cream #F6F1E7.
   Input text/background/autofill colors are pinned by `.login-dark` in globals.css. */

export const authLabelClass = 'block text-sm font-medium text-[#DDD6C8]'

export const authInputClass =
  'mt-2 block w-full rounded-lg border border-[#3A362F] px-3.5 py-3 transition focus:border-[#E2BF73] focus:outline-none focus:ring-2 focus:ring-[#E2BF73]/30'

export const authButtonClass =
  'w-full rounded-lg bg-[#E2BF73] px-4 py-3 text-[15px] font-semibold text-[#1A1917] transition hover:bg-[#EBCD8B] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E2BF73] focus-visible:ring-offset-2 focus-visible:ring-offset-[#211F1D] disabled:opacity-50'

export const authNoticeClass = {
  error: 'rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100',
  warning: 'rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100',
  success: 'rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100',
}

export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="login-dark relative min-h-screen overflow-hidden bg-[#1A1917] text-[#F6F1E7] antialiased">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 45% at 50% 0%, rgba(226,191,115,0.14), rgba(226,191,115,0) 70%)',
        }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <div className="mb-8 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/arx-mark-cream.png" alt="" width={48} height={60} className="h-[60px] w-auto" />
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#E2BF73]">
            ARX Roofing &amp; Exteriors
          </p>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-[#211F1D] p-6 shadow-2xl shadow-black/40 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-[#F6F1E7]">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-sm text-[#A49C8C]">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </div>

        {footer ? <div className="mt-6 text-center text-sm text-[#A49C8C]">{footer}</div> : null}
      </div>
    </div>
  )
}
