import { installerFrequencyKey } from './installer-frequency'

export type InstallerBusinessStatus =
  | 'ACTIVE'
  | 'DEFUNCT'
  | 'BANKRUPT'
  | 'DISSOLVED'
  | 'ACQUIRED'
  | 'NO_LONGER_SERVICING_MARKET'
  | 'UNKNOWN'

export type InstallerStatusConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export type InstallerStatusRecord = {
  status: InstallerBusinessStatus
  confidence: InstallerStatusConfidence
  evidenceSummary: string
  source1: string
  source2: string
  successorCompany: string
  successorStillServicesSystems: 'yes' | 'no' | 'unknown'
  notes: string
}

export type AliasGroup = {
  /** Frequency keys (normalizedInstaller with spaces removed). */
  members: string[]
  /** Primary frequency key for status lookup and merged notes. */
  canonical: string
  displayName: string
}

/** Merge research entities that share one operating history. Keys are space-stripped frequency keys. */
export const ALIAS_GROUPS: AliasGroup[] = [
  {
    members: [
      'powerhomesolar',
      'powerhomesolarroofing',
      'p0werhomesolar',
      'powerhomesolars',
      'geecpowerhomesolar',
    ],
    canonical: 'powerhomesolar',
    displayName: 'power home solar / Pink Energy',
  },
  {
    members: ['renuenergysolutions', 'renuenergy', 'renusolarsolutions', 'renueenergysolutions'],
    canonical: 'renuenergysolutions',
    displayName: 're nu energy solutions',
  },
  {
    members: ['acceleratesolar', 'acceleratessolar', 'acceleratiessolar'],
    canonical: 'acceleratesolar',
    displayName: 'accelerate solar',
  },
  {
    members: ['luminasunsmarthomeandmaynardheatingandcooling', 'luminasunsmarthome'],
    canonical: 'luminasunsmarthomeandmaynardheatingandcooling',
    displayName: 'luminasun smart home',
  },
  {
    members: ['palmettosolar', 'palmettocleantechnology'],
    canonical: 'palmettosolar',
    displayName: 'palmetto solar / Palmetto family',
  },
  {
    members: ['freedomforevernc', 'freedomforever'],
    canonical: 'freedomforevernc',
    displayName: 'freedom forever',
  },
  {
    members: ['southernenergymanagement', 'southernenergymanagemen', 'southernenergymanagment'],
    canonical: 'southernenergymanagement',
    displayName: 'southern energy management',
  },
  {
    members: ['teslaenergyoperations', 'telsaenergyoperations'],
    canonical: 'teslaenergyoperations',
    displayName: 'tesla energy operations',
  },
  {
    members: ['thompsonandsonenergy', 'thompsonson', 'thompsonsonenergysolutions'],
    canonical: 'thompsonandsonenergy',
    displayName: 'thompson and son energy',
  },
  {
    members: ['totalsolarsolution', 'totalsolarsolutions'],
    canonical: 'totalsolarsolution',
    displayName: 'total solar solution',
  },
  {
    members: ['taycoelectric', 'allanmichaelbusbytaycoelectric', 'danielericowentaycoelectric'],
    canonical: 'taycoelectric',
    displayName: 'tayco electric',
  },
  {
    members: ['bigrockelectrical', 'bigrockelectricallighting'],
    canonical: 'bigrockelectrical',
    displayName: 'big rock electrical',
  },
  {
    members: ['kevinkutsch', 'kevinwkutsch'],
    canonical: 'kevinkutsch',
    displayName: 'kevin kutsch',
  },
  {
    members: ['sigorasolar', 'sigorasolarllcmatthewdoran'],
    canonical: 'sigorasolar',
    displayName: 'sigora solar',
  },
]

export function toFrequencyKey(normalizedInstaller: string): string {
  return normalizedInstaller.replace(/\s+/g, '')
}

export function frequencyKeyFromContractor(contractor: string | null | undefined): string | null {
  return installerFrequencyKey(contractor)
}

const ALIAS_BY_MEMBER = new Map<string, AliasGroup>()
for (const group of ALIAS_GROUPS) {
  for (const member of group.members) {
    ALIAS_BY_MEMBER.set(member, group)
  }
}

export function resolveAliasGroup(freqKey: string): AliasGroup | null {
  return ALIAS_BY_MEMBER.get(freqKey) ?? null
}

export function resolveCanonicalFrequencyKey(freqKey: string): string {
  return ALIAS_BY_MEMBER.get(freqKey)?.canonical ?? freqKey
}

/** Researched statuses only — conservative; silence does not imply defunct. */
export const INSTALLER_STATUS_CATALOG: Record<string, InstallerStatusRecord> = {
  powerhomesolar: {
    status: 'BANKRUPT',
    confidence: 'HIGH',
    evidenceSummary:
      'Power Home Solar LLC dba Pink Energy filed Chapter 7 in WDNC Bankruptcy Court (3:22-bk-50228) on 2022-10-07. Trustee: Jimmy Summerlin.',
    source1: 'https://www.inforuptcy.com/browse-filings/north-carolina-western-bankruptcy-court/3:22-bk-50228/bankruptcy-case-power-home-solar-llc',
    source2: 'https://www.hickorylaw.com/pinkenergy/',
    successorCompany: '',
    successorStillServicesSystems: 'no',
    notes: 'Pink Energy brand; no identified successor servicing installed systems.',
  },
  titansolarpowernc: {
    status: 'BANKRUPT',
    confidence: 'HIGH',
    evidenceSummary:
      'Titan Solar Power NC Inc filed Chapter 7 in AZ (2:24-bk-05238-MCW), jointly administered with PM&M Electric dba Titan Solar (2:24-bk-04978-MCW), petitions ~June 2024.',
    source1: 'https://www.azb.uscourts.gov/node/374',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'unknown',
    notes: '',
  },
  adtsolar: {
    status: 'NO_LONGER_SERVICING_MARKET',
    confidence: 'HIGH',
    evidenceSummary:
      'ADT Inc still exists; ADT Solar (ex-Sunpro) halted residential solar installations January 2024. Parent company not bankrupt.',
    source1: 'ADT press releases',
    source2: 'https://palmetto.com/solar-companies/adt-solar-review',
    successorCompany: 'ADT Inc',
    successorStillServicesSystems: 'unknown',
    notes: 'Parent monitors/security; residential install arm stopped — successor install support unclear.',
  },
  blueravensolar: {
    status: 'ACQUIRED',
    confidence: 'HIGH',
    evidenceSummary:
      'SunPower acquired Blue Raven ~2021; SunPower Ch.11 Aug 2024; Complete Solaria bought Blue Raven assets closing 2024-09-30. Complete Solaria FAQ: did NOT assume liabilities for projects completed on or before 2024-09-30. Cabarrus permits are 2017.',
    source1: 'https://global.sunpowercorp.com/acquisition-announcement',
    source2: '',
    successorCompany: 'Complete Solaria',
    successorStillServicesSystems: 'no',
    notes: 'Pre-2024-09-30 installs may be orphaned per Complete Solaria liability disclaimer.',
  },
  globalefficientenergy: {
    status: 'DEFUNCT',
    confidence: 'MEDIUM',
    evidenceSummary:
      'FL Sunbiz GLOBAL EFFICIENT ENERGY LLC (M14000003106) status INACTIVE, revoked for annual report 2020-09-25. WSOC Action 9 reported company went out of business without paying judgments. TX origin; NC SOS not verified.',
    source1: 'https://search.sunbiz.org/',
    source2: 'WSOC Action 9 coverage',
    successorCompany: '',
    successorStillServicesSystems: 'no',
    notes: 'MEDIUM not HIGH — NC Secretary of State not pulled.',
  },
  nrghomesolar: {
    status: 'NO_LONGER_SERVICING_MARKET',
    confidence: 'HIGH',
    evidenceSummary:
      'NRG ended NRG Home Solar installation operations ~2016 after exiting NC. Parent NRG Energy remains active.',
    source1: 'Industry histories / NRG Home Solar exit coverage',
    source2: '',
    successorCompany: 'NRG Energy',
    successorStillServicesSystems: 'no',
    notes: 'Parent energy company active; residential solar install arm exited NC ~2016.',
  },
  teslaenergyoperations: {
    status: 'ACTIVE',
    confidence: 'HIGH',
    evidenceSummary: 'Tesla Energy Operations Inc — operating national installer; permits through 2025 in dataset.',
    source1: 'Public operating company / permit activity',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: 'Includes telsaenergyoperations typo alias.',
  },
  palmettosolar: {
    status: 'ACTIVE',
    confidence: 'HIGH',
    evidenceSummary: 'Palmetto Solar LLC — known operating residential solar platform; permits through 2024 in dataset.',
    source1: 'Public operating company / permit activity',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: 'Palmetto Clean Technology aliased here — same Palmetto family, may share corporate lineage.',
  },
  freedomforevernc: {
    status: 'ACTIVE',
    confidence: 'HIGH',
    evidenceSummary: 'Freedom Forever — major national installer; permits through 2024 in dataset.',
    source1: 'Public operating company / permit activity',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: 'Includes freedomforever alias.',
  },
  gafenergy: {
    status: 'ACTIVE',
    confidence: 'HIGH',
    evidenceSummary: 'GAF Energy LLC — operating solar-roofing manufacturer-installer; recent permits in dataset.',
    source1: 'Public operating company / permit activity',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: '',
  },
  southernenergymanagement: {
    status: 'ACTIVE',
    confidence: 'HIGH',
    evidenceSummary: 'Southern Energy Management — long-running NC installer; permits through 2026 in dataset.',
    source1: 'Public operating company / permit activity',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: 'Includes typo aliases southernenergymanagemen / southernenergymanagment.',
  },
  completesolar: {
    status: 'ACTIVE',
    confidence: 'HIGH',
    evidenceSummary:
      'Complete Solar / Complete Solaria operating; acquired SunPower assets 2024; Rowan permits 2022–2025.',
    source1: 'Complete Solaria public statements',
    source2: 'Permit activity in dataset',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: '',
  },
  ncsolarnow: {
    status: 'ACTIVE',
    confidence: 'HIGH',
    evidenceSummary: 'NC Solar Now — permits through 2026-06-29 in dataset.',
    source1: 'Permit activity in dataset',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: 'Frequency key from "n c solar now".',
  },
  toptiersolarsolutions: {
    status: 'ACTIVE',
    confidence: 'HIGH',
    evidenceSummary: 'Top Tier Solar Solutions — permits through 2026-08-14 in dataset.',
    source1: 'Permit activity in dataset',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: '',
  },
  renuenergysolutions: {
    status: 'ACTIVE',
    confidence: 'HIGH',
    evidenceSummary: 'RE NU Energy Solutions — permits through 2026-01-08 in dataset.',
    source1: 'Permit activity in dataset',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: 'Includes renuenergy, renusolarsolutions, renueenergysolutions aliases.',
  },
  '8msolar': {
    status: 'ACTIVE',
    confidence: 'HIGH',
    evidenceSummary: '8MSOLAR — permits through 2026-05 in dataset.',
    source1: 'Permit activity in dataset',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: '',
  },
  empowerenergysolutions: {
    status: 'ACTIVE',
    confidence: 'HIGH',
    evidenceSummary: 'Empower Energy Solutions — permit 2026-05-26 in dataset.',
    source1: 'Permit activity in dataset',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: '',
  },
  powerproductionmanagement: {
    status: 'ACTIVE',
    confidence: 'HIGH',
    evidenceSummary: 'Power Production Management — permit 2026-08-17 in dataset.',
    source1: 'Permit activity in dataset',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: '',
  },
  lgcyinstallationservices: {
    status: 'ACTIVE',
    confidence: 'MEDIUM',
    evidenceSummary:
      'LGCY Installation Services / LGCY Power still operating per 2025 LinkedIn/PR; lawsuits exist but company operating.',
    source1: 'LGCY Power public presence',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: 'ACTIVE MEDIUM — operating but legal exposure noted.',
  },
  beamsolar: {
    status: 'ACTIVE',
    confidence: 'MEDIUM',
    evidenceSummary: 'Beam Solar — last permit 2025 in dataset; not independently verified via SOS.',
    source1: 'Permit activity in dataset',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'unknown',
    notes: 'Recent permits only; no independent SOS verification.',
  },
  luminasunsmarthomeandmaynardheatingandcooling: {
    status: 'ACTIVE',
    confidence: 'MEDIUM',
    evidenceSummary: 'LuminaSun — last permit 2025 in dataset; not independently verified via SOS.',
    source1: 'Permit activity in dataset',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'unknown',
    notes: 'Includes luminasunsmarthome alias.',
  },
  cypresscreekrenewables: {
    status: 'ACTIVE',
    confidence: 'MEDIUM',
    evidenceSummary: 'Cypress Creek Renewables — utility-scale developer still exists; not a rooftop installer.',
    source1: 'Public company presence',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'unknown',
    notes: 'Utility-scale developer — not a residential rooftop campaign target.',
  },
  stratasolar: {
    status: 'UNKNOWN',
    confidence: 'MEDIUM',
    evidenceSummary: 'Strata Solar — utility-scale developer; Pine Gate related; name still in market.',
    source1: '',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'unknown',
    notes: 'Utility-scale — not a rooftop installer campaign target.',
  },
  sunenergy1: {
    status: 'UNKNOWN',
    confidence: 'MEDIUM',
    evidenceSummary: 'SunEnergy1 — utility-scale developer; not a residential rooftop installer.',
    source1: '',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'unknown',
    notes: 'Utility-scale — not a rooftop campaign target.',
  },
  canadiansolar: {
    status: 'ACTIVE',
    confidence: 'HIGH',
    evidenceSummary: 'Canadian Solar — manufacturer still exists; permits may reflect equipment supplier not installer.',
    source1: 'Public manufacturer presence',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'unknown',
    notes: 'May be equipment manufacturer on permit, not installing contractor.',
  },
  sigorasolar: {
    status: 'ACTIVE',
    confidence: 'MEDIUM',
    evidenceSummary: 'Sigora Solar — known NC/VA installer; permit activity in dataset.',
    source1: 'Public operating company / permit activity',
    source2: '',
    successorCompany: '',
    successorStillServicesSystems: 'yes',
    notes: 'Includes sigorasolarllcmatthewdoran alias.',
  },
}

const DEFAULT_UNKNOWN: InstallerStatusRecord = {
  status: 'UNKNOWN',
  confidence: 'LOW',
  evidenceSummary: '',
  source1: '',
  source2: '',
  successorCompany: '',
  successorStillServicesSystems: 'unknown',
  notes: '',
}

const NON_INSTALLER_NOTE =
  'Permit applicant/project label, not a researched installer entity'

/** Frequency keys that are clearly not installer companies (person, address, project title, etc.). */
const NON_INSTALLER_FREQ_KEYS = new Set([
  '10761sapphiretrailsolarpanels',
  '7321ragingridgerd',
  'aacoofkannapolis',
  'additionof19solarpanels',
  'aldiharrisburgsolar',
  'allanmichaelbusbytaycoelectric',
  'annrobinson',
  'atsidischrist',
  'baughjohne',
  'bostonakil',
  'bradleydwainefite',
  'cagleresidencesolarapplication',
  'carportinstallation',
  'catawbacollege',
  'christopherjamessalmon',
  'christianlofton',
  'cookchiropracticsolar',
  'cookchiropracticsolarpanels',
  'cookgroundmountedsolar',
  'cooksolararrayaddition',
  'coyotepropertiessolarproject',
  'danieljamesbi',
  'danielericowentaycoelectric',
  'electricalpermit',
  'gerrywoodchrylser',
  'gerrywoodchrysler',
  'gerrywoodkia',
  'jackiebost',
  'jacobshibin',
  'johnjosephpowell',
  'kannapolischiropractor',
  'kellykmiles',
  'ktowncars',
  'ktowncarssolar',
  'ladysfuneralhomainbuildingsolar',
  'martysolarinstallation',
  'matthewdoran',
  'michaelcaudle',
  'michaeldurham',
  'mikewhitson',
  'millersolarproject',
  'mooresolarpanels',
  'nc102project',
  'peterjpiacente',
  'pintometalsolar',
  'richardsoncoleen',
  'robertstanleyharvey',
  'robertstephens',
  'shelterministriesofrowan',
  'solarforschoolsmountpleasanthighschool',
  'solarnails2',
  'targetdriveupbeacon',
  'testpermit',
  'walleriusjenna',
  'waterworksvisualarts',
])

const INSTALLER_TRADE_TOKENS =
  /\b(solar|electric|electrical|energy|power|roof|hvac|renewable|photovoltaic|pv|installation|installer|management|solutions|technologies|tech|solaria|forever|palmetto|sigora|msolar|beam|empower|empwr|complete|tier|gaf|tesla|telsa|southern|cypress|strata|sunenergy|canadian|lgcy|orbit|encor|byld|poly|emerald|freedom|adt|titan|global|blue|raven|nrg|accelerate|luminasun|homestar|elevate|solfarm|solstice|summit|yes|orbit|renewable|ecs|humium|delta|eagle|elav8|lotus|scsp|widespread|professional|mark|ritchie|morningstar|sanders|hamorsky|lighting|exposure|faith|source|residential|sustainable|southeastern|barrier|green|gregory|national|peg|pro|roof|diagnostics|cemco|carolina|caudle|keller|mabry|steve|wilson|all|phase|brown|big|rock|tayco|thompson|total|renewable|energy|conservation|design|group|world|chief|homes|farm|wise|developer|pine|gate|pugh|quarles|barrier|benue|argand|appalachian|amped|365|kb|e8|ion|g3|orbit|scsp|solfarm|solstice|summit|yes|widespread|orbit|national)\b/i

function looksLikePersonName(normalizedInstaller: string): boolean {
  const key = toFrequencyKey(normalizedInstaller)
  if (NON_INSTALLER_FREQ_KEYS.has(key)) return true
  if (/\d/.test(normalizedInstaller)) return true
  if (/^(test|electrical)\s+permit$/i.test(normalizedInstaller)) return true
  if (/\bsolar\s+(panels|project|installation|array|application)\b/i.test(normalizedInstaller)) return true
  if (/\b(church|chiropractic|chrysler|college|funeral|school|target|aldi|kia|cars|ministr)/i.test(normalizedInstaller)) {
    return true
  }
  if (INSTALLER_TRADE_TOKENS.test(normalizedInstaller)) return false
  const words = normalizedInstaller.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2 && words.length <= 4) {
    return true
  }
  return false
}

export function isNonInstallerEntity(normalizedInstaller: string): boolean {
  const key = toFrequencyKey(normalizedInstaller)
  if (NON_INSTALLER_FREQ_KEYS.has(key)) return true
  return looksLikePersonName(normalizedInstaller)
}

export function getInstallerStatus(freqKey: string, normalizedInstaller?: string): InstallerStatusRecord {
  const canonical = resolveCanonicalFrequencyKey(freqKey)
  const catalog = INSTALLER_STATUS_CATALOG[canonical]
  if (catalog) return { ...catalog }

  if (normalizedInstaller && isNonInstallerEntity(normalizedInstaller)) {
    return {
      ...DEFAULT_UNKNOWN,
      notes: NON_INSTALLER_NOTE,
    }
  }

  return { ...DEFAULT_UNKNOWN }
}

export function mergedAliasPropertyCount(
  freqKey: string,
  propertyCountByFreqKey: Map<string, number>,
): number | null {
  const group = resolveAliasGroup(freqKey)
  if (!group) return null
  let total = 0
  for (const member of group.members) {
    total += propertyCountByFreqKey.get(member) ?? 0
  }
  return total
}

export function aliasNoteForRow(
  freqKey: string,
  propertyCountByFreqKey: Map<string, number>,
): string {
  const group = resolveAliasGroup(freqKey)
  if (!group || group.canonical === freqKey) return ''
  const merged = mergedAliasPropertyCount(freqKey, propertyCountByFreqKey)
  return `Canonical entity: ${group.displayName} (${group.canonical}). Alias group merged property count: ${merged ?? 0}.`
}

/** Terminal statuses used for high-confidence orphan scoring. */
export const HIGH_CONFIDENCE_TERMINAL_STATUSES: InstallerBusinessStatus[] = [
  'DEFUNCT',
  'BANKRUPT',
  'DISSOLVED',
]

export function isHighConfidenceTerminal(status: InstallerStatusRecord): boolean {
  return (
    status.confidence === 'HIGH' &&
    HIGH_CONFIDENCE_TERMINAL_STATUSES.includes(status.status)
  )
}
