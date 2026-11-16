/**
 * Proposal PDF content — the words on the cover, process and why-us pages (pure, client-safe).
 * Layers: industry profile defaults (lib/industry-profiles-proposal.ts) → the company's own edits at
 * `orgs.settings.proposalContent`, written ONLY by `PATCH /api/admin/proposal-content` through mergeOrgSettings path
 * ['proposalContent'] (owners). ONE reader: `resolveProposalContent`, used by the proposal API; the result travels in the PDF
 * data (`data.content`) so a stored snapshot (lib/proposal-snapshots.ts) holds exactly what was shown.
 * A snapshot made before this existed has no `content`: the renderer treats it as roofing, as it always printed.
 */
import { GENERIC_PROPOSAL_CONTENT, type ProposalContentDefaults, type ProposalContentItem } from '@/lib/industry-profiles-proposal'
import { INDUSTRY_PROFILES, type IndustryProfileId } from '@/lib/industry-profiles'

export const PROPOSAL_CONTENT_SETTINGS_KEY = 'proposalContent'
/** Single-line texts (cover subtitle, headings) and the title of a step / item. */
export const MAX_TITLE_LENGTH = 80
/** Body / list caps are what still fits the PDF's fixed pages (Process 2x3 grid; Warranties & Why-us on one page), checked by
 * rendering the real PDF at the caps with 80-character titles — larger lists spilled onto an extra, footer-less page. */
export const MAX_BODY_LENGTH = 200
export const MAX_ITEMS = 6

export const TEXT_FIELDS = ['coverSubtitle', 'processTitle', 'processSubtitle', 'whyUsTitle'] as const
export const LIST_FIELDS = ['processSteps', 'whyUsItems'] as const
type TextField = (typeof TEXT_FIELDS)[number]
type ListField = (typeof LIST_FIELDS)[number]
export type ProposalContentEdits = Partial<Record<TextField, string> & Record<ListField, ProposalContentItem[]>>

/** What the PDF is fed (`ProposalPDFData.content`). */
export type ProposalPdfContent = {
  coverSubtitle: string
  processTitle: string
  processSubtitle: string
  processSteps: ProposalContentItem[]
  whyUsTitle: string
  whyUsItems: ProposalContentItem[]
  detailsSubtitle: string
  /** The company's word for the document ("Proposal", "Quote", "Bid"): the cover title when a proposal has none of its own. */
  proposalWord: string
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function clone(d: ProposalContentDefaults): ProposalContentDefaults & { processSteps: ProposalContentItem[]; whyUsItems: ProposalContentItem[] } {
  return { ...d, processSteps: d.processSteps.map((i) => ({ ...i })), whyUsItems: d.whyUsItems.map((i) => ({ ...i })) }
}

/** The profile's defaults (neutral text when it defines none; unknown id → roofing, like every other profile read). */
export function defaultProposalContent(profileId: IndustryProfileId) {
  return clone(INDUSTRY_PROFILES[profileId]?.proposalContent ?? GENERIC_PROPOSAL_CONTENT)
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, max)
  return s ? s : null
}

function cleanItems(v: unknown): ProposalContentItem[] | null {
  if (!Array.isArray(v)) return null
  const items: ProposalContentItem[] = []
  for (const raw of v) {
    const o = obj(raw)
    const title = cleanText(o.title, MAX_TITLE_LENGTH)
    if (!title) continue
    items.push({ title, body: typeof o.body === 'string' ? o.body.trim().slice(0, MAX_BODY_LENGTH) : '' })
    if (items.length >= MAX_ITEMS) break
  }
  return items.length ? items : null
}

/** Pure: stored settings (whole `orgs.settings` or the key itself) → only the valid edits; anything else reads as "not edited". */
export function readProposalContentEdits(stored: unknown): ProposalContentEdits {
  const whole = obj(stored)
  const s = PROPOSAL_CONTENT_SETTINGS_KEY in whole ? obj(whole[PROPOSAL_CONTENT_SETTINGS_KEY]) : whole
  const out: ProposalContentEdits = {}
  for (const f of TEXT_FIELDS) {
    const t = cleanText(s[f], MAX_TITLE_LENGTH)
    if (t) out[f] = t
  }
  for (const f of LIST_FIELDS) {
    const l = cleanItems(s[f])
    if (l) out[f] = l
  }
  return out
}

/** THE reader: profile defaults + the company's edits (`org.settings`) + the company's word for the document. */
export function resolveProposalContent(org: { settings?: unknown } | null | undefined, profile: { id: IndustryProfileId; terms: { proposal: string } }): ProposalPdfContent {
  const d = defaultProposalContent(profile.id)
  const e = readProposalContentEdits(org?.settings)
  return {
    coverSubtitle: e.coverSubtitle ?? d.coverSubtitle,
    processTitle: e.processTitle ?? d.processTitle,
    processSubtitle: e.processSubtitle ?? d.processSubtitle,
    processSteps: (e.processSteps ?? d.processSteps).map((i) => ({ ...i })),
    whyUsTitle: e.whyUsTitle ?? d.whyUsTitle,
    whyUsItems: (e.whyUsItems ?? d.whyUsItems).map((i) => ({ ...i })),
    detailsSubtitle: d.detailsSubtitle,
    proposalWord: profile.terms.proposal,
  }
}

/** `{company}` in a text → the company's short name (drawn in the PDF and the Settings preview). */
export function fillCompanyToken(text: string, companyName: string): string {
  // A function replacer: a name with $ in it ("A$$ Roofing") must print as typed, not as a replacement pattern.
  return text.replace(/\{company\}/g, () => companyName)
}

/** The cover's big title: the proposal's own title, else the company's word for the document; always uppercase. */
export const MAX_COVER_TITLE_LENGTH = 120
export function proposalCoverTitle(title: string | null | undefined, content: Pick<ProposalPdfContent, 'proposalWord'>): string {
  const t = (title?.trim() || content.proposalWord || 'Proposal').toUpperCase()
  // The builder's title has no length limit; past this it no longer fits the cover page.
  return t.length > MAX_COVER_TITLE_LENGTH ? `${t.slice(0, MAX_COVER_TITLE_LENGTH - 1).trimEnd()}…` : t
}

/**
 * A save from Settings: the full edited form → what to write and what to clear. A field equal to the profile's default (or
 * blank) is cleared, so untouched fields keep following the profile. `{ reset: true }` clears everything.
 */
export function parseProposalContentPatch(body: unknown, defaults: ProposalContentDefaults): { set: ProposalContentEdits; remove: string[] } | { error: string } {
  const b = obj(body)
  const allKeys = [...TEXT_FIELDS, ...LIST_FIELDS] as string[]
  if (b.reset === true) return { set: {}, remove: allKeys }
  const p = obj(b.settings)
  const set: Record<string, unknown> = {}
  const remove: string[] = []
  for (const [k, v] of Object.entries(p)) {
    if ((TEXT_FIELDS as readonly string[]).includes(k)) {
      if (typeof v !== 'string') return { error: 'Texts must be text' }
      if (v.trim().length > MAX_TITLE_LENGTH) return { error: `Titles can be up to ${MAX_TITLE_LENGTH} characters` }
      const t = v.trim()
      if (!t || t === defaults[k as TextField]) remove.push(k)
      else set[k] = t
    } else if ((LIST_FIELDS as readonly string[]).includes(k)) {
      if (!Array.isArray(v)) return { error: 'Steps and items must be a list' }
      if (v.length > MAX_ITEMS) return { error: `Up to ${MAX_ITEMS} entries` }
      const items: ProposalContentItem[] = []
      for (const raw of v) {
        const o = obj(raw)
        const title = typeof o.title === 'string' ? o.title.trim() : ''
        const text = typeof o.body === 'string' ? o.body.trim() : ''
        if (!title && !text) continue
        if (!title) return { error: 'Every step and item needs a title' }
        if (title.length > MAX_TITLE_LENGTH) return { error: `Titles can be up to ${MAX_TITLE_LENGTH} characters` }
        if (text.length > MAX_BODY_LENGTH) return { error: `Descriptions can be up to ${MAX_BODY_LENGTH} characters` }
        items.push({ title, body: text })
      }
      const def = defaults[k as ListField]
      const same = items.length === def.length && items.every((i, n) => i.title === def[n]!.title && i.body === def[n]!.body)
      if (!items.length || same) remove.push(k)
      else set[k] = items
    } else {
      return { error: `Unknown setting: ${k}` }
    }
  }
  return { set: set as ProposalContentEdits, remove }
}
