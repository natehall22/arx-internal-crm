import type { SupabaseClient } from '@supabase/supabase-js'
import { zipSync } from 'fflate'

import { getOrgBrand } from '@/lib/org-brand'
import { signedOrgLogoUrl } from '@/lib/org-logo-serve'
import { buildPaySheet, paySheetFilename, readPaySheetSettings } from '@/lib/payroll-pay-sheet'
import type { PayWeek } from '@/lib/payroll-pay-week'
import { buildPersonPaySheetPdf, type Logo } from '@/lib/pdf/payroll-person-sheet'

async function loadLogo(admin: SupabaseClient, orgId: string): Promise<Logo> {
  try {
    const url = await signedOrgLogoUrl(admin, orgId)
    if (!url) return null
    const res = await fetch(url)
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { data: bytes, format: 'PNG' }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { data: bytes, format: 'JPEG' }
    return null // other formats (svg, webp) are not drawn; the company name stands alone
  } catch {
    return null
  }
}

export type RenderedSheet = { filename: string; pdf: Buffer }

/** The week's pay sheets (everyone with something on the check, or one person). An open week renders as a PREVIEW. */
export async function renderPaySheets(admin: SupabaseClient, orgId: string, week: PayWeek, opts: { userId?: string; now?: Date } = {}): Promise<RenderedSheet[]> {
  const [brand, { data: org }, logo] = await Promise.all([getOrgBrand(admin, orgId), admin.from('orgs').select('settings').eq('id', orgId).maybeSingle(), loadLogo(admin, orgId)])
  const settings = readPaySheetSettings(org?.settings)
  const generatedOn = (opts.now ?? new Date()).toISOString().slice(0, 10)
  return week.people
    .filter((p) => (opts.userId ? p.userId === opts.userId : p.total > 0 || p.lines.length > 0))
    .map((p) => {
      const sheet = buildPaySheet(week, p, settings)
      return { filename: paySheetFilename(p.name, week.period.payDate), pdf: buildPersonPaySheetPdf(sheet, { companyName: brand.name, colors: settings.colors, logo, generatedOn }) }
    })
}

export function zipSheets(sheets: RenderedSheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  for (const s of sheets) {
    let name = s.filename
    for (let i = 2; files[name]; i++) name = s.filename.replace(/\.pdf$/, `_${i}.pdf`) // two people with one name
    files[name] = new Uint8Array(s.pdf)
  }
  return zipSync(files, { level: 0 })
}
