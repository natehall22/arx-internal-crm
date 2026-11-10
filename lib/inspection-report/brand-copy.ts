/**
 * Every company-identity string on the inspection report surfaces (report PDF footer + cover contact,
 * report email header/footer, public share page title) — built from OrgBrand (lib/org-brand) and the phone
 * from `contactPhone` (the rep's, else the company's). The one home for this copy; with the default brand
 * and the old phone these reproduce the strings that used to be hardcoded, byte for byte
 * (pinned in lib/__tests__/org-brand.test.ts).
 */
import { escapeHtml } from '@/lib/html'
import { brandNameRest, type OrgBrand } from '@/lib/org-brand'

function footerParts(brand: OrgBrand, phone: string): string[] {
  // blank parts (a company with no website / service area yet) are left out, never printed as an empty slot
  return [brand.name, brand.serviceArea, phone, brand.website].filter(Boolean)
}

/** Page footer printed on every report page (seeded once; the rep can edit it per report). */
export function reportFooterLine(brand: OrgBrand, phone: string): string {
  return footerParts(brand, phone).join('  |  ')
}

/** Contact line on the report cover (seeded once; editable per report). */
export function reportFooterContact(brand: OrgBrand, phone: string): string {
  return [brand.website, phone, brand.email].filter(Boolean).join('   |   ')
}

/** Email header wordmark: short name plain, the rest of the name in gold (falls back to the whole name). */
export function reportEmailHeaderHtml(brand: OrgBrand): string {
  const rest = brandNameRest(brand)
  return rest === null
    ? escapeHtml(brand.name)
    : `${escapeHtml(brand.shortName)} <span style="color:#B0904E;">${escapeHtml(rest)}</span>`
}

/** Small print under the email body. */
export function reportEmailFooterHtml(brand: OrgBrand, phone: string): string {
  return footerParts(brand, phone).map(escapeHtml).join(' &nbsp;|&nbsp; ')
}

/** Browser tab title of the public share page. */
export function reportShareTitle(brand: OrgBrand): string {
  return `Roof Inspection Report — ${brand.name}`
}
