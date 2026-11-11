'use client'

import type { ReactNode } from 'react'

/** Shared bits of the project-tools cards: one card shell, plain status pills, money format. Dark text on light grounds. */

export const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
export const money0 = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

export type Tone = 'green' | 'amber' | 'red' | 'gray'
const TONES: Record<Tone, string> = {
  green: 'bg-[#dcfce7] text-[#14532d] border-[#86efac]',
  amber: 'bg-[#fef3c7] text-[#78350f] border-[#fcd34d]',
  red: 'bg-[#fee2e2] text-[#7f1d1d] border-[#fca5a5]',
  gray: 'bg-[#f1efe8] text-[#2c2c2a] border-[#d6d3ca]',
}

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold ${TONES[tone]}`}>{children}</span>
}

export function Card({ title, subtitle, action, children, testId }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[#2c2c2a] sm:text-lg">{title}</h2>
          {subtitle ? <p className="text-sm text-[#2c2c2a]">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export const btnPrimary = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[#1f2937] px-4 text-base font-semibold text-white disabled:opacity-60'
export const btnGhost = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#a8a69f] bg-white px-4 text-base font-semibold text-[#2c2c2a] disabled:opacity-60'
export const inputCls = 'min-h-[44px] w-full rounded-lg border border-[#a8a69f] bg-white px-3 text-base text-[#2c2c2a]'

export async function api<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }).catch(() => null)
  if (!res) return { ok: false, status: 0, data: { error: 'No connection. Try again.' } as T & { error?: string } }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  return { ok: res.ok, status: res.status, data }
}
