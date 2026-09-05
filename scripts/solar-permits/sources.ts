import type { JurisdictionCoverage } from './schema'

/**
 * Registry of jurisdictions in ARX's Charlotte-metro canvass footprint.
 * Cities with separate portals are listed explicitly — permit data does not
 * always roll up to the county FeatureServer.
 *
 * Verified live 2026-08-27–28 (Mecklenburg AGOL + Rowan GIS + Cabarrus Crystal Hub).
 */
export const JURISDICTIONS: Omit<
  JurisdictionCoverage,
  'solarPermitCount' | 'sampleCount' | 'yearsAvailable' | 'lastAuditedAt'
>[] = [
  {
    id: 'cabarrus-county',
    name: 'Cabarrus County (+ Concord, Kannapolis, Harrisburg via county GIS)',
    county: 'Cabarrus',
    access: 'bulk_open',
    bulkSource:
      'ArcGIS MapServer yearly permit layers (2011–2015+) + CAMA Real Property Permit CSV',
    portalUrl: 'https://cabarruscountync.gov/Government/Departments/Planning-and-Development/Permits',
    notes:
      'Verified 2026-08-28. ArcGIS DetailedDescription LIKE %SOLAR% through 2018 (address + PIN14 + AppName/Applicant). CAMA CSV fills notes ~1986–2025, no contractor. Accela 2019+ has no Solar type — Solar=Yes is a detail ASI; do not scrape. Crystal date-range reports at https://gis-cabarrus.opendata.arcgis.com/pages/building-reports ("Building Permits Cabarrus County" = PIN/owner/address/date/cost, no solar filter; EDC report may include contractor; "Building Permits Rowan County" = Kannapolis city-limit parcels that sit in Rowan, from Cabarrus systems). PRA still the way to get Solar=Yes + contractor for 2019+.',
  },
  {
    id: 'mecklenburg-county',
    name: 'Mecklenburg County',
    county: 'Mecklenburg',
    access: 'partial_open',
    bulkSource:
      'meckgis BuildingPermits FeatureServer/0 (legacy, dated) + AGOL EPIC_Accela FeatureServer/1 (SolarPV 2024+). No contractor names.',
    portalUrl: 'https://aca-prod.accela.com/MECKLENBURG',
    notes:
      'Verified 2026-08-28. Legacy BuildingPermits (~482k; ~5892 permitdesc SOLAR; issuedate + projadd + parcelnum; owner name only — Skylight/Solar Panel boilerplate, not PV-only). EPIC Accela FeatureServer/1 SolarPV ~521 (2025–2026). AccelaAllPermits and BuildingPermits_Accela are count-only or feature-query 400. EPIC has owner_phone/owner_email — do not ingest. Official Power BI “Daily Building Permits Issued” (code.mecknc.gov/node/1041) exports CSV in ≤3-month / 30k windows — confirm SolarPV and contractor columns before walking dates; not a REST API. PRA still needed for installer legal names. Charlotte does not issue building/electrical permits.',
  },
  {
    id: 'rowan-county',
    name: 'Rowan County',
    county: 'Rowan',
    access: 'bulk_open',
    bulkSource:
      'ArcGIS MapServer/6 "Rowan County ALL Permits" (~138k; Solar PV via sName_Workclass)',
    portalUrl: 'https://energovweb.rowancountync.gov/EnerGov_Prod/selfservice#/home',
    notes:
      'Verified 2026-08-28. GIS MapServer/6 is the bulk path (~2,099 Solar/Solar PV/Solar Water). EnerGov CSS path is EnerGov_Prod (EnerGovProd 404s) and login-gated — do not scrape. sCompanyName_Parc is installer when filled on recent residential; older/commercial often the property owner. Kannapolis city limits (including the Rowan portion) permit through Cabarrus Accela; Rowan L6 still has Kannapolis ETJ. PRA optional for license numbers / 2011–2013 PV not coded as those work classes.',
  },
  {
    id: 'union-county',
    name: 'Union County (excl. Monroe, Waxhaw)',
    county: 'Union',
    access: 'pra_recommended',
    bulkSource: null,
    portalUrl: 'https://ucinspect.unioncountync.gov/EvolvePublic/',
    notes:
      'Evolve portal search only (HTTP 200). atlas.unioncountync.gov has no permit FeatureServer (Hosted = inspection zones; LandRecordsPro token-locked). Monroe CityView https://cvportal.monroenc.org/portal. Waxhaw Tyler EnerGov https://waxhawnc-energovpub.tylerhost.net/apps/citizenaccess/Site/Permit/Search (search was 503 when probed; no /api/permit/search). PRA to county + Monroe + Waxhaw. Do not scrape Evolve.',
  },
  {
    id: 'gaston-county',
    name: 'Gaston County',
    county: 'Gaston',
    access: 'pra_recommended',
    bulkSource: null,
    portalUrl: 'https://selfservice.gastongov.com/energov_prod/selfservice#/home',
    notes:
      'EnerGov CSS only. gis.gastoncountync.gov EnerGov and BCS folders return Token Required (499); PublicGIS is developments/zoning, not permits. County issues construction permits for Gastonia since 2022-08-29 (city keeps zoning/fire in CityView). Pre-2022 Gastonia building history is CityView. Kings Mountain is a separate OpenGov building department (Gaston/Cleveland split). PRA to county; add Kings Mountain; add Gastonia only if pre-2022 CityView is needed. Do not scrape.',
  },
  {
    id: 'iredell-county',
    name: 'Iredell County (+ Statesville; Mooresville separate since 2023)',
    county: 'Iredell',
    access: 'pra_recommended',
    bulkSource: null,
    portalUrl: 'https://selfservice.iredellcountync.gov/energov_prod/selfservice#/home',
    notes:
      'EnerGov CSS only. PermittingApp/EnerGov history layers exist but are a leftover queue (~14 rows, Feb–Mar 2022) with no address/PIN/contractor — not a permit warehouse. Mooresville + ETJ since ~2023: GeoCivix https://mooresvillenc.geocivix.com/secure/. PRA via iredellcountync.gov/724/Request plus a separate Mooresville request. Do not scrape Civic Access.',
  },
  {
    id: 'lincoln-county',
    name: 'Lincoln County',
    county: 'Lincoln',
    access: 'pra_recommended',
    bulkSource: null,
    portalUrl: 'https://linc.csqrcloud.com/community-etrakit/',
    notes:
      'eTRAKiT search-only (public account required). OpenGov replaces eTRAKiT on 2026-10-15; records said to migrate. GIS TRACKiT/ComDev are parcels/zoning, not permit rows. Lincolnton does zoning only — county building/electrical covers city + ETJ + unincorporated, so one PRA. Do not scrape eTRAKiT.',
  },
]

export function blankCoverageRows(): JurisdictionCoverage[] {
  return JURISDICTIONS.map((j) => ({
    ...j,
    solarPermitCount: null,
    sampleCount: null,
    yearsAvailable: null,
    lastAuditedAt: null,
  }))
}
