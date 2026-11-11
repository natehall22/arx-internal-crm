/**
 * Payroll provider export (Gusto, ADP): a CSV built ONLY from an APPROVED week's stored lines (`loadPayWeek` reads them for a locked
 * week), so the file can never disagree with what was approved. The provider owns tax: this file carries gross pay by kind and what
 * is to be taken back; withholding, net pay and filings are the provider's.
 *
 * Formats, checked 2026-11-13:
 *  - ADP: the documented "payroll import" CSV — columns Co Code, Batch ID, File #, Employee Name, Reg Hours, O/T Hours, then
 *    Earnings 3/4/5 Code + Amount pairs and an Adjust Ded Code + Amount pair (deductions are positive numbers). Codes are the
 *    company's own, set in Pay -> Export; File # is the person's ADP file number (users.payroll_employee_id).
 *  - Gusto: its employee payroll upload ("Smart Import") maps whatever columns the file has to the payroll and matches people by
 *    name; Gusto does not publish the header names of its template, so this file uses plain headers it can map. First time: upload it
 *    once beside Gusto's own template and confirm the mapping before relying on it.
 * One amount per kind, from the same lines the screen shows: Commission (commission + per-unit pay + weekly minimum), Hourly (hours;
 * the provider applies the rate), Bonus, Other (fixes and carried balances, signed), Advance repaid (shown as a positive deduction).
 */
import { roundMoney } from '@/lib/money'
import type { PayWeek, PayWeekPerson } from '@/lib/payroll-pay-week'

export type ExportProvider = 'gusto' | 'adp'

export type AdpExportSettings = { coCode: string; codes: { commission: string; bonus: string; other: string; advance: string } }
export const DEFAULT_ADP_SETTINGS: AdpExportSettings = { coCode: '', codes: { commission: 'COM', bonus: 'BON', other: 'OTH', advance: 'ADV' } }
export const PAYROLL_EXPORT_SETTINGS_KEY = 'payrollExport'

export type ExportPerson = { userId: string; firstName: string; lastName: string; email: string | null; employeeId: string | null }

export type PersonAmounts = { regularHours: number; overtimeHours: number; commission: number; bonus: number; other: number; advance: number; total: number }

/** One person's week split by kind, from their stored lines. Pure. */
export function amountsFor(p: PayWeekPerson): PersonAmounts {
  const sum = (f: (l: PayWeekPerson['lines'][number]) => boolean) => roundMoney(p.lines.filter(f).reduce((s, l) => roundMoney(s + l.amount), 0))
  return {
    regularHours: p.hours?.regular ?? 0,
    overtimeHours: p.hours?.overtime ?? 0,
    commission: sum((l) => l.kind === 'Commission' || l.kind === 'Units' || l.kind === 'Minimum'),
    bonus: sum((l) => l.kind === 'Bonus'),
    other: sum((l) => l.kind === 'Adjustment' && l.adjustmentKind !== 'advance_recovery'),
    advance: roundMoney(-sum((l) => l.kind === 'Adjustment' && l.adjustmentKind === 'advance_recovery')),
    total: p.total,
  }
}

const esc = (v: string | number) => {
  // A value starting with = + - @ would run as a formula when the file is opened in a spreadsheet (a negative number is fine).
  const s = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-\d+(\.\d+)?$/.test(v) ? `'${v}` : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const row = (cells: Array<string | number>) => cells.map(esc).join(',')
const money = (n: number) => n.toFixed(2)
const hours = (n: number) => String(Math.round(n * 100) / 100)

export type ProviderExport = { filename: string; csv: string; people: number; total: number; missing: Array<{ userId: string; name: string; why: string }> }

export function buildProviderExport(args: { provider: ExportProvider; week: PayWeek; people: ReadonlyMap<string, ExportPerson>; adp?: AdpExportSettings }): ProviderExport {
  const { week, provider } = args
  if (week.state !== 'approved') throw new Error('Approve the week first')
  const paid = week.people.filter((p) => p.total > 0 || amountsFor(p).advance > 0)
  const missing: ProviderExport['missing'] = []
  const lines: string[] = []
  const adp = args.adp ?? DEFAULT_ADP_SETTINGS
  const ymd = week.period.weekEnding
  if (provider === 'gusto') {
    lines.push(row(['First name', 'Last name', 'Email', 'Regular hours', 'Overtime hours', 'Commission', 'Bonus', 'Other pay (fixes, balances)', 'Advance repaid (deduct)', 'Total pay']))
    for (const p of paid) {
      const who = args.people.get(p.userId)
      if (!who || !who.lastName) missing.push({ userId: p.userId, name: p.name, why: 'No name on file' })
      const a = amountsFor(p)
      lines.push(row([who?.firstName ?? p.name, who?.lastName ?? '', who?.email ?? '', hours(a.regularHours), hours(a.overtimeHours), money(a.commission), money(a.bonus), money(a.other), money(a.advance), money(p.total)]))
    }
  } else {
    if (!adp.coCode.trim()) missing.push({ userId: '', name: 'Company', why: 'ADP company code is not set' })
    const batch = `${ymd.slice(5, 7)}${ymd.slice(8, 10)}${ymd.slice(2, 4)}`
    lines.push(row(['Co Code', 'Batch ID', 'File #', 'Employee Name', 'Reg Hours', 'O/T Hours', 'Earnings 3 Code', 'Earnings 3 Amount', 'Earnings 4 Code', 'Earnings 4 Amount', 'Earnings 5 Code', 'Earnings 5 Amount', 'Adjust Ded Code', 'Adjust Ded Amount']))
    for (const p of paid) {
      const who = args.people.get(p.userId)
      if (!who?.employeeId) missing.push({ userId: p.userId, name: p.name, why: 'No ADP file number' })
      const a = amountsFor(p)
      lines.push(row([adp.coCode, batch, who?.employeeId ?? '', p.name, hours(a.regularHours), hours(a.overtimeHours), adp.codes.commission, money(a.commission), adp.codes.bonus, money(a.bonus), adp.codes.other, money(a.other), a.advance > 0 ? adp.codes.advance : '', a.advance > 0 ? money(a.advance) : '']))
    }
  }
  return { filename: `${provider}-pay-week-ending-${ymd}.csv`, csv: lines.join('\n') + '\n', people: paid.length, total: week.totals.amount, missing }
}

/** The saved ADP settings, tolerant of anything stored. Pure. */
export function readAdpSettings(settings: unknown): AdpExportSettings {
  const raw = settings && typeof settings === 'object' ? ((settings as Record<string, unknown>)[PAYROLL_EXPORT_SETTINGS_KEY] as Record<string, unknown> | undefined) : undefined
  const code = (v: unknown, d: string) => (typeof v === 'string' && /^[A-Za-z0-9 _-]{1,12}$/.test(v.trim()) ? v.trim() : d)
  const codes = (raw?.codes ?? {}) as Record<string, unknown>
  return { coCode: code(raw?.coCode, ''), codes: { commission: code(codes.commission, 'COM'), bonus: code(codes.bonus, 'BON'), other: code(codes.other, 'OTH'), advance: code(codes.advance, 'ADV') } }
}
