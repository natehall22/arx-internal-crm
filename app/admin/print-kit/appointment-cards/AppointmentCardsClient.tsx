'use client'

import { useState } from 'react'
import Nav from '@/components/Nav'

type MarketerInfo = {
  name: string
  phone: string
}

const DEFAULT_MARKETER: MarketerInfo = {
  name: 'Alex Nunez',
  phone: '704-437-9875',
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function AppointmentCard({ marketer }: { marketer: MarketerInfo }) {
  return (
    <div className="appointment-card">
      <div className="card-brand">
        <img src="/brand/arx-shield.png" alt="" />
        <div>
          <strong>ARX Roofing & Exteriors</strong>
          <span>Free Inspection</span>
        </div>
      </div>

      <div className="marketer-block">
        <p>Roofing Specialist</p>
        <h2>{marketer.name}</h2>
        <h3>{marketer.phone}</h3>
      </div>

      <div className="write-row">
        <label>
          <span>Date</span>
          <i />
        </label>
        <label>
          <span>Time</span>
          <i />
        </label>
      </div>

      <p className="day-note">Circle appointment day</p>
      <div className="day-row">
        {DAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
    </div>
  )
}

export default function AppointmentCardsClient() {
  const [draft, setDraft] = useState<MarketerInfo>(DEFAULT_MARKETER)
  const [marketer, setMarketer] = useState<MarketerInfo>(DEFAULT_MARKETER)

  const updateDraft = (key: keyof MarketerInfo, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const applyMarketer = () => {
    setMarketer({
      name: draft.name.trim() || DEFAULT_MARKETER.name,
      phone: draft.phone.trim() || DEFAULT_MARKETER.phone,
    })
  }

  return (
    <div className="appointment-cards-page min-h-screen bg-slate-200 text-slate-950">
      <div className="no-print">
        <Nav />
        <div className="mx-auto max-w-5xl px-4 py-6">
          <div className="rounded-t-lg bg-[#1B3A6B] px-5 py-4 text-white shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-sm font-extrabold uppercase tracking-[0.18em]">Appointment Cards</h1>
                <p className="mt-1 text-xs text-white/60">1 letter-sized print page with four appointment cards.</p>
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded bg-[#C9A84C] px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-slate-950 hover:bg-[#d9ba63]"
              >
                Print Cards
              </button>
            </div>
          </div>

          <div className="grid gap-3 rounded-b-lg border border-t-0 border-slate-300 bg-white p-5 shadow-sm sm:grid-cols-[repeat(2,minmax(0,1fr))_auto] sm:items-end">
            {(
              [
                ['name', 'Field Marketer Name'],
                ['phone', 'Phone Number'],
              ] as Array<[keyof MarketerInfo, string]>
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
              onClick={applyMarketer}
              className="h-10 rounded bg-[#1B3A6B] px-4 text-xs font-extrabold uppercase tracking-wide text-white hover:bg-[#274a80]"
            >
              Update
            </button>
          </div>

          <div className="mt-4 rounded border border-amber-300 border-l-4 border-l-[#9B7E3E] bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900">
            Print on Letter paper size (8.5 x 11). The page prints four light, write-friendly cards with blank date
            and time lines; the field marketer can circle the appointment day by hand.
          </div>
        </div>
      </div>

      <main className="appointment-card-kit mx-auto max-w-5xl px-4 pb-10">
        <section className="appointment-sheet bg-white shadow-lg">
          {Array.from({ length: 4 }).map((_, index) => (
            <AppointmentCard key={index} marketer={marketer} />
          ))}
        </section>
      </main>

      <style jsx global>{`
        .appointment-card-kit {
          font-family: 'Source Sans 3', Arial, sans-serif;
        }
        .appointment-sheet {
          background: #fff;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          grid-template-rows: repeat(2, 1fr);
          height: 11in;
          margin-left: auto;
          margin-right: auto;
          overflow: hidden;
          width: min(8.5in, calc(100vw - 2rem));
        }
        .appointment-card {
          background: #fff;
          border: 0.012in dashed #b8c2d2;
          color: #142747;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 0.26in 0.3in 0.24in;
          position: relative;
        }
        .appointment-card:nth-child(odd) {
          border-left: none;
        }
        .appointment-card:nth-child(even) {
          border-right: none;
        }
        .appointment-card:nth-child(-n + 2) {
          border-top: none;
        }
        .appointment-card:nth-child(n + 3) {
          border-bottom: none;
        }
        .appointment-card::after {
          border: 0.018in solid #c9a84c;
          bottom: 0.18in;
          content: '';
          left: 0.16in;
          pointer-events: none;
          position: absolute;
          right: 0.16in;
          top: 0.16in;
        }
        .card-brand {
          align-items: center;
          display: flex;
          gap: 0.12in;
          position: relative;
          z-index: 1;
        }
        .card-brand img {
          background: #f8fafc;
          border: 0.012in solid #d5dce7;
          border-radius: 999px;
          height: 0.42in;
          object-fit: contain;
          padding: 0.035in;
          width: 0.42in;
        }
        .card-brand strong,
        .card-brand span {
          display: block;
        }
        .card-brand strong {
          color: #1b3a6b;
          font-family: Georgia, serif;
          font-size: 0.17in;
          line-height: 1.05;
        }
        .card-brand span {
          color: #c9a84c;
          font-size: 0.11in;
          font-weight: 900;
          letter-spacing: 0.04in;
          margin-top: 0.04in;
          text-transform: uppercase;
        }
        .marketer-block {
          position: relative;
          text-align: center;
          z-index: 1;
        }
        .marketer-block p {
          color: #c9a84c;
          font-size: 0.12in;
          font-weight: 900;
          letter-spacing: 0.035in;
          margin-bottom: 0.08in;
          text-transform: uppercase;
        }
        .marketer-block h2 {
          color: #1b3a6b;
          font-family: Georgia, serif;
          font-size: 0.34in;
          font-weight: 700;
          line-height: 1.05;
        }
        .marketer-block h3 {
          color: #1b3a6b;
          font-size: 0.27in;
          font-weight: 900;
          line-height: 1.15;
          margin-top: 0.06in;
        }
        .write-row {
          display: grid;
          gap: 0.2in;
          grid-template-columns: 1fr 1fr;
          position: relative;
          z-index: 1;
        }
        .write-row label span {
          color: #c9a84c;
          display: block;
          font-size: 0.14in;
          font-weight: 900;
          margin-bottom: 0.08in;
          text-transform: uppercase;
        }
        .write-row i {
          border-bottom: 0.026in solid #1b3a6b;
          display: block;
          height: 0.34in;
        }
        .day-note {
          color: #64748b;
          font-size: 0.095in;
          font-weight: 800;
          letter-spacing: 0.018in;
          margin-bottom: -0.03in;
          position: relative;
          text-align: center;
          text-transform: uppercase;
          z-index: 1;
        }
        .day-row {
          display: grid;
          gap: 0.045in;
          grid-template-columns: repeat(6, 1fr);
          position: relative;
          z-index: 1;
        }
        .day-row span {
          background: #fff;
          border: 0.02in solid #1b3a6b;
          border-radius: 999px;
          color: #1b3a6b;
          display: block;
          font-size: 0.115in;
          font-weight: 900;
          padding: 0.06in 0.02in;
          text-align: center;
        }
        @media print {
          @page {
            size: 8.5in 11in;
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
          .appointment-card-kit {
            margin: 0 !important;
            max-width: none !important;
            padding: 0 !important;
            width: auto !important;
          }
          .appointment-sheet {
            box-shadow: none !important;
            height: 11in;
            margin: 0 !important;
            width: 8.5in;
          }
        }
      `}</style>
    </div>
  )
}
