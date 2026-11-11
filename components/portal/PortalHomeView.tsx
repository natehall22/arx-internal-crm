'use client'

import { useState } from 'react'

import { CardControls, MessageBox, PayButton, TextsToggle } from '@/components/portal/PortalActions'
import { dayLabel, money, monthDay, shortDate } from '@/components/portal/format'
import JobProgressCard from '@/components/portal/JobProgressCard'
import PortalShell, { Panel, type PortalCompany } from '@/components/portal/PortalShell'
import type { PortalHome } from '@/lib/portal/data'

const link = 'inline-flex min-h-[44px] items-center text-base font-bold text-[#1d4ed8] underline'
const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-base">{children}</p>

/** The portal home: one scrolling page, each part only when there is something to show. */
export default function PortalHomeView({ company, home, payOnline, texting = false }: { company: PortalCompany; home: PortalHome; payOnline: boolean; texting?: boolean }) {
  const [messages, setMessages] = useState(home.messages)
  const toPay = home.invoices.filter((i) => i.balanceCents > 0)

  return (
    <PortalShell company={company} wide signOut>
      <h1 className="mb-3 text-2xl font-bold">{home.customerName ? `Hi, ${home.customerName.split(' ')[0]}` : 'Your account'}</h1>

      {home.jobs.map((j) => (
        <JobProgressCard key={j.id} job={j} company={company} payOnline={payOnline} payInvoiceId={toPay.find((i) => i.jobId === j.id)?.id ?? null} />
      ))}

      {toPay.length > 0 ? (
        <Panel title="To pay">
          <ul className="divide-y divide-[#e5e3dc]">
            {toPay.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-lg font-bold">{money(i.balanceCents)}</p>
                  <p className="text-base">Invoice {i.number}{i.dueAt ? ` · due ${shortDate(i.dueAt)}` : ''}</p>
                </div>
                {payOnline ? <PayButton invoiceId={i.id} label="Pay now" /> : <a className={link} href={`/portal/invoices/${i.id}`}>See invoice</a>}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Upcoming visits">
        {home.visits.upcoming.length === 0 ? (
          <Empty>Nothing is scheduled right now.</Empty>
        ) : (
          <ul className="divide-y divide-[#e5e3dc]">
            {home.visits.upcoming.map((v) => (
              <li key={v.id} className="py-3">
                <p className="text-lg font-bold">{dayLabel(v.date)}</p>
                <p className="text-base">{v.service}{v.address ? ` · ${v.address}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
        {home.visits.recent.length > 0 ? (
          <details className="mt-3">
            <summary className="min-h-[44px] cursor-pointer text-base font-bold underline">Recent visits</summary>
            <ul className="divide-y divide-[#e5e3dc]">
              {home.visits.recent.map((v) => (
                <li key={v.id} className="py-2 text-base">{dayLabel(v.date)} · {v.service} · done</li>
              ))}
            </ul>
          </details>
        ) : null}
      </Panel>

      {home.contracts.length > 0 ? (
        <Panel title="Quotes and contracts">
          <ul className="divide-y divide-[#e5e3dc]">
            {home.contracts.map((c) => (
              <li key={c.id} className="py-3">
                <p className="text-lg font-bold">{c.address}</p>
                <p className="text-base">{money(c.totalCents)} · {c.state === 'signed' ? 'Signed' : c.state === 'to_sign' ? 'Waiting for your signature' : 'Signing link expired. Please contact us for a new one.'}</p>
                {c.signUrl ? <a className={link} href={c.signUrl}>Review and sign</a> : null}
                {c.downloadUrl ? <a className={link} href={c.downloadUrl}>Download your signed copy</a> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Invoices">
        {home.invoices.length === 0 ? (
          <Empty>No invoices yet.</Empty>
        ) : (
          <ul className="divide-y divide-[#e5e3dc]">
            {home.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-base font-bold">Invoice {i.number} · {money(i.totalCents)}</p>
                  <p className="text-base">{i.balanceCents <= 0 ? 'Paid' : `${money(i.balanceCents)} left to pay`}{i.issuedAt ? ` · ${shortDate(i.issuedAt)}` : ''}</p>
                </div>
                <a className={link} href={`/portal/invoices/${i.id}`}>View / download</a>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {home.plans.length > 0 ? (
        <Panel title="Your service plan">
          <ul className="divide-y divide-[#e5e3dc]">
            {home.plans.map((p) => (
              <li key={p.id} className="py-3">
                <p className="text-lg font-bold">{p.name}{p.status === 'paused' ? ' (paused)' : ''}</p>
                {p.address ? <p className="text-base">{p.address}</p> : null}
                {p.schedule ? <p className="text-base">{p.schedule}</p> : null}
                {p.price ? <p className="text-base">{p.price}</p> : null}
                {p.nextVisit ? <p className="text-base">Next visit: {dayLabel(p.nextVisit)}</p> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {home.checkups.length > 0 ? (
        <Panel title="Checkups">
          <ul className="divide-y divide-[#e5e3dc]">
            {home.checkups.map((c) => (
              <li key={c.id} className="py-3">
                <p className="text-lg font-bold">{c.title}</p>
                <p className="text-base">{c.booked ? `Booked for ${dayLabel(c.when)}` : `Coming up around ${monthDay(c.when)}. We will be in touch to set it up.`}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {home.documents.length > 0 || home.paperwork.length > 0 ? (
        <Panel title="Documents and photos">
          <ul className="divide-y divide-[#e5e3dc]">
            {home.paperwork.map((d) => (
              <li key={`paper-${d.id}`} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 break-words text-base font-semibold">{d.title}</span>
                <a className={link} href={d.href} target="_blank" rel="noopener noreferrer">View</a>
              </li>
            ))}
            {home.documents.map((d) => (
              <li key={`${d.kind}-${d.id}`} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 break-words text-base font-semibold">{d.title}</span>
                <a className={link} href={`/api/portal/files/${d.kind}/${d.id}`} target="_blank" rel="noopener noreferrer">{d.kind === 'photo' ? 'View' : 'Download'}</a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {home.card ? (
        <Panel title="Saved card">
          <CardControls card={home.card} />
        </Panel>
      ) : null}

      <Panel title="Messages" id="messages">
        {messages.length === 0 ? <Empty>No messages yet.</Empty> : (
          <ul className="flex flex-col gap-2">
            {messages.map((m) => (
              <li key={m.id} className={`max-w-[90%] whitespace-pre-wrap rounded-xl p-3 text-base ${m.fromCustomer ? 'self-end bg-[#e5e7eb]' : 'self-start bg-[#f1efe8]'}`}>
                {m.body}
                <span className="mt-1 block text-sm">{m.fromCustomer ? 'You' : company.name} · {shortDate(m.date)}</span>
              </li>
            ))}
          </ul>
        )}
        <MessageBox onSent={(body) => setMessages((l) => [...l, { id: `new-${l.length}`, fromCustomer: true, body, date: new Date().toISOString() }])} />
      </Panel>

      {texting ? (
        <Panel title="Text messages">
          <TextsToggle companyName={company.name} />
        </Panel>
      ) : null}
    </PortalShell>
  )
}
