/**
 * The free-text `leads.source` values a person picks by hand (New Lead form, lead edit page).
 * Single home — do not re-list these in a component. The leads-list Source filter does NOT use
 * this; it lists `lead_sources` table rows only.
 *
 * Not the same thing as the `lead_sources` table: that holds automated integrations (webhooks,
 * website forms) with field mapping and auto-assign, and is linked by `leads.lead_source_id`.
 *
 * 'yelp' added 2026-09-28 so Yelp calls/messages are attributable before any Yelp Ads spend —
 * the May–Jun 2026 Yelp run produced ~15 leads that landed as 'other'/'call_in' and could never
 * be tied to a closed job.
 */
export const MANUAL_LEAD_SOURCES = [
  { value: 'ad_campaign', label: 'Ad campaign' },
  { value: 'door_to_door', label: 'Door to door' },
  { value: 'call_in', label: 'Call in' },
  { value: 'call_center', label: 'Call center' },
  { value: 'referral', label: 'Referral' },
  { value: 'web', label: 'Web' },
  { value: 'yelp', label: 'Yelp' },
  { value: 'other', label: 'Other' },
] as const

/**
 * Stored values that exist in production but are not offered on the New Lead form. The edit page
 * must still list them, or its <select> renders blank and saving writes `source: null`
 * (canvass is ~96% of leads — see app/leads/[id]/page.tsx).
 */
const SYSTEM_LEAD_SOURCES = [
  { value: 'canvass', label: 'Canvass' },
  { value: 'csv_import', label: 'CSV import' },
] as const

const LABELS: Record<string, string> = Object.fromEntries(
  [...SYSTEM_LEAD_SOURCES, ...MANUAL_LEAD_SOURCES].map((s) => [s.value, s.label])
)

/** Human label for any stored source; unknown free-text values (website forms) pass through. */
export function leadSourceLabel(source: string): string {
  return LABELS[source] ?? source.replace(/_/g, ' ')
}

/** Options for editing an existing lead: every known value, plus the lead's own if unrecognised. */
export function leadSourceEditOptions(current: string | null | undefined): string[] {
  const values: string[] = [
    ...SYSTEM_LEAD_SOURCES.map((s) => s.value),
    ...MANUAL_LEAD_SOURCES.map((s) => s.value),
  ]
  if (current && !values.includes(current)) values.push(current)
  return values
}
