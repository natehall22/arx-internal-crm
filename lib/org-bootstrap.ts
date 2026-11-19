import type { OrgFeatures } from '@/lib/org-features'
import type { ClientOrgProfile } from '@/lib/org-profile'

/** Server-resolved company words + switches the root layout hands to every client hook for the first render. */
export type OrgBootstrap = { profile: ClientOrgProfile; features: OrgFeatures }
