/**
 * Service billing choices (`orgs.settings.serviceBilling`, owners, Settings → Payments & tax). Written ONLY at path
 * ['serviceBilling'] through mergeOrgSettings (/api/admin/service-billing). Pure reader here (client-safe).
 *   autoDraftOnDone — when a per-visit plan visit is marked done, make ONE draft invoice for it (never sent). Default OFF.
 */
export const SERVICE_BILLING_SETTINGS_KEY = 'serviceBilling'

export type ServiceBillingSettings = { autoDraftOnDone: boolean }

/** From `orgs.settings` (or the `serviceBilling` object itself). Only an explicit true turns it on. */
export function readServiceBillingSettings(stored: unknown): ServiceBillingSettings {
  const o = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  const inner = o[SERVICE_BILLING_SETTINGS_KEY] && typeof o[SERVICE_BILLING_SETTINGS_KEY] === 'object' ? (o[SERVICE_BILLING_SETTINGS_KEY] as Record<string, unknown>) : o
  return { autoDraftOnDone: inner.autoDraftOnDone === true }
}
