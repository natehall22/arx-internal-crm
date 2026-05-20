'use client'

import { useMemo, useState } from 'react'
import Nav from '@/components/Nav'

type RepInfo = {
  name: string
  title: string
  phone: string
  email: string
}

const DEFAULT_REP: RepInfo = {
  name: '[REP NAME]',
  title: 'Roof Inspection Specialist',
  phone: '(704) 313-8834',
  email: 'inspections@arxroofing.com',
}

export default function DoorDropClient() {
  const [draft, setDraft] = useState<RepInfo>(DEFAULT_REP)
  const [rep, setRep] = useState<RepInfo>(DEFAULT_REP)

  const qrUrl = useMemo(
    () =>
      `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(
        'https://arxroofing.com'
      )}&color=1B3A6B&bgcolor=ffffff`,
    []
  )

  const updateDraft = (key: keyof RepInfo, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const applyRep = () => {
    setRep({
      name: draft.name.trim() || DEFAULT_REP.name,
      title: draft.title.trim() || DEFAULT_REP.title,
      phone: draft.phone.trim() || DEFAULT_REP.phone,
      email: draft.email.trim() || DEFAULT_REP.email,
    })
  }

  return (
    <div className="door-drop-page min-h-screen bg-slate-200 text-slate-950">
      <div className="no-print">
        <Nav />
        <div className="mx-auto max-w-5xl px-4 py-6">
          <div className="rounded-t-lg bg-[#1B3A6B] px-5 py-4 text-white shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-sm font-extrabold uppercase tracking-[0.18em]">
                  ARX Roofing Door Drop Print Kit
                </h1>
                <p className="mt-1 text-xs text-white/60">2 print pages: one letter, one #10 envelope.</p>
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded bg-[#C9A84C] px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-slate-950 hover:bg-[#d9ba63]"
              >
                Print Kit
              </button>
            </div>
          </div>

          <div className="grid gap-3 rounded-b-lg border border-t-0 border-slate-300 bg-white p-5 shadow-sm md:grid-cols-[repeat(4,minmax(0,1fr))_auto] md:items-end">
            {(
              [
                ['name', 'Rep Full Name'],
                ['title', 'Title'],
                ['phone', 'Direct Phone'],
                ['email', 'Email'],
              ] as Array<[keyof RepInfo, string]>
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#1B3A6B]">
                  {label}
                </span>
                <input
                  value={draft[key]}
                  onChange={(event) => updateDraft(key, event.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#9B7E3E]"
                />
              </label>
            ))}
            <button
              type="button"
              onClick={applyRep}
              className="h-10 rounded bg-[#1B3A6B] px-4 text-xs font-extrabold uppercase tracking-wide text-white hover:bg-[#274a80]"
            >
              Update
            </button>
          </div>

          <div className="mt-4 rounded border border-amber-300 border-l-4 border-l-[#9B7E3E] bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900">
            In the browser print dialog, enable background graphics/colors. The preview should show exactly two
            pages: page 1 as letter portrait and page 2 as a #10 envelope.
          </div>
        </div>
      </div>

      <main className="print-kit mx-auto max-w-5xl space-y-6 px-4 pb-10">
        <section className="sheet letter-sheet bg-white shadow-lg">
          <div className="gold-rule" />
          <header className="letter-header">
            <div className="brand-lockup">
              <img src="/brand/arx-shield.png" alt="" />
              <div>
                <div className="brand-name">ARX Roofing & Exteriors</div>
                <div className="brand-sub">Charlotte, NC</div>
              </div>
            </div>
            <div className="rep-block">
              <div className="rep-name">{rep.name}</div>
              <div className="rep-title">{rep.title}</div>
              <div className="rep-phone">{rep.phone}</div>
              <div className="rep-email">{rep.email}</div>
            </div>
          </header>

          <div className="offer-ribbon">
            <div className="offer-badge">
              <span>Exclusive</span>
              <strong>$500</strong>
              <span>Discount</span>
            </div>
            <div>
              <h2>For the Homeowner: Buyer or Seller</h2>
              <p>
                Your roof can shape inspections, negotiations, insurance confidence, and a buyer&apos;s first
                impression. ARX can help you understand what is happening before it turns into a surprise.
              </p>
            </div>
          </div>

          <article className="letter-body">
            <p className="eyebrow">Free Roof Evaluation</p>
            <h3>Your roof matters right now, whether you&apos;re coming or going.</h3>
            <p>
              If you are selling, an aging or storm-worn roof can become a last-minute negotiation problem. If you
              are buying, it can become one of the first expensive surprises after closing.
            </p>
            <p>
              ARX Roofing & Exteriors offers a no-pressure roof evaluation so you can make the next move with real
              information. We will look for common concerns like missing shingles, storm damage, flashing issues,
              age-related wear, and visible leak risks.
            </p>
            <p>
              We have helped hundreds of Charlotte-area homeowners navigate the roof question — whether that meant a
              quick repair before a listing appointment, a full replacement filed through insurance, or simply the
              reassurance that nothing needs to be done right now. There is no charge for the evaluation and no
              commitment required to move forward.
            </p>

            <div className="audience-grid">
              <div>
                <strong>Sellers</strong>
                <span>Reduce inspection drama and protect your asking price.</span>
              </div>
              <div>
                <strong>Buyers</strong>
                <span>Know what you are inheriting before small issues become expensive.</span>
              </div>
            </div>

            <div className="process-strip">
              <span>1. Schedule</span>
              <span>2. Inspect</span>
              <span>3. Review Options</span>
              <span>4. Claim $500</span>
            </div>

            <div className="cta-box">
              <div>
                <h4>Claim your free evaluation and $500 discount.</h4>
                <p>Call {rep.phone} or visit arxroofing.com to schedule.</p>
              </div>
              <div className="qr-wrap">
                <img src={qrUrl} alt="QR code for arxroofing.com" />
                <span>Scan to visit</span>
              </div>
            </div>

            <div className="signature">
              <p>Best,</p>
              <strong>{rep.name}</strong>
              <span>
                {rep.title} · ARX Roofing & Exteriors · {rep.phone}
              </span>
            </div>
            <p className="ps-line">
              <strong>P.S.</strong> This $500 discount is exclusive to homeowners in this area and is limited to the
              first few who schedule. Call or scan the QR code above to reserve your spot before it closes.
            </p>
          </article>

          <footer className="letter-footer">
            <div>
              <span>Licensed</span>
              <span>Insured</span>
            </div>
            <p>Offer applies to qualifying full roof replacement projects. Ask your ARX representative for details.</p>
          </footer>
        </section>

        <section className="sheet envelope-sheet bg-white shadow-lg">
          <div className="env-top-rule" />
          <div className="env-fold env-fold-top" />
          <div className="env-fold env-fold-left" />
          <div className="env-fold env-fold-right" />

          <div className="env-return">
            <img src="/brand/arx-shield.png" alt="" />
            <div>
              <strong>ARX Roofing & Exteriors</strong>
              <span>Charlotte, NC · arxroofing.com</span>
            </div>
          </div>

          <div className="env-cred">
            <strong>Licensed & Insured</strong>
            <span>Charlotte, NC</span>
          </div>

          <div className="env-center">
            <p>For the Homeowner</p>
            <h2>
              Your Roof Matters Right Now.
              <br />
              Whether You&apos;re Coming or Going.
            </h2>
            <span>Free evaluation + $500 exclusive discount inside</span>
            <strong>
              Questions? Call {rep.phone} · {rep.name}
            </strong>
            <em>$500 Buyer & Seller Discount · Open to Claim</em>
          </div>
          <div className="env-bottom-rule" />
        </section>
      </main>

      <style jsx global>{`
        .print-kit {
          font-family: 'Source Sans 3', Arial, sans-serif;
        }
        .sheet {
          margin-left: auto;
          margin-right: auto;
          overflow: hidden;
          color: #1a1a1a;
        }
        .letter-sheet {
          width: min(8.5in, calc(100vw - 2rem));
          min-height: 11in;
          display: flex;
          flex-direction: column;
        }
        .gold-rule,
        .env-top-rule,
        .env-bottom-rule {
          height: 0.07in;
          background: linear-gradient(90deg, #9b7e3e, #c9a84c, #9b7e3e);
        }
        .letter-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.25in;
          border-bottom: 0.025in solid #1b3a6b;
          padding: 0.28in 0.45in 0.24in;
        }
        .brand-lockup {
          display: flex;
          align-items: center;
          gap: 0.12in;
        }
        .brand-lockup img {
          width: 0.62in;
          height: 0.62in;
          object-fit: contain;
        }
        .brand-name {
          color: #1b3a6b;
          font-family: Georgia, serif;
          font-size: 0.21in;
          font-weight: 700;
        }
        .brand-sub,
        .rep-title,
        .rep-email {
          color: #9b7e3e;
          font-size: 0.09in;
          font-weight: 700;
          letter-spacing: 0.03in;
          text-transform: uppercase;
        }
        .rep-block {
          text-align: right;
        }
        .rep-name {
          color: #1b3a6b;
          font-family: Georgia, serif;
          font-size: 0.21in;
          font-weight: 700;
        }
        .rep-phone {
          color: #1b3a6b;
          font-size: 0.24in;
          font-weight: 800;
          line-height: 1.1;
          margin-top: 0.04in;
        }
        .offer-ribbon {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.22in;
          align-items: center;
          background: #2e5fa3;
          padding: 0.24in 0.45in;
        }
        .offer-badge {
          border: 0.025in solid #c9a84c;
          border-radius: 0.04in;
          color: white;
          padding: 0.1in 0.22in;
          text-align: center;
        }
        .offer-badge strong {
          display: block;
          font-family: Georgia, serif;
          font-size: 0.42in;
          line-height: 1;
          color: #c9a84c;
        }
        .offer-badge span {
          display: block;
          color: rgba(255, 255, 255, 0.7);
          font-size: 0.075in;
          font-weight: 800;
          letter-spacing: 0.02in;
          text-transform: uppercase;
        }
        .offer-ribbon h2 {
          color: white;
          font-family: Georgia, serif;
          font-weight: 700;
          font-size: 0.19in;
          margin-bottom: 0.06in;
        }
        .letter-body h3 {
          color: #1b3a6b;
          font-family: Georgia, serif;
          font-weight: 700;
        }
        .offer-ribbon p {
          color: rgba(255, 255, 255, 0.82);
          font-size: 0.125in;
          line-height: 1.5;
        }
        .letter-body {
          padding: 0.22in 0.45in 0.18in;
          flex: 1;
        }
        .eyebrow {
          color: #9b7e3e;
          font-size: 0.1in;
          font-weight: 800;
          letter-spacing: 0.03in;
          margin-bottom: 0.1in;
          text-transform: uppercase;
        }
        .letter-body h3 {
          font-size: 0.27in;
          line-height: 1.2;
          margin-bottom: 0.15in;
        }
        .letter-body > p:not(.eyebrow) {
          color: #2a2a2a;
          font-size: 0.13in;
          line-height: 1.65;
          margin-bottom: 0.14in;
        }
        .audience-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.1in;
          margin: 0.18in 0;
        }
        .audience-grid div {
          background: #eef2f9;
          border: 0.018in solid #1b3a6b;
          border-radius: 0.05in;
          padding: 0.14in 0.16in;
        }
        .audience-grid div + div {
          background: #fdf8ed;
          border-color: #9b7e3e;
        }
        .audience-grid strong {
          color: #1b3a6b;
          display: block;
          font-size: 0.13in;
          font-weight: 800;
          margin-bottom: 0.04in;
        }
        .audience-grid span {
          color: #555;
          display: block;
          font-size: 0.12in;
          line-height: 1.4;
        }
        .process-strip {
          background: #eef2f8;
          border-radius: 0.04in;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          margin-bottom: 0.2in;
          overflow: hidden;
        }
        .process-strip span {
          border-right: 0.012in solid #d0daea;
          color: #1b3a6b;
          font-size: 0.115in;
          font-weight: 800;
          padding: 0.15in 0.06in;
          text-align: center;
        }
        .process-strip span:last-child {
          border-right: none;
          color: #9b7e3e;
        }
        .cta-box {
          align-items: center;
          background: #2e5fa3;
          border-radius: 0.05in;
          display: flex;
          justify-content: space-between;
          gap: 0.2in;
          margin-bottom: 0.22in;
          padding: 0.22in 0.26in;
        }
        .cta-box h4 {
          color: white;
          font-family: Georgia, serif;
          font-size: 0.19in;
          margin-bottom: 0.05in;
        }
        .cta-box p {
          color: rgba(255, 255, 255, 0.8);
          font-size: 0.12in;
        }
        .qr-wrap {
          flex-shrink: 0;
          text-align: center;
        }
        .qr-wrap img {
          background: white;
          border: 0.04in solid white;
          border-radius: 0.03in;
          display: block;
          height: 1.0in;
          width: 1.0in;
        }
        .qr-wrap span {
          color: rgba(255, 255, 255, 0.6);
          display: block;
          font-size: 0.075in;
          margin-top: 0.03in;
        }
        .signature {
          border-top: 0.012in solid #eee;
          padding-top: 0.16in;
        }
        .signature p {
          color: #666;
          font-size: 0.12in;
        }
        .ps-line {
          border-top: 0.012in solid #eee;
          color: #444;
          font-size: 0.115in;
          line-height: 1.5;
          margin-top: 0.14in;
          padding-top: 0.14in;
        }
        .ps-line strong {
          color: #1b3a6b;
          font-size: 0.115in;
        }
        .signature strong {
          color: #1b3a6b;
          display: block;
          font-family: Georgia, serif;
          font-size: 0.26in;
          font-style: italic;
          font-weight: 400;
          margin: 0.05in 0;
        }
        .signature span {
          color: #888;
          font-size: 0.105in;
        }
        .letter-footer {
          align-items: center;
          border-top: 0.07in solid transparent;
          background-image: linear-gradient(white, white), linear-gradient(90deg, #9b7e3e, #c9a84c, #9b7e3e);
          background-origin: border-box;
          background-clip: padding-box, border-box;
          display: flex;
          justify-content: space-between;
          gap: 0.12in;
          padding: 0.14in 0.45in;
        }
        .letter-footer div {
          display: flex;
          gap: 0.05in;
          flex-wrap: wrap;
        }
        .letter-footer span {
          border: 0.012in solid #1b3a6b;
          border-radius: 0.03in;
          color: #1b3a6b;
          font-size: 0.09in;
          font-weight: 800;
          padding: 0.035in 0.08in;
        }
        .letter-footer p {
          color: #999;
          font-size: 0.075in;
          line-height: 1.35;
          max-width: 3.5in;
          text-align: right;
        }
        .envelope-sheet {
          height: 4.125in;
          position: relative;
          width: 9.5in;
        }
        .env-top-rule,
        .env-bottom-rule {
          left: 0;
          position: absolute;
          right: 0;
          z-index: 5;
        }
        .env-top-rule {
          top: 0;
        }
        .env-bottom-rule {
          bottom: 0;
        }
        .env-fold {
          position: absolute;
          z-index: 1;
        }
        .env-fold-top {
          border-left: 4.75in solid transparent;
          border-right: 4.75in solid transparent;
          border-top: 1.35in solid #f3f3f3;
          inset-inline: 0;
          top: 0;
        }
        .env-fold-left {
          border-bottom: 2.0625in solid transparent;
          border-left: 1.15in solid #efefef;
          border-top: 2.0625in solid transparent;
          left: 0;
          top: 0;
        }
        .env-fold-right {
          border-bottom: 2.0625in solid transparent;
          border-right: 1.15in solid #efefef;
          border-top: 2.0625in solid transparent;
          right: 0;
          top: 0;
        }
        .env-return {
          align-items: center;
          display: flex;
          gap: 0.12in;
          left: 0.35in;
          position: absolute;
          top: 0.28in;
          z-index: 10;
        }
        .env-return img {
          height: 0.42in;
          width: 0.42in;
          object-fit: contain;
        }
        .env-return strong,
        .env-return span {
          display: block;
        }
        .env-return strong {
          color: #1b3a6b;
          font-size: 0.11in;
          text-transform: uppercase;
        }
        .env-return span {
          color: #777;
          font-size: 0.085in;
        }
        .env-cred {
          border: 0.012in solid #9b7e3e;
          border-radius: 0.035in;
          padding: 0.07in 0.12in;
          position: absolute;
          right: 0.35in;
          text-align: right;
          top: 0.28in;
          z-index: 10;
        }
        .env-cred strong,
        .env-cred span {
          display: block;
        }
        .env-cred strong {
          color: #9b7e3e;
          font-size: 0.085in;
          letter-spacing: 0.025in;
          text-transform: uppercase;
        }
        .env-cred span {
          color: #777;
          font-size: 0.075in;
        }
        .env-center {
          left: 50%;
          position: absolute;
          text-align: center;
          top: 54%;
          transform: translate(-50%, -50%);
          width: 4.75in;
          z-index: 10;
        }
        .env-center p {
          border: 0.018in solid #9b7e3e;
          border-radius: 0.025in;
          color: #9b7e3e;
          display: inline-block;
          font-size: 0.085in;
          font-weight: 800;
          letter-spacing: 0.035in;
          margin-bottom: 0.12in;
          padding: 0.045in 0.16in;
          text-transform: uppercase;
        }
        .env-center h2 {
          color: #1b3a6b;
          font-family: Georgia, serif;
          font-size: 0.24in;
          font-weight: 700;
          line-height: 1.3;
          margin-bottom: 0.08in;
        }
        .env-center span,
        .env-center strong,
        .env-center em {
          display: block;
        }
        .env-center span {
          color: #777;
          font-size: 0.12in;
          font-style: italic;
          margin-bottom: 0.08in;
        }
        .env-center strong {
          color: #1b3a6b;
          font-size: 0.13in;
          margin-bottom: 0.09in;
        }
        .env-center em {
          border: 0.018in solid #9b7e3e;
          border-radius: 0.025in;
          color: #9b7e3e;
          display: inline-block;
          font-size: 0.105in;
          font-style: normal;
          font-weight: 800;
          letter-spacing: 0.02in;
          padding: 0.055in 0.16in;
          text-transform: uppercase;
        }
        @media print {
          @page {
            margin: 0;
          }
          @page letterPage {
            size: letter portrait;
            margin: 0;
          }
          @page envelopePage {
            size: 9.5in 4.125in;
            margin: 0;
          }
          html,
          body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .no-print {
            display: none !important;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print-kit {
            max-width: none !important;
            padding: 0 !important;
            margin: 0 !important;
            width: auto !important;
          }
          .sheet {
            box-shadow: none !important;
            margin: 0 !important;
          }
          .letter-sheet {
            break-after: page;
            box-sizing: border-box;
            height: 11in;
            max-width: none !important;
            min-height: 11in;
            page: letterPage;
            width: 8.5in;
          }
          .envelope-sheet {
            break-after: auto;
            height: 4.125in;
            page: envelopePage;
            width: 9.5in;
          }
        }
      `}</style>
    </div>
  )
}
