'use client'

/**
 * Admin → Settings → General: company columns (name / phone / email / address), the customer-facing brand
 * fields (`orgs.settings.brand`, lib/org-brand — super admins only) and timezone / date format / currency.
 * State and saving live in app/admin/settings/page.tsx; this only renders the card.
 */
import { BRAND_FIELD_MAX } from '@/lib/org-brand'

export interface GeneralSettingsValues {
  company_name: string
  company_phone: string
  company_email: string
  company_address: string
  brand_short_name: string
  brand_website: string
  brand_service_area: string
  timezone: string
  date_format: string
  currency: string
}

export const GENERAL_BRAND_INPUTS = [
  ['brand_short_name', 'Short name'],
  ['brand_website', 'Website'],
  ['brand_service_area', 'Service area line'],
] as const

const TEXT = { color: '#2c2c2a' }
const LABEL = 'block text-sm font-medium mb-2'
const INPUT = 'w-full min-h-[44px] px-4 py-2 border border-gray-300 rounded-lg text-base'

export default function GeneralSettingsCard({
  value,
  onChange,
  canEditBrand,
  saving,
  onSave,
}: {
  value: GeneralSettingsValues
  onChange: (patch: Partial<GeneralSettingsValues>) => void
  canEditBrand: boolean
  saving: boolean
  onSave: () => void
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6 space-y-6">
      <div>
        <label htmlFor="general-company_name" className={LABEL} style={TEXT}>Company Name</label>
        <input
          id="general-company_name"
          type="text"
          value={value.company_name}
          onChange={(e) => onChange({ company_name: e.target.value })}
          className={INPUT}
          style={TEXT}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="general-company_phone" className={LABEL} style={TEXT}>Phone</label>
          <input
            id="general-company_phone"
            type="tel"
            value={value.company_phone}
            onChange={(e) => onChange({ company_phone: e.target.value })}
            className={INPUT}
            style={TEXT}
          />
        </div>
        <div>
          <label htmlFor="general-company_email" className={LABEL} style={TEXT}>Email</label>
          <input
            id="general-company_email"
            type="email"
            value={value.company_email}
            onChange={(e) => onChange({ company_email: e.target.value })}
            className={INPUT}
            style={TEXT}
          />
        </div>
      </div>

      <div>
        <label htmlFor="general-company_address" className={LABEL} style={TEXT}>Address</label>
        <textarea
          id="general-company_address"
          value={value.company_address}
          onChange={(e) => onChange({ company_address: e.target.value })}
          rows={2}
          className={INPUT}
          style={TEXT}
        />
      </div>

      <div>
        <h3 className="text-base font-semibold" style={TEXT}>Customer-facing brand</h3>
        <p className="mt-1 text-sm" style={TEXT}>
          Shown on inspection reports, their emails and share page, with the rep&apos;s phone (or Company Phone above when the rep has none). Leave a field blank to keep the current default.
          {canEditBrand ? null : ' Only an owner can change these.'}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {GENERAL_BRAND_INPUTS.map(([key, label]) => (
            <div key={key}>
              <label htmlFor={`general-${key}`} className={LABEL} style={TEXT}>
                {label}
              </label>
              <input
                id={`general-${key}`}
                type="text"
                value={value[key]}
                maxLength={BRAND_FIELD_MAX}
                readOnly={!canEditBrand}
                aria-readonly={!canEditBrand}
                onChange={(e) => onChange({ [key]: e.target.value })}
                className={`${INPUT} ${canEditBrand ? '' : 'bg-gray-100'}`}
                style={TEXT}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="min-w-0">
          <label htmlFor="general-timezone" className={LABEL} style={TEXT}>Timezone</label>
          <select
            id="general-timezone"
            value={value.timezone}
            onChange={(e) => onChange({ timezone: e.target.value })}
            className={INPUT}
            style={TEXT}
          >
            <option value="America/New_York">Eastern</option>
            <option value="America/Chicago">Central</option>
            <option value="America/Denver">Mountain</option>
            <option value="America/Los_Angeles">Pacific</option>
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor="general-date_format" className={LABEL} style={TEXT}>Date Format</label>
          <select
            id="general-date_format"
            value={value.date_format}
            onChange={(e) => onChange({ date_format: e.target.value })}
            className={INPUT}
            style={TEXT}
          >
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor="general-currency" className={LABEL} style={TEXT}>Currency</label>
          <select
            id="general-currency"
            value={value.currency}
            onChange={(e) => onChange({ currency: e.target.value })}
            className={INPUT}
            style={TEXT}
          >
            <option value="USD">USD ($)</option>
            <option value="CAD">CAD ($)</option>
            <option value="EUR">EUR (€)</option>
            <option value="GBP">GBP (£)</option>
          </select>
        </div>
      </div>

      <div className="pt-4 border-t">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="w-full sm:w-auto min-h-[44px] px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
