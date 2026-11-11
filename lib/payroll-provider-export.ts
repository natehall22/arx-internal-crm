/**
 * Payroll provider export (Gusto, ADP): a CSV built ONLY from an APPROVED week's stored lines (`loadPayWeek` reads them for a locked
 * week), so the file can never disagree with what was approved. The provider owns tax: this file carries gross pay by kind; withholding,
 * net pay and filings are the provider's. Every file ties to the approved total to the cent (earnings minus deductions); a file that
 * does not is refused, never sent.
 *
 * Formats, checked 2026-11-13:
 *  - ADP: the documented "payroll import" CSV — columns Co Code, Batch ID, File #, Employee Name, Reg Hours, O/T Hours, then
 *    Earnings 3-6 Code + Amount pairs and an Adjust Ded Code + Amount pair (deductions are positive numbers). Codes are the
 *    company's own; File # is the person's ADP file number (users.payroll_employee_id). Hourly pay goes as DOLLARS in an earnings pair
 *    and the hours columns are left empty, so the provider cannot pay the hours a second time.
 *  - Gusto: its employee payroll upload ("Smart Import") maps whatever columns the file has and matches people by name; Gusto does not
 *    publish the header names of its template, so this file uses plain headers it can map. First time: upload it once beside Gusto's
 *    own template and confirm the mapping before relying on it.
 * One amount per kind, from the same lines the screen shows: Hourly (dollars), Commission (commission + per-unit pay + weekly minimum),
 * Bonus, Other (fixes, carried balances and advances paid on the check, signed).
 *
 * Advances (tax treatment is the accountant's call, not code's; it is an owner setting, `settings.payrollExport.advance`):
 *  - repaid from an advance PAID ON A CHECK: default `reduce_earnings` — the repayment is netted out of that week's earnings (an advance
 *    paid on a check was already taxed once, so it must not be taxed again as a deduction).
 *  - repaid from an advance paid OUTSIDE payroll: default `deduction` — a post-tax deduction.
 *  Either can be flipped. Confirm with the accountant before the first live run.
 */
import { roundMoney } from '@/lib/money'
import type { PayWeek, PayWeekPerson } from '@/lib/payroll-pay-week'

export type ExportProvider = 'gusto' | 'adp'

export type AdvanceTreatment = 'reduce_earnings' | 'deduction'
export type AdvanceExportSettings = { onCheck: AdvanceTreatment; offCheck: AdvanceTreatment }
/** The export settings (ADP codes and how advance repayments are mapped; Gusto uses `advance` too). */
export type AdpExportSettings = { coCode: string; codes: { hourly: string; commission: string; bonus: string; other: string; advance: string }; advance: AdvanceExportSettings }
export const DEFAULT_ADP_SETTINGS: AdpExportSettings = { coCode: '', codes: { hourly: 'HRL', commission: 'COM', bonus: 'BON', other: 'OTH', advance: 'ADV' }, advance: { onCheck: 'reduce_earnings', offCheck: 'deduction' } }
export const PAYROLL_EXPORT_SETTINGS_KEY = 'payrollExport'

export type ExportPerson = { userId: string; firstName: string; lastName: string; email: string | null; employeeId: string | null }

export type PersonAmounts = { regularHours: number; overtimeHours: number; hourly: number; commission: number; bonus: number; other: number; advance: number; total: number }

/** One person's week split by kind, from their stored lines. Pure. `advance` is what was repaid (positive). */
export function amountsFor(p: PayWeekPerson): PersonAmounts {
  const sum = (f: (l: PayWeekPerson['lines'][number]) => boolean) => roundMoney(p.lines.filter(f).reduce((s, l) => roundMoney(s + l.amount), 0))
  return {
    regularHours: p.hours?.regular ?? 0,
    overtimeHours: p.hours?.overtime ?? 0,
    hourly: sum((l) => l.kind === 'Hourly'),
    commission: sum((l) => l.kind === 'Commission' || l.kind === 'Units' || l.kind === 'Minimum'),
    bonus: sum((l) => l.kind === 'Bonus'),
    other: sum((l) => l.kind === 'Adjustment' && l.adjustmentKind !== 'advance_recovery'),
    advance: roundMoney(-sum((l) => l.kind === 'Adjustment' && l.adjustmentKind === 'advance_recovery')),
    total: p.total,
  }
}

export type ExportRowAmounts = { hourly: number; commission: number; bonus: number; other: number; deduction: number }

/** What goes in the file for one person: earnings after any advance repayment netted out of them, and the post-tax deduction. Pure. */
export function exportAmounts(a: PersonAmounts, offCheckRepaid: number, treatment: AdvanceExportSettings): ExportRowAmounts {
  const off = Math.min(a.advance, Math.max(0, roundMoney(offCheckRepaid)))
  const on = roundMoney(a.advance - off)
  let net = roundMoney((treatment.onCheck === 'reduce_earnings' ? on : 0) + (treatment.offCheck === 'reduce_earnings' ? off : 0))
  const deduction = roundMoney((treatment.onCheck === 'deduction' ? on : 0) + (treatment.offCheck === 'deduction' ? off : 0))
  const out = { hourly: a.hourly, commission: a.commission, bonus: a.bonus, other: a.other }
  // Netted against earnings in this order; whatever cannot be netted from a positive amount lands on Other (signed).
  for (const k of ['commission', 'hourly', 'bonus', 'other'] as const) {
    if (net <= 0) break
    const take = Math.min(net, Math.max(0, out[k]))
    out[k] = roundMoney(out[k] - take)
    net = roundMoney(net - take)
  }
  if (net > 0) out.other = roundMoney(out.other - net)
  return { ...out, deduction }
}

const esc = (v: string | number) => {
  // A value starting with = + - @ would run as a formula when the file is opened in a spreadsheet (a negative number is fine).
  const s = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-\d+(\.\d+)?$/.test(v) ? `'${v}` : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const row = (cells: Array<string | number>) => cells.map(esc).join(',')
const money = (n: number) => n.toFixed(2)
const hours = (n: number) => String(Math.round(n * 100) / 100)

export type ProviderExport = { filename: string; csv: string; people: number; total: number; missing: Array<{ userId: string; name: string; why: string }> }

export function buildProviderExport(args: {
  provider: ExportProvider
  week: PayWeek
  people: ReadonlyMap<string, ExportPerson>
  adp?: AdpExportSettings
  /** Per person: the part of this week's advance repayment that belongs to advances paid OUTSIDE payroll (loadOffCheckRepaid). */
  offCheckRepaid?: ReadonlyMap<string, number>
}): ProviderExport {
  const { week, provider } = args
  if (week.state !== 'approved') throw new Error('Approve the week first')
  const paid = week.people.filter((p) => p.total > 0 || amountsFor(p).advance > 0)
  const missing: ProviderExport['missing'] = []
  const lines: string[] = []
  const settings = args.adp ?? DEFAULT_ADP_SETTINGS
  const ymd = week.period.weekEnding
  let payableSum = 0
  const amounts = (p: PayWeekPerson) => {
    const a = amountsFor(p)
    const x = exportAmounts(a, args.offCheckRepaid?.get(p.userId) ?? 0, settings.advance)
    // Every row must come to exactly what was approved for that person.
    const net = roundMoney(x.hourly + x.commission + x.bonus + x.other - x.deduction)
    if (net !== roundMoney(p.total)) throw new Error(`The file does not tie to the approved pay for ${p.name} (${net.toFixed(2)} vs ${p.total.toFixed(2)}). Nothing was exported.`)
    if (p.total > 0) payableSum = roundMoney(payableSum + net)
    return x
  }
  if (provider === 'gusto') {
    lines.push(row(['First name', 'Last name', 'Email', 'Hourly pay', 'Commission', 'Bonus', 'Other pay (fixes, balances)', 'Advance repaid (after-tax deduction)', 'Total pay']))
    for (const p of paid) {
      const who = args.people.get(p.userId)
      if (!who || !who.lastName) missing.push({ userId: p.userId, name: p.name, why: 'No name on file' })
      const x = amounts(p)
      lines.push(row([who?.firstName ?? p.name, who?.lastName ?? '', who?.email ?? '', money(x.hourly), money(x.commission), money(x.bonus), money(x.other), money(x.deduction), money(p.total)]))
    }
  } else {
    if (!settings.coCode.trim()) missing.push({ userId: '', name: 'Company', why: 'ADP company code is not set' })
    const batch = `${ymd.slice(5, 7)}${ymd.slice(8, 10)}${ymd.slice(2, 4)}`
    lines.push(row(['Co Code', 'Batch ID', 'File #', 'Employee Name', 'Reg Hours', 'O/T Hours', 'Earnings 3 Code', 'Earnings 3 Amount', 'Earnings 4 Code', 'Earnings 4 Amount', 'Earnings 5 Code', 'Earnings 5 Amount', 'Earnings 6 Code', 'Earnings 6 Amount', 'Adjust Ded Code', 'Adjust Ded Amount']))
    for (const p of paid) {
      const who = args.people.get(p.userId)
      if (!who?.employeeId) missing.push({ userId: p.userId, name: p.name, why: 'No ADP file number' })
      const x = amounts(p)
      const c = settings.codes
      lines.push(row([settings.coCode, batch, who?.employeeId ?? '', p.name, '', '', c.commission, money(x.commission), c.bonus, money(x.bonus), c.other, money(x.other), c.hourly, money(x.hourly), x.deduction > 0 ? c.advance : '', x.deduction > 0 ? money(x.deduction) : '']))
    }
  }
  if (payableSum !== roundMoney(week.totals.amount)) throw new Error(`The file (${payableSum.toFixed(2)}) does not tie to the approved total (${week.totals.amount.toFixed(2)}). Nothing was exported.`)
  return { filename: `${provider}-pay-week-ending-${ymd}.csv`, csv: lines.join('\n') + '\n', people: paid.length, total: week.totals.amount, missing }
}

const treatment = (v: unknown, d: AdvanceTreatment): AdvanceTreatment => (v === 'reduce_earnings' || v === 'deduction' ? v : d)

/** The saved export settings, tolerant of anything stored. Pure. */
export function readAdpSettings(settings: unknown): AdpExportSettings {
  const raw = settings && typeof settings === 'object' ? ((settings as Record<string, unknown>)[PAYROLL_EXPORT_SETTINGS_KEY] as Record<string, unknown> | undefined) : undefined
  const code = (v: unknown, d: string) => (typeof v === 'string' && /^[A-Za-z0-9 _-]{1,12}$/.test(v.trim()) ? v.trim() : d)
  const codes = (raw?.codes ?? {}) as Record<string, unknown>
  const adv = (raw?.advance ?? {}) as Record<string, unknown>
  const d = DEFAULT_ADP_SETTINGS
  return {
    coCode: code(raw?.coCode, ''),
    codes: { hourly: code(codes.hourly, d.codes.hourly), commission: code(codes.commission, d.codes.commission), bonus: code(codes.bonus, d.codes.bonus), other: code(codes.other, d.codes.other), advance: code(codes.advance, d.codes.advance) },
    advance: { onCheck: treatment(adv.onCheck, d.advance.onCheck), offCheck: treatment(adv.offCheck, d.advance.offCheck) },
  }
}
