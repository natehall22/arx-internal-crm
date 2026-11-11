/**
 * Automatic customer messages — the rules (pure, client-safe). What each message is, when it is due, its key (one row per
 * key in `customer_messages` = it can never go out twice) and its words. The ONE sender and every database read live in
 * lib/customer-messages-db.ts; the channel (email today, SMS later) in lib/customer-message-channels.ts.
 *
 * Settings: `orgs.settings.customerMessages` (flat keys, owners only, Settings → Customer messages, mergeOrgSettings path
 * ['customerMessages']). Nothing stored = every message OFF. The whole module is also behind the `customerMessages`
 * feature switch (default OFF; lawn & landscape profile ON) — the original company is unchanged unless both are turned on.
 *
 * Every message is rendered for every channel at once (`email` + `sms` text), so SMS plugs in without new wording code.
 */
import { renderCustomerEmail, type EmailCompany } from '@/lib/customer-email-layout'
import { formatCents } from '@/lib/format'
import { addDaysYmd, daysBetweenYmd } from '@/lib/payroll-week-schedule'

export const CUSTOMER_MESSAGES_SETTINGS_KEY = 'customerMessages'

export const MESSAGE_KINDS = ['visit_reminder', 'visit_on_the_way', 'visit_done', 'quote_follow_up', 'invoice_reminder'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

/** Channels a message can go on. Only 'email' has a sender today (lib/customer-message-channels.ts). */
export const MESSAGE_CHANNELS = ['email', 'sms'] as const
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number]

export type CustomerMessageSettings = {
  visitReminder: boolean
  /** Days before the visit (1–7). */
  visitReminderDays: number
  /** Free text arrival window, e.g. "between 8 AM and 5 PM" ('' = not said). */
  visitWindow: string
  /** The gate / pets note every reminder carries ('' = none). Never the property's gate code. */
  visitNote: string
  onTheWay: boolean
  visitDone: boolean
  /** "Done" carries a link to the visit's photos when there are any. */
  visitDonePhotos: boolean
  quoteFollowUp: boolean
  /** Days after the quote was sent (1–60, ≤ 3 of them). */
  quoteFollowUpDays: number[]
  invoiceReminder: boolean
  /** Days from the due date (−30…120; 0 = on the due day, 7 = a week overdue; ≤ 4 of them). */
  invoiceReminderDays: number[]
  /** No message goes out from quietStart:00 to quietEnd:00 in the company's time zone (same hour = never quiet). */
  quietStart: number
  quietEnd: number
}

export const DEFAULT_CUSTOMER_MESSAGE_SETTINGS: Readonly<CustomerMessageSettings> = Object.freeze({
  visitReminder: false,
  visitReminderDays: 1,
  visitWindow: '',
  visitNote: 'Please leave gates unlocked and keep pets inside.',
  onTheWay: false,
  visitDone: false,
  visitDonePhotos: true,
  quoteFollowUp: false,
  quoteFollowUpDays: [3, 7],
  invoiceReminder: false,
  invoiceReminderDays: [0, 7, 14],
  quietStart: 20,
  quietEnd: 8,
})

export const LIMITS = {
  visitReminderDays: [1, 7],
  quoteDays: [1, 60],
  quoteSteps: 3,
  invoiceDays: [-30, 120],
  invoiceSteps: 4,
  window: 60,
  note: 200,
} as const

/** A step that comes due is still sent for this many days (a missed cron run or a short outage), never after. */
export const STEP_GRACE_DAYS = 3
/** A reminder for a visit today (moved late, or added this morning) is sent only before this local hour. */
export const SAME_DAY_REMINDER_BEFORE_HOUR = 11
/** "Done" waits this long, so a mis-tap can be reopened and photos added first. */
export const DONE_DELAY_MINUTES = 15
/** "On the way" is only worth sending this soon; later it is dropped. */
export const ON_THE_WAY_EXPIRES_MINUTES = 60
/** "Done" is dropped if it could not go out within this many hours (e.g. quiet hours + an outage). */
export const DONE_EXPIRES_HOURS = 36
/** Failed sends are tried this many times in all. */
export const MAX_SEND_ATTEMPTS = 3
/** At most this many automatic messages to one address in 24 hours (a bug can never flood a customer). */
export const MAX_PER_ADDRESS_PER_DAY = 4
/** At most this many sends per company per run (the rest wait for the next run; SMTP providers cap daily volume). */
export const MAX_SENDS_PER_RUN = 100
/** Visit photos linked from "done" stay viewable this long. */
export const PHOTO_LINK_DAYS = 90

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  return t.length <= max ? t : null
}

function cleanDays(v: unknown, [lo, hi]: readonly [number, number], maxSteps: number): number[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > maxSteps) return null
  if (!v.every((d) => isInt(d) && d >= lo && d <= hi)) return null
  return Array.from(new Set(v as number[])).sort((a, b) => a - b)
}

/** Stored settings → a full, valid object (anything bad = its default). */
export function readCustomerMessageSettings(stored: unknown): CustomerMessageSettings {
  const s = asObject(stored)
  const d = DEFAULT_CUSTOMER_MESSAGE_SETTINGS
  const bool = (k: keyof CustomerMessageSettings) => (typeof s[k] === 'boolean' ? (s[k] as boolean) : (d[k] as boolean))
  const hour = (k: 'quietStart' | 'quietEnd') => (isInt(s[k]) && (s[k] as number) >= 0 && (s[k] as number) <= 23 ? (s[k] as number) : d[k])
  return {
    visitReminder: bool('visitReminder'),
    visitReminderDays:
      isInt(s.visitReminderDays) && s.visitReminderDays >= LIMITS.visitReminderDays[0] && s.visitReminderDays <= LIMITS.visitReminderDays[1] ? s.visitReminderDays : d.visitReminderDays,
    visitWindow: cleanText(s.visitWindow, LIMITS.window) ?? d.visitWindow,
    visitNote: cleanText(s.visitNote, LIMITS.note) ?? d.visitNote,
    onTheWay: bool('onTheWay'),
    visitDone: bool('visitDone'),
    visitDonePhotos: bool('visitDonePhotos'),
    quoteFollowUp: bool('quoteFollowUp'),
    quoteFollowUpDays: cleanDays(s.quoteFollowUpDays, LIMITS.quoteDays, LIMITS.quoteSteps) ?? [...d.quoteFollowUpDays],
    invoiceReminder: bool('invoiceReminder'),
    invoiceReminderDays: cleanDays(s.invoiceReminderDays, LIMITS.invoiceDays, LIMITS.invoiceSteps) ?? [...d.invoiceReminderDays],
    quietStart: hour('quietStart'),
    quietEnd: hour('quietEnd'),
  }
}

/** Any message turned on? (The sender skips a company with none.) */
export function anyMessageOn(s: CustomerMessageSettings): boolean {
  return s.visitReminder || s.onTheWay || s.visitDone || s.quoteFollowUp || s.invoiceReminder
}

const BOOL_KEYS = ['visitReminder', 'onTheWay', 'visitDone', 'visitDonePhotos', 'quoteFollowUp', 'invoiceReminder'] as const

/** A save from Settings: `{ customerMessages: { … } }` → the keys to merge (flat), or a plain-words refusal. */
export function parseCustomerMessageSettingsPatch(body: unknown): { set: Partial<CustomerMessageSettings> } | { error: string } {
  const patch = asObject(asObject(body).customerMessages)
  const set: Partial<CustomerMessageSettings> = {}
  for (const [k, v] of Object.entries(patch)) {
    if ((BOOL_KEYS as readonly string[]).includes(k)) {
      if (typeof v !== 'boolean') return { error: 'Use on or off' }
      ;(set as Record<string, unknown>)[k] = v
    } else if (k === 'visitReminderDays') {
      if (!isInt(v) || v < LIMITS.visitReminderDays[0] || v > LIMITS.visitReminderDays[1]) return { error: 'Visit reminders go 1 to 7 days before' }
      set.visitReminderDays = v
    } else if (k === 'visitWindow') {
      const t = cleanText(v, LIMITS.window)
      if (t === null) return { error: `Arrival window: ${LIMITS.window} characters at most` }
      set.visitWindow = t
    } else if (k === 'visitNote') {
      const t = cleanText(v, LIMITS.note)
      if (t === null) return { error: `Note: ${LIMITS.note} characters at most` }
      set.visitNote = t
    } else if (k === 'quoteFollowUpDays') {
      const days = cleanDays(v, LIMITS.quoteDays, LIMITS.quoteSteps)
      if (!days) return { error: 'Quote follow-ups: 1 to 3 days, each 1 to 60' }
      set.quoteFollowUpDays = days
    } else if (k === 'invoiceReminderDays') {
      const days = cleanDays(v, LIMITS.invoiceDays, LIMITS.invoiceSteps)
      if (!days) return { error: 'Invoice reminders: 1 to 4 days, each from 30 before to 120 after the due date' }
      set.invoiceReminderDays = days
    } else if (k === 'quietStart' || k === 'quietEnd') {
      if (!isInt(v) || v < 0 || v > 23) return { error: 'Quiet hours: pick an hour' }
      set[k] = v
    } else {
      return { error: `Unknown setting: ${k}` }
    }
  }
  if (Object.keys(set).length === 0) return { error: 'Nothing to save' }
  return { set }
}

// ── Keys ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The one key per message. Same key = the same message: never sent twice. */
export const messageKey = {
  /** One reminder per customer per visit day, however many visits / properties that day. */
  visitReminder: (channel: MessageChannel, customerId: string, visitDay: string) => `visit_reminder:${channel}:${customerId}:${visitDay}`,
  /** Once per visit per day (a second tap is a no-op). */
  onTheWay: (channel: MessageChannel, visitId: string, day: string) => `visit_on_the_way:${channel}:${visitId}:${day}`,
  /** Once per visit, ever (reopened + done again = no second email). */
  visitDone: (channel: MessageChannel, visitId: string) => `visit_done:${channel}:${visitId}`,
  quoteFollowUp: (channel: MessageChannel, proposalId: string, step: number) => `quote_follow_up:${channel}:${proposalId}:${step}`,
  invoiceReminder: (channel: MessageChannel, invoiceId: string, step: number) => `invoice_reminder:${channel}:${invoiceId}:${step}`,
}

// ── Time ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The hour (0–23) of an instant in a zone. DST-safe (Intl). */
export function hourInZone(now: Date, timeZone: string): number {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now))
  return h === 24 ? 0 : h
}

export function isQuietHour(hour: number, s: Pick<CustomerMessageSettings, 'quietStart' | 'quietEnd'>): boolean {
  const { quietStart: a, quietEnd: b } = s
  if (a === b) return false
  return a > b ? hour >= a || hour < b : hour >= a && hour < b
}

/**
 * Is a reminder for a visit on `visitDay` due today? 'ahead' = within the lead days (1…N before); 'today' = the visit is
 * today and it is still morning (moved or added late — the reminder that would have gone out never did); else null.
 */
export function visitReminderTiming(today: string, visitDay: string, leadDays: number, hour: number): 'ahead' | 'today' | null {
  const d = daysBetweenYmd(today, visitDay)
  if (d >= 1 && d <= leadDays) return 'ahead'
  if (d === 0 && hour < SAME_DAY_REMINDER_BEFORE_HOUR) return 'today'
  return null
}

/** The visit days a reminder may be for today: today … today + leadDays. */
export function visitReminderRange(today: string, leadDays: number): { from: string; to: string } {
  return { from: today, to: addDaysYmd(today, leadDays) }
}

/**
 * Which step (days after an anchor) is due, `daysSince` days after it: the latest step reached, and only within
 * STEP_GRACE_DAYS of it — an old quote / invoice when the switch is turned on gets nothing, and two steps never go out on
 * one run.
 */
export function dueStep(daysSince: number, steps: readonly number[]): number | null {
  const reached = steps.filter((s) => s <= daysSince)
  if (reached.length === 0) return null
  const s = Math.max(...reached)
  return daysSince < s + STEP_GRACE_DAYS ? s : null
}

/** "today" / "tomorrow" / "Thursday, November 20". */
export function dayPhrase(today: string, day: string): string {
  const d = daysBetweenYmd(today, day)
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`))
}

/** "November 3" (no weekday). */
export function shortDate(day: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`))
}

// ── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RenderedMessage = { subject: string; html: string; text: string; sms: string }

export type MessageContext = { company: EmailCompany; customerName: string | null; unsubscribeUrl: string | null }

function hi(name: string | null): string {
  const first = (name || '').trim().split(/\s+/)[0]
  return first ? `Hi ${first},` : 'Hello,'
}

function finish(ctx: MessageContext, subject: string, sms: string, body: Omit<Parameters<typeof renderCustomerEmail>[0], 'company' | 'unsubscribeUrl'>): RenderedMessage {
  const { html, text } = renderCustomerEmail({ ...body, company: ctx.company, unsubscribeUrl: ctx.unsubscribeUrl })
  return { subject, html, text, sms: `${ctx.company.name}: ${sms}` }
}

export type ReminderVisit = { address: string | null; what: string }

export function renderVisitReminder(
  ctx: MessageContext,
  v: { today: string; day: string; visits: ReminderVisit[]; window: string; note: string }
): RenderedMessage {
  const when = dayPhrase(v.today, v.day)
  const one = v.visits.length === 1
  const timing = v.window ? ` ${v.window}` : ''
  const lead = `We’ll be at ${one ? 'your property' : 'your properties'} ${when}${timing}.`
  const rows = v.visits.flatMap((x, i) => [
    ...(v.visits.length > 1 ? [{ label: `Stop ${i + 1}`, value: x.address ?? '' }] : x.address ? [{ label: 'Where', value: x.address }] : []),
    { label: 'What', value: x.what },
  ])
  const subject = `Reminder: we’ll see you ${when}`
  return finish(ctx, subject, `${lead}${v.note ? ` ${v.note}` : ''}`, {
    preheader: lead,
    heading: `See you ${when}`,
    paragraphs: [hi(ctx.customerName), lead, ...(v.note ? [v.note] : [])],
    rows: [{ label: 'When', value: `${when === 'today' || when === 'tomorrow' ? `${when[0].toUpperCase()}${when.slice(1)}, ${shortDate(v.day)}` : when}${timing}` }, ...rows],
    footnote: `Need to change it? Reply to this email${ctx.company.phone ? ` or call ${ctx.company.phone}` : ''}.`,
  })
}

export function renderOnTheWay(ctx: MessageContext, v: { address: string | null; what: string }): RenderedMessage {
  const lead = `Our crew is on the way${v.address ? ` to ${v.address}` : ''}.`
  return finish(ctx, 'We’re on our way', lead, {
    preheader: lead,
    heading: 'We’re on our way',
    paragraphs: [hi(ctx.customerName), lead],
    rows: [{ label: 'What', value: v.what }],
    footnote: ctx.company.phone ? `Questions? Call ${ctx.company.phone}.` : null,
  })
}

export function renderVisitDone(ctx: MessageContext, v: { address: string | null; what: string; day: string; photosUrl: string | null }): RenderedMessage {
  const lead = `We finished${v.address ? ` at ${v.address}` : ''} on ${shortDate(v.day)}.`
  return finish(ctx, 'Your visit is done', `${lead}${v.photosUrl ? ` Photos: ${v.photosUrl}` : ''}`, {
    preheader: lead,
    heading: 'All done',
    paragraphs: [hi(ctx.customerName), lead, 'Thank you for having us.'],
    rows: [{ label: 'What', value: v.what }],
    button: v.photosUrl ? { label: 'See the photos', href: v.photosUrl } : null,
    footnote: `Anything not right? Reply to this email${ctx.company.phone ? ` or call ${ctx.company.phone}` : ''}.`,
  })
}

export function renderQuoteFollowUp(
  ctx: MessageContext,
  v: { word: string; number: string | null; total: number | null; sentOn: string; signUrl: string | null }
): RenderedMessage {
  const word = v.word.toLowerCase()
  const name = `${word}${v.number ? ` #${v.number}` : ''}`
  const lead = `Just checking in on the ${name} we sent you on ${shortDate(v.sentOn)}.`
  const ask = v.signUrl ? `You can look it over and sign online with the button below.` : `If it looks good, reply to this email and we’ll get you on the schedule.`
  return finish(ctx, `Following up on your ${name}`, `${lead}${v.signUrl ? ` Sign online: ${v.signUrl}` : ' Reply to this message with any questions.'}`, {
    preheader: lead,
    heading: `Any questions about your ${word}?`,
    paragraphs: [hi(ctx.customerName), lead, ask],
    rows: v.total != null && v.total > 0 ? [{ label: 'Total', value: formatCents(Math.round(v.total * 100)) }] : [],
    button: v.signUrl ? { label: `Review and sign`, href: v.signUrl } : null,
    footnote: `Questions? Reply to this email${ctx.company.phone ? ` or call ${ctx.company.phone}` : ''}.`,
  })
}

export function renderInvoiceReminder(
  ctx: MessageContext,
  v: { invoiceNumber: string; balanceCents: number; dueDay: string; daysPastDue: number; payUrl: string | null }
): RenderedMessage {
  const amount = formatCents(v.balanceCents)
  const lead =
    v.daysPastDue < 0
      ? `Invoice ${v.invoiceNumber} for ${amount} is due on ${shortDate(v.dueDay)}.`
      : v.daysPastDue === 0
        ? `Invoice ${v.invoiceNumber} for ${amount} is due today.`
        : `Invoice ${v.invoiceNumber} for ${amount} was due on ${shortDate(v.dueDay)} and is still open.`
  const subject = v.daysPastDue > 0 ? `Past due: invoice ${v.invoiceNumber}` : `Reminder: invoice ${v.invoiceNumber}`
  return finish(ctx, subject, `${lead}${v.payUrl ? ` Pay online: ${v.payUrl}` : ''}`, {
    preheader: lead,
    heading: v.daysPastDue > 0 ? 'Friendly reminder: invoice past due' : 'Invoice reminder',
    paragraphs: [hi(ctx.customerName), lead, v.payUrl ? 'You can pay online with the button below.' : 'Reply to this email if you have any questions about it.'],
    rows: [
      { label: 'Invoice', value: v.invoiceNumber },
      { label: 'Balance', value: amount },
      { label: 'Due', value: shortDate(v.dueDay) },
    ],
    button: v.payUrl ? { label: `Pay ${amount}`, href: v.payUrl } : null,
    footnote: 'Already paid? Thank you — please ignore this email.',
  })
}

// ── Settings screen: plain words + sample previews ──────────────────────────────────────────────────────────────────

function list(days: number[], unit: (d: number) => string): string {
  const parts = days.map(unit)
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const hourLabel = (h: number) => (h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`)

/** What each message does, in one sentence, from the current settings (the Settings screen shows it under each switch). */
export function describeMessages(s: CustomerMessageSettings, proposalWord = 'Quote'): Record<MessageKind, string> {
  const quote = proposalWord.toLowerCase()
  return {
    visit_reminder: `${s.visitReminderDays === 1 ? 'The day before' : `${s.visitReminderDays} days before`} each visit, one email per customer per day with the date${s.visitWindow ? ', the arrival window' : ''}, what we’re doing${s.visitNote ? ' and your note' : ''}. A moved visit gets a new reminder; a skipped one gets none.`,
    visit_on_the_way: 'When the crew taps “On my way” on their phone list. Sent right away, even in quiet hours (the crew is already coming).',
    visit_done: `${DONE_DELAY_MINUTES} minutes after the crew marks a visit done that day${s.visitDonePhotos ? ', with a link to the visit’s photos when there are any' : ''}. Not sent for visits marked done on a later day.`,
    quote_follow_up: `${list(s.quoteFollowUpDays, (d) => `${d} day${d === 1 ? '' : 's'}`)} after a ${quote} is sent, while it isn’t signed or turned down. Stops as soon as it is.`,
    invoice_reminder: `${list(s.invoiceReminderDays, (d) => (d === 0 ? 'on the due date' : d < 0 ? `${-d} day${d === -1 ? '' : 's'} before it` : `${d} day${d === 1 ? '' : 's'} after it`))}, with a pay link when online payments are on. Stops when it’s paid. Customers on automatic payments only hear once their card has been tried and failed.`,
  }
}

export function quietHoursPhrase(s: Pick<CustomerMessageSettings, 'quietStart' | 'quietEnd'>): string {
  return s.quietStart === s.quietEnd ? 'Messages can go out at any hour.' : `Nothing is sent between ${hourLabel(s.quietStart)} and ${hourLabel(s.quietEnd)} (your time zone); it waits until morning.`
}

/** Sample messages for the Settings preview, with the company's own brand and the current settings. */
export function sampleMessages(company: EmailCompany, s: CustomerMessageSettings, today: string, proposalWord = 'Quote'): Record<MessageKind, RenderedMessage> {
  const ctx: MessageContext = { company, customerName: 'Jane Smith', unsubscribeUrl: 'https://example.com/m/sample' }
  const day = addDaysYmd(today, s.visitReminderDays)
  return {
    visit_reminder: renderVisitReminder(ctx, { today, day, visits: [{ address: '123 Oak Street', what: 'Weekly lawn care' }], window: s.visitWindow, note: s.visitNote }),
    visit_on_the_way: renderOnTheWay(ctx, { address: '123 Oak Street', what: 'Weekly lawn care' }),
    visit_done: renderVisitDone(ctx, { address: '123 Oak Street', what: 'Weekly lawn care', day: today, photosUrl: s.visitDonePhotos ? 'https://example.com/m/sample' : null }),
    quote_follow_up: renderQuoteFollowUp(ctx, { word: proposalWord, number: '1042', total: 1850, sentOn: addDaysYmd(today, -(s.quoteFollowUpDays[0] ?? 3)), signUrl: null }),
    invoice_reminder: renderInvoiceReminder(ctx, { invoiceNumber: 'INV-26-00042', balanceCents: 18500, dueDay: addDaysYmd(today, -(s.invoiceReminderDays.find((d) => d > 0) ?? 7)), daysPastDue: s.invoiceReminderDays.find((d) => d > 0) ?? 7, payUrl: 'https://example.com/pay/sample' }),
  }
}
