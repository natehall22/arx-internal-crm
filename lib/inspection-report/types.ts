/**
 * Customer-facing roof inspection report — document model.
 *
 * The `doc` jsonb on inspection_reports holds everything about the report except the
 * photo bytes (storage) and photo rows (inspection_report_photos). Shape mirrors the
 * standalone ARX Roof Report Builder's serialized project so the PDF engine port
 * (lib/inspection-report/pdf.ts) renders identical output.
 */

export interface ReportInfoField {
  id: string
  label: string
  value: string
}

export interface ReportCover {
  heroPhotoId: string | null
  title: string
  subtitle: string
  infoFields: ReportInfoField[]
  note: string
  footerContact: string
}

export interface ReportSummaryBlock {
  id: string
  heading: string
  body: string
}

export interface ReportRequestItem {
  id: string
  subhead: string
  body: string
}

export interface ReportSummary {
  include: boolean
  headerLabel: string
  title: string
  blocks: ReportSummaryBlock[]
  requestTitle: string
  requestItems: ReportRequestItem[]
}

export interface ReportSection {
  id: string
  dividerTitle: string
  dividerSubtitle: string
  headerLabel: string
  photoIds: string[]
}

export interface ReportDoc {
  v: 1
  propertyAddressHeader: string
  footerLine: string
  cover: ReportCover
  summary: ReportSummary
  sections: ReportSection[]
  /** photoId -> caption. Photo bytes/dimensions live in inspection_report_photos + storage. */
  captions: Record<string, string>
  /** photoId -> rotation in degrees (0/90/180/270), baked into the JPEG only at PDF export. */
  rotations: Record<string, number>
  unsorted: string[]
}

export interface ReportPhotoMeta {
  id: string
  storage_path: string
  width: number | null
  height: number | null
  created_at: string
  /** signed URL, attached by the API when reading */
  url?: string | null
}

export const REPORT_BUCKET = 'inspection-reports'

const DEFAULT_FOOTER =
  'ARX Roofing & Exteriors  |  Charlotte / Kannapolis, NC  |  (360) 485-9413  |  arxroofing.com'
const DEFAULT_FOOTER_CONTACT = 'arxroofing.com   |   (360) 485-9413   |   info@arxroofing.com'

const uid = () => Math.random().toString(36).slice(2, 10)

export interface SeedPrefill {
  ownerName?: string
  address?: string
  preparedBy?: string
}

/** Fresh report doc with the standard sections and claims-ready summary copy, prefilled from CRM data. */
export function seedReportDoc(prefill: SeedPrefill = {}): ReportDoc {
  return {
    v: 1,
    propertyAddressHeader: prefill.address || '',
    footerLine: DEFAULT_FOOTER,
    cover: {
      heroPhotoId: null,
      title: 'ROOF DAMAGE\nDOCUMENTATION',
      subtitle: 'Supplemental Inspection & Request for Reinspection',
      infoFields: [
        { id: uid(), label: 'Property Owner', value: prefill.ownerName || '' },
        { id: uid(), label: 'Property Address', value: prefill.address || '' },
        { id: uid(), label: 'Reinspection Date', value: '' },
        { id: uid(), label: 'Prepared By', value: prefill.preparedBy || '' },
        { id: uid(), label: 'Insurance Carrier', value: '' },
        { id: uid(), label: 'Date of Loss', value: '' },
      ],
      note: "Prepared for the homeowner and for the insurance carrier's review.",
      footerContact: DEFAULT_FOOTER_CONTACT,
    },
    summary: {
      include: true,
      headerLabel: 'SUMMARY & BASIS FOR REINSPECTION',
      title: 'Summary & Basis for Reinspection',
      blocks: [
        {
          id: uid(),
          heading: 'Purpose',
          body: "Following the carrier's initial claim review, ARX Roofing & Exteriors performed a detailed roof inspection focused specifically on hail and wind. This report documents what was found and respectfully requests a full reinspection of the roof.",
        },
        {
          id: uid(),
          heading: 'Background',
          body: 'The homeowner reports that the assigned adjuster was professional and courteous, and that the initial visit was a brief overview rather than a detailed hail and wind assessment. ARX is not disputing that review. The purpose of this report is to provide additional, measured documentation that may not have been captured during a short overview inspection, so the carrier can make a fully informed determination.',
        },
        {
          id: uid(),
          heading: 'Hail Findings',
          body: 'Impacts consistent with hail were identified and circled across multiple roof slopes. Representative impacts were measured with a tape for diameter. Impacts were also noted on soft-metal components, where hail bruising is typically most visible.',
        },
        {
          id: uid(),
          heading: 'Wind Findings',
          body: 'Linear creasing consistent with wind was marked along several shingle courses, including locations where the shingle bond has broken at the crease line.',
        },
        {
          id: uid(),
          heading: 'Roof Age & Overall Condition',
          body: "The roof is an older asphalt shingle system showing significant granule loss and general weathering, and is at or near the end of its service life. In ARX's professional opinion, the roof requires full replacement regardless of the claim outcome.",
        },
      ],
      requestTitle: 'Request',
      requestItems: [
        {
          id: uid(),
          subhead: 'Replacement is warranted regardless.',
          body: "Independent of the claim determination, the roof's age and overall condition place it at or near the end of its serviceable life. ARX recommends full replacement.",
        },
        {
          id: uid(),
          subhead: 'A closer look is warranted.',
          body: 'ARX respectfully requests that the carrier take a deeper look at the documented hail and wind — either through an on-site reinspection or by reviewing the measured photographs in this report — before finalizing its determination. ARX is available to meet the adjuster on site at the carrier\'s convenience.',
        },
      ],
    },
    sections: [
      { id: uid(), dividerTitle: 'HAIL IMPACTS', dividerSubtitle: 'Documented & Measured', headerLabel: 'HAIL IMPACTS — DOCUMENTED & MEASURED', photoIds: [] },
      { id: uid(), dividerTitle: 'WIND', dividerSubtitle: 'Linear Creasing', headerLabel: 'WIND — LINEAR CREASING', photoIds: [] },
      { id: uid(), dividerTitle: 'PENETRATIONS', dividerSubtitle: 'Pipe Boots, Vents & Flashings', headerLabel: 'PENETRATIONS — PIPE BOOTS, VENTS & FLASHINGS', photoIds: [] },
      { id: uid(), dividerTitle: 'IMPACT COUNTS', dividerSubtitle: 'Marked Hail & Wind', headerLabel: 'IMPACT COUNTS — MARKED HAIL & WIND', photoIds: [] },
      { id: uid(), dividerTitle: 'ROOF OVERVIEW', dividerSubtitle: 'Gutters & Age', headerLabel: 'ROOF OVERVIEW — GUTTERS & AGE', photoIds: [] },
    ],
    captions: {},
    rotations: {},
    unsorted: [],
  }
}

/**
 * Normalize a doc loaded from the DB against the seed shape, so older/partial docs
 * (or a bare '{}' default) never crash the builder or the PDF engine.
 */
export function normalizeReportDoc(raw: unknown, prefill: SeedPrefill = {}): ReportDoc {
  const seed = seedReportDoc(prefill)
  if (!raw || typeof raw !== 'object') return seed
  const o = raw as Partial<ReportDoc>
  if (!o.cover || !Array.isArray(o.sections)) return seed
  return {
    v: 1,
    propertyAddressHeader: typeof o.propertyAddressHeader === 'string' ? o.propertyAddressHeader : seed.propertyAddressHeader,
    footerLine: typeof o.footerLine === 'string' ? o.footerLine : seed.footerLine,
    cover: {
      heroPhotoId: o.cover.heroPhotoId ?? null,
      title: o.cover.title ?? seed.cover.title,
      subtitle: o.cover.subtitle ?? seed.cover.subtitle,
      infoFields: Array.isArray(o.cover.infoFields) ? o.cover.infoFields : seed.cover.infoFields,
      note: o.cover.note ?? seed.cover.note,
      footerContact: o.cover.footerContact ?? seed.cover.footerContact,
    },
    summary: o.summary && Array.isArray(o.summary.blocks)
      ? {
          include: o.summary.include !== false,
          headerLabel: o.summary.headerLabel ?? seed.summary.headerLabel,
          title: o.summary.title ?? seed.summary.title,
          blocks: o.summary.blocks,
          requestTitle: o.summary.requestTitle ?? seed.summary.requestTitle,
          requestItems: Array.isArray(o.summary.requestItems) ? o.summary.requestItems : seed.summary.requestItems,
        }
      : seed.summary,
    sections: o.sections.map((s) => ({
      id: s?.id || uid(),
      dividerTitle: s?.dividerTitle ?? '',
      dividerSubtitle: s?.dividerSubtitle ?? '',
      headerLabel: s?.headerLabel ?? '',
      photoIds: Array.isArray(s?.photoIds) ? s.photoIds : [],
    })),
    captions: o.captions && typeof o.captions === 'object' ? o.captions : {},
    rotations: o.rotations && typeof o.rotations === 'object' ? o.rotations : {},
    unsorted: Array.isArray(o.unsorted) ? o.unsorted : [],
  }
}

/** Roles allowed to create/edit reports — same field roles that can upload inspection photos. */
export const REPORT_EDIT_ROLES = new Set([
  'admin',
  'owner',
  'setter_manager',
  'regional_setter_manager',
  'sales_manager',
  'regional_manager',
  'rep',
  'sales_rep',
  'closer',
])

/** Per-job PDF filename: address slug + date, so a rep doing several houses gets distinct files. */
export function reportSlug(doc: ReportDoc): string {
  const fld = (re: RegExp) =>
    ((doc.cover.infoFields.find((f) => re.test(f.label || '')) || { value: '' }).value || '')
      .split('\n')[0]
      .trim()
  const base =
    (doc.propertyAddressHeader || fld(/address/i) || fld(/owner|name/i) || 'Roof-Report')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'Roof-Report'
  return `ARX-${base}-${new Date().toISOString().slice(0, 10)}`
}
