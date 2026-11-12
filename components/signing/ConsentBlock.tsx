'use client'

import type { ConsentDisclosure } from '@/lib/signing/consent'

/** The e-sign notice + the one explicit "I agree" box (ESIGN consent). Shown only when the company's consent step is on. */
export default function ConsentBlock({ disclosure, checked, onChange }: { disclosure: ConsentDisclosure; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <section data-testid="esign-consent" className="rounded-lg border border-gray-300 bg-white p-4 text-[#2c2c2a]">
      <h3 className="text-base font-semibold">{disclosure.heading}</h3>
      <p className="mt-1 text-base">{disclosure.paragraphs[0]}</p>
      <details className="mt-2">
        <summary className="min-h-[44px] cursor-pointer py-2 text-base font-medium underline">Your rights and what you need</summary>
        {disclosure.paragraphs.slice(1).map((p, i) => (
          <p key={i} className="mt-2 text-base">{p}</p>
        ))}
      </details>
      <label className="mt-2 flex min-h-[44px] cursor-pointer items-start gap-3 py-2">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-6 w-6 shrink-0" />
        <span className="text-base font-medium">{disclosure.checkboxLabel}</span>
      </label>
    </section>
  )
}
