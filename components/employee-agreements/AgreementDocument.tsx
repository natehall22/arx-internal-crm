import type { EmployeeAgreementTemplate } from '@/lib/employee-comp-agreements'

export default function AgreementDocument({ agreement, employeeName, effectiveDate }: { agreement: EmployeeAgreementTemplate; employeeName: string; effectiveDate: string }) {
  return <article className="rounded-xl border bg-white p-6 text-sm leading-6 text-gray-800 shadow-inner">
    <header className="mb-6 text-center"><p className="text-xs font-bold uppercase tracking-[0.18em] text-green-700">ARX Roofing &amp; Exteriors, LLC</p><h2 className="mt-2 text-xl font-bold text-gray-950">{agreement.title}</h2><p className="text-gray-500">Roofing Division - Charlotte, North Carolina</p></header>
    <dl className="mb-6 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 rounded-lg bg-gray-50 p-4"><dt className="font-semibold">Team member</dt><dd>{employeeName}</dd><dt className="font-semibold">Effective date</dt><dd>{effectiveDate}</dd><dt className="font-semibold">Agreement version</dt><dd>{agreement.version}</dd></dl>
    <div className="space-y-5">{agreement.sections.map((section) => <section key={section.heading}><h3 className="font-bold uppercase text-green-800">{section.heading}</h3>{section.paragraphs?.map((paragraph) => <p key={paragraph} className="mt-1">{paragraph}</p>)}{section.bullets && <ul className="mt-1 list-disc space-y-1 pl-6">{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}</section>)}</div>
  </article>
}
