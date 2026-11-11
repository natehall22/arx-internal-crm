'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { OrgFeatures } from '@/lib/org-features'
import type { ClientOrgProfile } from '@/lib/org-profile'

/**
 * The signed-in company's industry profile + feature map, resolved on the server by the root layout (app/layout.tsx),
 * so Nav and every `useOrgProfile` / `useOrgFeatures` caller paint the right menu and words on the FIRST render
 * (no roofing-then-lawn flash). null when signed out or the read failed — callers fall back as before.
 */
export type InitialOrgProfile = { profile: ClientOrgProfile; features: OrgFeatures } | null

const OrgProfileContext = createContext<InitialOrgProfile>(null)

export function OrgProfileProvider({ initial, children }: { initial: InitialOrgProfile; children: ReactNode }) {
  return <OrgProfileContext.Provider value={initial}>{children}</OrgProfileContext.Provider>
}

export function useInitialOrgProfile(): InitialOrgProfile {
  return useContext(OrgProfileContext)
}
