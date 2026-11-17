/**
 * Print Kit pieces: what each printed piece says, per company. ONE place.
 * Roofing (no profile stored = the original company) keeps its pieces exactly as they were — the door-drop letter and the
 * appointment card's own words. Any other profile gets the company's own name and logo (lib/org-brand.ts, orgLogoHref) and
 * its profile words; the door-drop letter is roofing copy (roof evaluation, storm, insurance), so it is roofing-only.
 */
import type { ResolvedOrgProfile } from '@/lib/org-profile'

export type PrintKitBrand = { companyName: string; logoHref: string | null; cardTagline: string; cardRole: string; useShield: boolean }

/** The original company's card words (verbatim); `useShield` = its own shield image, used only for roofing. */
export function printKitBrand(profile: Pick<ResolvedOrgProfile, 'id' | 'label' | 'terms'>, org: { name: string; logoHref: string | null }): PrintKitBrand {
  if (profile.id === 'roofing') {
    return { companyName: 'ARX Roofing & Exteriors', logoHref: null, cardTagline: 'Free Inspection', cardRole: 'Roofing Specialist', useShield: true }
  }
  return { companyName: org.name, logoHref: org.logoHref, cardTagline: `Free ${profile.terms.inspection}`, cardRole: `${profile.label} specialist`, useShield: false }
}

/** The door-drop letter is roofing copy: only the roofing profile offers it. */
export function doorDropAvailable(profile: Pick<ResolvedOrgProfile, 'id'>): boolean {
  return profile.id === 'roofing'
}
