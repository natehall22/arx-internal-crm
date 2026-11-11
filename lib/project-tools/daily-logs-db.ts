/**
 * Daily log (server). One note + photos + weather per entry (job_daily_logs). Photos are the job's ordinary photos
 * (`photos`, tag `daily_log`, uploaded through the existing register/finalize routes); the log keeps their ids.
 * Two doors write it: staff on the job page (/api/ops/jobs/[id]/daily-logs) and crews on their link
 * (/api/crew/[token]/daily-log); both call `createDailyLog`. Weather is filled from the National Weather Service when the
 * job has coordinates (best effort, 4 s, never blocks the log).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

import { buildDailyLogSummaryEmail } from '@/lib/contracts/customer-emails'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { getDocumentBrand } from '@/lib/org-brand'
import { isMissingProjectToolsSchema, PROJECT_TOOLS_NOT_READY } from '@/lib/project-tools/budget-db'
import { loadJobContact } from '@/lib/project-tools/selections-db'
import { orgDb } from '@/lib/supabase/org-db'
import { ymdLabel } from '@/lib/ymd-label'
import { NWS_USER_AGENT } from '@/lib/weather-nws'

type Fail = { error: string; status: number }

export const DAILY_LOG_TAG = 'daily_log'
export const DAILY_LOG_MAX_PHOTOS = 20
export const DAILY_LOG_MAX_NOTE = 4000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type DailyLogView = { id: string; log_date: string; note: string; weather: string | null; photo_ids: string[]; author_name: string | null; source: string; summary_sent_at: string | null; created_at: string }

const COLUMNS = 'id, log_date, note, weather, photo_ids, author_name, source, summary_sent_at, created_at'

/** One-line weather from the NWS hourly forecast ("Mostly sunny, 72°F, wind 5 mph"). null when unknown. */
export async function fetchWeatherLine(lat: number | null | undefined, lng: number | null | undefined, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  try {
    const headers = { 'User-Agent': NWS_USER_AGENT, Accept: 'application/geo+json' }
    const signal = AbortSignal.timeout(4000)
    const point = await fetcher(`https://api.weather.gov/points/${lat.toFixed(2)},${lng.toFixed(2)}`, { headers, signal })
    if (!point.ok) return null
    const hourlyUrl = (await point.json())?.properties?.forecastHourly
    if (typeof hourlyUrl !== 'string' || !hourlyUrl.startsWith('https://api.weather.gov/')) return null
    const res = await fetcher(hourlyUrl, { headers, signal })
    if (!res.ok) return null
    const p = (await res.json())?.properties?.periods?.[0]
    if (!p || typeof p.shortForecast !== 'string') return null
    const temp = typeof p.temperature === 'number' ? `, ${Math.round(p.temperature)}°${p.temperatureUnit === 'C' ? 'C' : 'F'}` : ''
    const wind = typeof p.windSpeed === 'string' && p.windSpeed ? `, wind ${p.windSpeed}` : ''
    return `${p.shortForecast}${temp}${wind}`.slice(0, 200)
  } catch {
    return null
  }
}

export async function listDailyLogs(admin: SupabaseClient, orgId: string, jobId: string, limit = 30): Promise<{ logs: DailyLogView[]; ready: boolean }> {
  const { data, error } = await orgDb(admin, orgId).from('job_daily_logs').select(COLUMNS).eq('job_id', jobId).order('log_date', { ascending: false }).order('created_at', { ascending: false }).limit(limit)
  if (error) {
    if (!isMissingProjectToolsSchema(error)) console.error('[daily log] list failed', error)
    return { logs: [], ready: false }
  }
  return { logs: (data ?? []) as DailyLogView[], ready: true }
}

export async function createDailyLog(
  admin: SupabaseClient,
  args: { orgId: string; jobId: string; logDate: string; note: unknown; photoIds: unknown; weather?: unknown; lat?: number | null; lng?: number | null; userId: string | null; authorName: string; source: 'staff' | 'crew'; workOrderId?: string | null }
): Promise<{ log: DailyLogView } | Fail> {
  const note = typeof args.note === 'string' ? args.note.trim().slice(0, DAILY_LOG_MAX_NOTE) : ''
  const photoIds = Array.isArray(args.photoIds) ? Array.from(new Set(args.photoIds.filter((p): p is string => typeof p === 'string' && UUID_RE.test(p)))).slice(0, DAILY_LOG_MAX_PHOTOS) : []
  if (!note && photoIds.length === 0) return { error: 'Write a note or add a photo', status: 400 }
  const db = orgDb(admin, args.orgId)
  if (photoIds.length > 0) {
    // Only this job's own daily-log photos can be attached (never another job's or company's).
    const { data: ok } = await db.from('photos').select('id').eq('job_id', args.jobId).eq('photo_tag', DAILY_LOG_TAG).in('id', photoIds)
    if ((ok ?? []).length !== photoIds.length) return { error: 'A photo did not upload. Try adding it again.', status: 400 }
  }
  const typedWeather = typeof args.weather === 'string' ? args.weather.trim().slice(0, 200) : ''
  const weather = typedWeather || (await fetchWeatherLine(args.lat, args.lng))
  const { data, error } = await db
    .from('job_daily_logs')
    .insert({ job_id: args.jobId, log_date: args.logDate, note, weather, photo_ids: photoIds, work_order_id: args.workOrderId ?? null, created_by: args.userId, author_name: args.authorName.slice(0, 120) || null, source: args.source })
    .select(COLUMNS)
    .single()
  if (error || !data) return isMissingProjectToolsSchema(error) ? { error: PROJECT_TOOLS_NOT_READY, status: 409 } : { error: 'Could not save the log', status: 500 }
  return { log: data as DailyLogView }
}

/** Email one log to the customer ("Send summary"). Once per log unless `again`: the send is CLAIMED first (summary_sent_at), so a double tap or two devices send one email; a failed send releases the claim. */
export async function sendDailyLogSummary(admin: SupabaseClient, args: { orgId: string; jobId: string; logId: string; senderName: string; again?: boolean; job: { customer_id: string | null; project_id: string | null; address_text: string | null } }): Promise<{ sentTo: string } | Fail> {
  const db = orgDb(admin, args.orgId)
  const { data: log } = await db.from('job_daily_logs').select(COLUMNS).eq('id', args.logId).eq('job_id', args.jobId).maybeSingle()
  if (!log) return { error: 'Log not found', status: 404 }
  const contact = await loadJobContact(admin, args.orgId, args.job)
  if (!contact.email) return { error: 'There is no email address on file for this customer.', status: 409 }
  const claimAt = new Date().toISOString()
  let claim = db.from('job_daily_logs').update({ summary_sent_at: claimAt, summary_sent_to: contact.email }).eq('id', args.logId).eq('job_id', args.jobId)
  if (!args.again) claim = claim.is('summary_sent_at', null)
  const { data: claimed } = await claim.select('id')
  if (!claimed || claimed.length === 0) return { error: 'This summary was already sent to the customer.', status: 409 }
  const release = () => (args.again ? Promise.resolve() : db.from('job_daily_logs').update({ summary_sent_at: null, summary_sent_to: null }).eq('id', args.logId).eq('job_id', args.jobId).eq('summary_sent_at', claimAt))
  const brand = await getDocumentBrand(admin, args.orgId)
  const dateLabel = ymdLabel(log.log_date, { long: true })
  const mail = buildDailyLogSummaryEmail({ brand, customerName: contact.name, dateLabel, address: contact.address, note: log.note || 'Work continued on your project today.', weather: log.weather, photoCount: (log.photo_ids ?? []).length, repName: args.senderName || brand.name })
  try {
    const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
    await transporter.sendMail({ from: getCrmEmailFrom(), to: contact.email, subject: mail.subject, text: mail.text, html: mail.html })
  } catch (e) {
    console.error('[daily log] summary email failed', e)
    await release()
    return { error: 'The email could not be sent. Try again.', status: 502 }
  }
  return { sentTo: contact.email }
}
