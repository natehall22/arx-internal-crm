import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getOrgEmailBlastSettings,
  morningUpdateFocusFor,
  resolveEmailBlastRecipients,
  type MorningUpdateFocus,
} from '@/lib/admin-email-blasts'
import { fetchMorningUpdateMetrics, type MorningUpdateMetrics } from '@/lib/morning-update-metrics'
import { loadDataHealth, needsYouForEmailRecipient, shapeNeedsYou, type DataHealthReport } from '@/lib/data-health'
import { loadCheckupSettings } from '@/lib/checkups'
import { loadCheckupsDueQueue, loadCrewWeekQueue, loadOpsQueues, loadOwnerExceptions, loadStormHitsQueue, type Queue } from '@/lib/today'
import { getAppUrl, tryGetAppUrl } from '@/lib/app-url'
import { formatPhone, telHref } from '@/lib/format'
import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatInteger(value: number): string {
  return value.toLocaleString('en-US')
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatGoalShareValue(
  actual: number,
  goal: number | null,
  shareOfMonthPct: number | null,
  format: 'integer' | 'currency'
): string {
  const actualText = format === 'currency' ? formatCurrency(actual) : formatInteger(actual)
  if (goal == null) {
    return `${actualText} · No goal set`
  }
  const goalText = format === 'currency' ? formatCurrency(goal) : formatInteger(goal)
  const pctText = shareOfMonthPct != null ? ` (${shareOfMonthPct}% of month)` : ''
  return `${actualText} · goal ${goalText}${pctText}`
}

const MORNING_UPDATE_FOOTER_QUOTE =
  'Yes, it is 5:30am. No, the coffee is not optional. The numbers, however, are.'

function activityLabelPrefix(kind: MorningUpdateMetrics['activityPeriodKind']): string {
  return kind === 'weekend' ? 'Weekend' : 'Yesterday'
}

function formatOptionalInteger(value: number | null): string {
  return value == null ? 'Unavailable' : formatInteger(value)
}

function metricSection(
  heading: string,
  subline: string,
  metrics: {
    doors: number
    inspections: number
    proposals: number | null
    sales: number
    revenue: number
    insurance: number
  }
): string {
  const rows = [
    { label: 'Doors knocked', value: formatInteger(metrics.doors) },
    { label: 'Inspections scheduled', value: formatInteger(metrics.inspections) },
    { label: 'Proposals shown', value: formatOptionalInteger(metrics.proposals) },
    { label: 'Sales', value: formatInteger(metrics.sales) },
    { label: 'Revenue sold', value: formatCurrency(metrics.revenue) },
    { label: 'Inspections going through insurance', value: formatInteger(metrics.insurance) },
  ]
    .map(
      (row) =>
        `<tr><td style="padding: 8px 0; color: #6B7280; width: 280px; vertical-align: top;">${escapeHtml(row.label)}</td><td style="padding: 8px 0; color: #111827; font-weight: 600; font-size: 16px;">${escapeHtml(row.value)}</td></tr>`
    )
    .join('')

  return `
    <h2 style="margin: 26px 0 4px; color: #111827; font-size: 18px;">${escapeHtml(heading)}</h2>
    <p style="margin: 0 0 8px; color: #6B7280; font-size: 13px;">${subline}</p>
    <table style="width: 100%; border-collapse: collapse; margin: 0 0 8px;">${rows}</table>
  `
}

/** Job rows listed in the email before collapsing to "and N more" (the dashboard has them all). */
const NEEDS_YOU_EMAIL_JOB_ROWS = 20

/**
 * "Needs you" block for the morning email — the same data-health check as the ops
 * dashboard. Job numbers and plain-English problems only, no customer details.
 * Exported for tests.
 */
/**
 * Links in the morning email are a convenience: with no app address configured the email still goes out, and every link
 * renders as plain text (an <a> with no href) instead of failing the whole email.
 */
function morningEmailBase(appUrl?: string | null): string {
  return appUrl ? getAppUrl({ appUrl }) : tryGetAppUrl('morning email links') ?? ''
}

/** With no base, the builders produced site-relative hrefs, which mean nothing in an inbox: drop them. */
function withoutRelativeLinks(html: string, base: string): string {
  return base ? html : html.replace(/<a href="\/[^"]*"/g, '<a')
}

export function buildNeedsYouHtml(report: DataHealthReport, appUrl?: string | null): string {
  const base = morningEmailBase(appUrl)
  return withoutRelativeLinks(needsYouHtml(report, base), base)
}

function needsYouHtml(report: DataHealthReport, base: string): string {
  const dashboardUrl = `${base}/ops/dashboard`
  if (report.count === 0) {
    return `
        <h2 style="margin: 28px 0 6px; color: #111827; font-size: 17px;">Needs you</h2>
        <p style="margin: 0 0 8px; color: #2c2c2a; font-size: 14px;">All clear — no job has missing or conflicting info.</p>
      `
  }
  const holdsPay = report.jobs.filter((j) => j.problems.some((p) => p.blocksPay)).length
  const rows = report.jobs
    .slice(0, NEEDS_YOU_EMAIL_JOB_ROWS)
    .map((job) => {
      const items = job.problems
        .map((p) => {
          const hold = p.blocksPay ? ' <strong style="color: #991b1b;">(holds pay)</strong>' : ''
          return `<li style="margin: 2px 0;">${escapeHtml(p.message)}${hold} — <a href="${escapeHtml(base + p.fixHref)}" style="color: #2b0a3d;">${escapeHtml(p.fixLabel)}</a></li>`
        })
        .join('')
      return `<tr><td style="padding: 8px 12px 8px 0; color: #2c2c2a; font-weight: 600; vertical-align: top; white-space: nowrap;"><a href="${escapeHtml(`${base}/ops/jobs/${job.jobId}`)}" style="color: #2c2c2a;">Job ${escapeHtml(job.jobNumber)}</a></td><td style="padding: 8px 0; color: #2c2c2a; font-size: 14px;"><ul style="margin: 0; padding-left: 18px;">${items}</ul></td></tr>`
    })
    .join('')
  const moreJobs = report.jobs.length - NEEDS_YOU_EMAIL_JOB_ROWS
  const moreLine = moreJobs > 0 ? `<p style="margin: 4px 0; color: #2c2c2a; font-size: 13px;">…and ${moreJobs} more jobs.</p>` : ''
  const apptLine =
    report.appointments.length > 0
      ? `<p style="margin: 8px 0; color: #2c2c2a; font-size: 14px;">${report.appointments.length} past appointment${report.appointments.length === 1 ? '' : 's'} with no outcome logged.</p>`
      : ''
  return `
        <h2 style="margin: 28px 0 6px; color: #111827; font-size: 17px;">Needs you (${report.count})</h2>
        <p style="margin: 0 0 10px; color: #2c2c2a; font-size: 13px;">${holdsPay > 0 ? `${holdsPay} job${holdsPay === 1 ? '' : 's'} can&apos;t be paid until fixed. ` : ''}<a href="${escapeHtml(dashboardUrl)}" style="color: #2b0a3d;">See the full list</a>.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 0 0 8px;">${rows}</table>
        ${moreLine}
        ${apptLine}
      `
}

/** Queue rows listed per queue before "and N more" (the Today screen has them all). */
const TODAY_EMAIL_ROWS = 8
/** Storm hits are a call list that is not on the Today screen, so the email lists them all (up to this). */
const STORM_EMAIL_ROWS = 40

/**
 * The "Today" queues for one focus — the same queue definitions as the Today screen (lib/today.ts), one load per focus,
 * not per person. 'all' = owner exceptions; the no-outcome appointments queue is left out because "Needs you" already
 * reports it. 'crews' = this week's crews and sold jobs with no install date.
 */
export async function loadMorningTodayQueues(
  supabase: SupabaseClient,
  orgId: string,
  focus: MorningUpdateFocus,
  now = new Date()
): Promise<Queue[]> {
  if (focus === 'crews') {
    const [crews, ops] = await Promise.all([loadCrewWeekQueue(supabase, orgId, now), loadOpsQueues(supabase, orgId)])
    return [crews, ...ops.filter((q) => q.id === 'jobs-to-schedule')]
  }
  // Storm hits lead: they are the most time-sensitive, and only this version carries them (ops don't need them).
  // A storm lookup failure drops only the storm list (and says so), never the rest of Today.
  let stormFailed = false
  let checkupsFailed = false
  const [storm, owner, checkups] = await Promise.all([
    loadStormHitsQueue(supabase, orgId, now, STORM_EMAIL_ROWS).catch((error): Queue => {
      console.error('morning update: storm hits failed', error)
      stormFailed = true
      return { id: 'storm-hits', title: 'Storm hits on open deals and customers', count: 0, empty: 'Storm hits couldn’t load today.', items: [] }
    }),
    loadOwnerExceptions(supabase, orgId, now, { money: false }),
    // Customer checkups due (created earlier in the same cron run by ensureCheckups; off unless the org turned them on).
    loadCheckupSettings(supabase, orgId)
      .then(async (s): Promise<Queue | null> => (s.enabled ? loadCheckupsDueQueue(supabase, orgId, now) : null))
      .catch((error): Queue => {
        console.error('morning update: checkups failed', error)
        checkupsFailed = true
        return { id: 'checkups-due', title: 'Customer checkups due', count: 0, empty: 'Checkups couldn’t load today.', items: [] }
      }),
  ])
  return [
    ...(storm.count > 0 || stormFailed ? [storm] : []),
    ...owner.filter((q) => q.id !== 'no-outcome'),
    ...(checkups && (checkups.count > 0 || checkupsFailed) ? [checkups] : []),
  ]
}

/**
 * "Today" block: what to act on this morning. Job/proposal numbers and plain facts — no customer details, except the
 * storm-hits call list (name + tap-to-call), which only the "Everything" version loads.
 */
export function buildTodayHtml(queues: Queue[] | null, appUrl?: string | null): string {
  const base = morningEmailBase(appUrl)
  return withoutRelativeLinks(todayHtml(queues, base), base)
}

function todayHtml(queues: Queue[] | null, base: string): string {
  const heading = '<h2 style="margin: 24px 0 6px; color: #111827; font-size: 18px;">Today</h2>'
  // A failed load must never read as "nothing to do".
  if (queues === null) {
    return `${heading}<p style="margin: 0 0 8px; color: #2c2c2a; font-size: 14px;">Today&apos;s list couldn&apos;t load. <a href="${escapeHtml(`${base}/today`)}" style="color: #2b0a3d;">Open Today</a>.</p>`
  }
  if (queues.length === 0) {
    return `${heading}<p style="margin: 0 0 8px; color: #2c2c2a; font-size: 14px;">Nothing is waiting on you.</p>`
  }
  const blocks = queues
    .map((q) => {
      if (q.count === 0) {
        return `<h3 style="margin: 14px 0 4px; color: #111827; font-size: 15px;">${escapeHtml(q.title)}</h3><p style="margin: 0; color: #2c2c2a; font-size: 14px;">${escapeHtml(q.empty)}</p>`
      }
      const cap = q.id === 'storm-hits' ? STORM_EMAIL_ROWS : TODAY_EMAIL_ROWS
      const rows = q.items
        .slice(0, cap)
        .map((i) => {
          const note = i.note ? ` — ${escapeHtml(i.note)}` : ''
          const tel = telHref(i.phone)
          const call = tel
            ? ` · <a href="${escapeHtml(tel)}" style="color: #2b0a3d; font-weight: 600; white-space: nowrap;">${escapeHtml(formatPhone(i.phone))}</a>`
            : i.phone
              ? ` · ${escapeHtml(i.phone)}`
              : ''
          return `<li style="margin: 3px 0; color: #2c2c2a; font-size: 14px;"><a href="${escapeHtml(base + i.href)}" style="color: #2b0a3d; font-weight: 600;">${escapeHtml(i.ref)}</a>${note}${call}</li>`
        })
        .join('')
      const more = q.count - Math.min(q.items.length, cap)
      const moreLine =
        more <= 0
          ? ''
          : q.id === 'storm-hits'
            ? `<li style="margin: 3px 0; color: #2c2c2a; font-size: 13px;">…and ${more} more.</li>`
            : `<li style="margin: 3px 0; color: #2c2c2a; font-size: 13px;">…and ${more} more on <a href="${escapeHtml(`${base}/today`)}" style="color: #2b0a3d;">Today</a>.</li>`
      return `<h3 style="margin: 14px 0 4px; color: #111827; font-size: 15px;">${escapeHtml(q.title)} (${q.count})</h3><ul style="margin: 0; padding-left: 18px;">${rows}${moreLine}</ul>`
    })
    .join('')
  return `${heading}${blocks}`
}

export function buildMorningUpdateHtml(
  metrics: MorningUpdateMetrics,
  /** `today`: undefined = no Today block; null = it failed to load (says so). */
  options?: { test?: boolean; needsYou?: DataHealthReport | null; today?: Queue[] | null }
): string {
  const period = activityLabelPrefix(metrics.activityPeriodKind)

  const activitySubline =
    metrics.activityPeriodKind === 'weekend'
      ? `Weekend activity (${escapeHtml(metrics.activityPeriodLabel)})`
      : `Yesterday&apos;s activity (${escapeHtml(metrics.activityPeriodLabel)})`

  let lastWeekSection = ''
  if (metrics.lastWeekVsGoals) {
    const w = metrics.lastWeekVsGoals
    const weekRows = [
      {
        label: 'Proposals shown',
        value: formatOptionalInteger(w.proposalsShown),
      },
      {
        label: 'Doors',
        value: formatGoalShareValue(w.doors.actual, w.doors.goal, w.doors.shareOfMonthPct, 'integer'),
      },
      {
        label: 'Inspections set',
        value: formatGoalShareValue(w.sets.actual, w.sets.goal, w.sets.shareOfMonthPct, 'integer'),
      },
      {
        label: 'Sales',
        value: formatGoalShareValue(w.sales.actual, w.sales.goal, w.sales.shareOfMonthPct, 'integer'),
      },
      {
        label: 'Revenue',
        value: formatGoalShareValue(
          w.revenue.actual,
          w.revenue.goal,
          w.revenue.shareOfMonthPct,
          'currency'
        ),
      },
    ]
      .map(
        (row) =>
          `<tr><td style="padding: 8px 0; color: #2c2c2a; width: 280px; vertical-align: top;">${escapeHtml(row.label)}</td><td style="padding: 8px 0; color: #2c2c2a; font-weight: 600; font-size: 15px;">${escapeHtml(row.value)}</td></tr>`
      )
      .join('')

    lastWeekSection = `
        <h2 style="margin: 28px 0 6px; color: #111827; font-size: 17px;">Last week vs ${escapeHtml(w.monthGoalLabel)} goals</h2>
        <p style="margin: 0 0 12px; color: #2c2c2a; font-size: 13px;">${escapeHtml(w.rangeLabel)} totals as a share of this month&apos;s targets</p>
        <table style="width: 100%; border-collapse: collapse; margin: 0 0 8px;">
          ${weekRows}
        </table>
      `
  }

  return `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        ${options?.test ? '<p style="margin: 0 0 16px; padding: 10px 12px; background: #fef3c7; color: #92400e; border-radius: 8px; font-size: 13px; font-weight: 600;">Test email — not sent on the daily schedule.</p>' : ''}
        <h1 style="margin: 0 0 8px; color: #111827; font-size: 22px;">ARX Morning Update</h1>
        <p style="margin: 0 0 4px; color: #111827; font-size: 14px; font-weight: 600;">${escapeHtml(metrics.sentDateLabel)}</p>
        ${options?.today !== undefined ? buildTodayHtml(options.today) : ''}
        ${metricSection(period, activitySubline, {
          doors: metrics.doorsKnockedPeriod,
          inspections: metrics.inspectionsScheduledPeriod,
          proposals: metrics.proposalsShownPeriod,
          sales: metrics.salesPeriod,
          revenue: metrics.revenuePeriod,
          insurance: metrics.insuranceInspectionsPeriod,
        })}
        ${metricSection('Week to date', 'Sunday through yesterday', {
          doors: metrics.doorsKnockedWeekToDate,
          inspections: metrics.inspectionsScheduledWeekToDate,
          proposals: metrics.proposalsShownWeekToDate,
          sales: metrics.salesWeekToDate,
          revenue: metrics.revenueWeekToDate,
          insurance: metrics.insuranceInspectionsWeekToDate,
        })}
        ${metricSection('Month to date', 'First of the month through yesterday', {
          doors: metrics.doorsKnockedMonthToDate,
          inspections: metrics.inspectionsScheduledMonthToDate,
          proposals: metrics.proposalsShownMonthToDate,
          sales: metrics.salesMonthToDate,
          revenue: metrics.revenueMonthToDate,
          insurance: metrics.insuranceInspectionsMonthToDate,
        })}
        ${lastWeekSection}
        ${options?.needsYou ? buildNeedsYouHtml(options.needsYou) : ''}
        <p style="color: #6B7280; font-size: 12px; margin-top: 20px;">
          Automated owner morning update from ARX CRM. Proposals shown is based on unique opportunities with a generated proposal PDF during the period. Revenue reflects signed installation and repair agreements. Insurance inspections are counted when feedback is recorded as Insurance Follow Up or Waiting on Insurance.
        </p>
        <p style="color: #9CA3AF; font-size: 12px; font-style: italic; margin: 12px 0 0;">
          ${escapeHtml(MORNING_UPDATE_FOOTER_QUOTE)}
        </p>
      </div>
    `
}

export async function sendMorningUpdateEmail(
  supabase: SupabaseClient,
  params: {
    orgId: string
    metrics?: MorningUpdateMetrics
    /** Bypasses blast settings; sends only to these addresses with a [TEST] subject prefix. */
    testToEmails?: string[]
    /** Test only: preview a focus instead of the recipient's own setting. */
    testFocus?: MorningUpdateFocus
  }
): Promise<{ sent: number; skipped: boolean; reason?: string }> {
  if (!process.env.SMTP_HOST) {
    return { sent: 0, skipped: true, reason: 'smtp_not_configured' }
  }

  const isTest = Array.isArray(params.testToEmails) && params.testToEmails.length > 0
  let emails: string[] = []

  // Settings are read on the test path too: who gets which version of the email lives there.
  const { data: orgRow, error: orgError } = await supabase
    .from('orgs')
    .select('settings')
    .eq('id', params.orgId)
    .maybeSingle()

  if (orgError) {
    console.error('sendMorningUpdateEmail: org settings query', orgError)
    throw orgError
  }

  const settings = getOrgEmailBlastSettings(orgRow?.settings)

  if (isTest) {
    emails = Array.from(
      new Set(
        params.testToEmails!
          .map((email) => email.trim().toLowerCase())
          .filter((email) => email.includes('@'))
      )
    )
  } else {
    const resolved = await resolveEmailBlastRecipients(supabase, {
      orgId: params.orgId,
      blastType: 'morning_update',
      settings,
    })
    emails = resolved.emails
  }

  if (emails.length === 0) {
    return { sent: 0, skipped: true, reason: 'no_recipients' }
  }

  const metrics = params.metrics ?? (await fetchMorningUpdateMetrics(supabase, params.orgId))
  const transporter = getMailTransport()
  const subjectPrefix = isTest ? '[TEST] ' : ''
  const subject = `${subjectPrefix}ARX Morning Update — ${metrics.sentDateLabel}`
  // The daily data-health check rides along. It must never stop the update going out.
  let needsYou: DataHealthReport | null = null
  try {
    needsYou = await loadDataHealth(supabase, params.orgId)
  } catch (error) {
    console.error('sendMorningUpdateEmail: data health failed', error)
  }
  // "Needs you" per recipient, by the one rule in lib/data-health.ts: owners get everything, operations people get the
  // operational rows (no dollars), everyone else gets the email WITHOUT the section. Recipients are matched to their user
  // row by email; an address with no user row is treated as having no role (no section).
  const { data: recipientRows, error: recipientError } = await supabase
    .from('users')
    .select('id, email, role, is_super_admin, active')
    .eq('org_id', params.orgId)
  if (recipientError) {
    // Fail closed: without the user list nobody gets the section.
    console.error('sendMorningUpdateEmail: could not load recipients (is migration 202610210010 applied?)', recipientError.message)
  }
  type Viewer = { id: string | null; role: string | null; is_super_admin: boolean | null; active: boolean | null }
  const viewerByEmail = new Map<string, Viewer>()
  for (const u of (recipientRows || []) as Array<{ id: string; email: string | null; role: string | null; is_super_admin: boolean | null; active: boolean | null }>) {
    const key = String(u.email || '').trim().toLowerCase()
    // Two user rows with one address: it is ambiguous who is reading, so fail closed (no section) — never the more privileged row.
    viewerByEmail.set(key, viewerByEmail.has(key) ? { id: null, role: null, is_super_admin: false, active: false } : { id: u.id, role: u.role, is_super_admin: u.is_super_admin, active: u.active })
  }
  const focusFor = (to: string): MorningUpdateFocus =>
    (isTest && params.testFocus) || morningUpdateFocusFor(settings.morning_update, viewerByEmail.get(to.trim().toLowerCase())?.id)

  // "Today" is loaded once per focus in use. Like "Needs you", a failure drops the section and never stops the email.
  const todayByFocus = new Map<MorningUpdateFocus, Queue[] | null>()
  for (const focus of Array.from(new Set(emails.map(focusFor)))) {
    try {
      todayByFocus.set(focus, await loadMorningTodayQueues(supabase, params.orgId, focus))
    } catch (error) {
      console.error(`sendMorningUpdateEmail: today queues failed (${focus})`, error)
      todayByFocus.set(focus, null)
    }
  }

  const htmlFor = (to: string): string => {
    const focus = focusFor(to)
    const today = todayByFocus.get(focus) ?? null
    let shaped = needsYou ? needsYouForEmailRecipient(needsYou, viewerByEmail.get(to.trim().toLowerCase())) : null
    // Crews focus only narrows: an owner on 'crews' gets the operational rows (no dollars), never more than their role allows.
    if (shaped && needsYou && focus === 'crews') shaped = shapeNeedsYou(needsYou, 'ops')
    return buildMorningUpdateHtml(metrics, { test: isTest, needsYou: shaped, today })
  }

  let sent = 0
  let failed = 0
  for (const to of emails) {
    try {
      await transporter.sendMail({
        from: getCrmEmailFrom(),
        to,
        subject,
        html: htmlFor(to),
      })
      sent += 1
    } catch (error) {
      failed += 1
      console.error('sendMorningUpdateEmail: send failed', to, error)
    }
  }

  if (sent === 0) {
    return { sent: 0, skipped: true, reason: failed > 0 ? 'send_failed' : 'no_recipients' }
  }

  return { sent, skipped: false }
}
