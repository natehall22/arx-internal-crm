/**
 * Starter plan templates — DATA, not behavior. An owner picks one in Settings → Plan templates (it only fills the
 * editor; nothing is saved until they save), or a company seed file names one (`servicePlanTemplates`, lib/company-seed.ts).
 * After that the company's own template row is the only source; changing this file never changes a template or a plan.
 * Prices are left blank on purpose: every company sets its own. `trade` is matched to the company's trades by slug or label.
 */
import type { BillingBasis, PlanStep, Season } from '@/lib/service-plans'
import { DEFAULT_STEP_RESULTS } from '@/lib/service-plans'

export type StarterTemplate = {
  key: string
  name: string
  trade: string
  description: string | null
  seasons: Season[]
  billing_basis: BillingBasis
  taxable: boolean
  pricing: {
    fields: Array<{ key: string; label: string }>
    tiers: Array<{ key: string; label: string; price: number | null; billingBasis: BillingBasis; conditions: Array<{ field: string; op: 'lte' | 'lt' | 'gte' | 'gt' | 'eq'; value: number }> }>
    allowCustom: boolean
  }
  steps: PlanStep[]
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = Object.freeze([
  {
    key: 'lawn_weekly',
    name: 'Lawn maintenance',
    trade: 'lawn',
    description: 'Mow, edge, trim and blow. Weekly in season, every 2 weeks in the shoulder months, monthly in winter.',
    seasons: [
      { from: '03-01', to: '03-31', frequency: 'every_2_weeks' },
      { from: '04-01', to: '10-31', frequency: 'weekly' },
      { from: '11-01', to: '11-30', frequency: 'every_2_weeks' },
      { from: '12-01', to: '02-29', frequency: 'monthly' },
    ],
    billing_basis: 'per_visit',
    taxable: false,
    pricing: {
      fields: [{ key: 'lawn_sqft', label: 'Lawn size (sq ft)' }],
      tiers: [
        { key: 'small', label: 'Small yard', price: null, billingBasis: 'per_visit', conditions: [{ field: 'lawn_sqft', op: 'lte', value: 5000 }] },
        { key: 'standard', label: 'Standard yard', price: null, billingBasis: 'per_visit', conditions: [{ field: 'lawn_sqft', op: 'lte', value: 15000 }] },
      ],
      allowCustom: true,
    },
    steps: [],
  },
  {
    key: 'roof_gutter_care',
    name: 'Roof & gutter care',
    trade: 'gutters',
    description: 'Debris blown off the roof and gutters cleaned (no soft wash), then an inspector rates the roof.',
    seasons: [
      { from: '04-01', to: '04-30', frequency: 'monthly' },
      { from: '11-01', to: '11-30', frequency: 'monthly' },
    ],
    billing_basis: 'per_month',
    taxable: true,
    pricing: {
      fields: [
        { key: 'stories', label: 'Stories' },
        { key: 'pitch', label: 'Roof pitch (/12)' },
      ],
      tiers: [
        {
          key: 'standard',
          label: 'Standard home',
          price: null,
          billingBasis: 'per_month',
          conditions: [
            { field: 'stories', op: 'lte', value: 3 },
            { field: 'pitch', op: 'lte', value: 10 },
          ],
        },
      ],
      allowCustom: true,
    },
    steps: [{ key: 'inspection', label: 'Roof inspection', daysAfter: 2, assignTo: 'person', userId: null, subId: null, results: DEFAULT_STEP_RESULTS.map((r) => ({ ...r })) }],
  },
]) as readonly StarterTemplate[]

export function starterTemplate(key: string): StarterTemplate | null {
  return STARTER_TEMPLATES.find((t) => t.key === key) ?? null
}
