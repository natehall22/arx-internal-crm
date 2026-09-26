/**
 * USGS 3DEP lidar datasets for the counties ARX works (NC Phase 4, 2016–17).
 * `baseUrl` is the dataset's rockyweb folder: `<baseUrl>/<workunit>.vpc` is the STAC
 * tile index and `<baseUrl>/LAZ/<tile>.laz` the tiles. All are NAD83(2011) NC State
 * Plane US survey feet (EPSG:6543) with NAVD88 heights in feet.
 * Found via lib/usgs-3dep.ts (fetchUsgsLidarAvailability) on 2026-09-26.
 */
export type LidarDataset = {
  county: string
  workunit: string
  qualityLevel: string
  collectedEnd: string
  baseUrl: string
}

const ROCKYWEB = 'https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects'

export const NC_LIDAR_DATASETS: LidarDataset[] = [
  { county: 'Cabarrus', workunit: 'NC_Phase4_Cabarrus_2016', qualityLevel: 'QL1', collectedEnd: '2017-02-21', baseUrl: `${ROCKYWEB}/NC_Phase_4_CentralWestNC_GEIGER_A16/NC_Phase4_Cabarrus_2016` },
  { county: 'Rowan', workunit: 'NC_Phase4_Rowan_2017', qualityLevel: 'QL1', collectedEnd: '2017-10-30', baseUrl: `${ROCKYWEB}/USGS_LPC_NC_Phase4_Rowan_2017_LAS_2019` },
  { county: 'Mecklenburg', workunit: 'NC_Phase4_Mecklenburg_2016', qualityLevel: 'QL1', collectedEnd: '2017-02-21', baseUrl: `${ROCKYWEB}/NC_Phase_4_CentralWestNC_GEIGER_A16/NC_Phase4_Mecklenburg_2016` },
  { county: 'Iredell', workunit: 'NC_Phase4_Iredell_2017', qualityLevel: 'QL1', collectedEnd: '2017-02-21', baseUrl: `${ROCKYWEB}/NC_Phase4_2017_A17/NC_Phase4_Iredell_2017` },
  { county: 'Stanly', workunit: 'NC_Phase4_Stanly_2016', qualityLevel: 'QL1', collectedEnd: '2017-10-30', baseUrl: `${ROCKYWEB}/NC_Phase_4_CentralWestNC_GEIGER_A16/NC_Phase4_Stanly_2016` },
  { county: 'Union', workunit: 'NC_Phase4_Union_2016', qualityLevel: 'QL1', collectedEnd: '2017-10-30', baseUrl: `${ROCKYWEB}/NC_Phase_4_CentralWestNC_GEIGER_A16/NC_Phase4_Union_2016` },
  { county: 'Davidson', workunit: 'NC_Phase4_Davidson_2017', qualityLevel: 'QL2', collectedEnd: '2017-02-21', baseUrl: `${ROCKYWEB}/NC_Phase4_2017_A17/NC_Phase4_Davidson_2017` },
  { county: 'Gaston', workunit: 'NC_Phase4_Gaston_2016', qualityLevel: 'QL1', collectedEnd: '2017-02-21', baseUrl: `${ROCKYWEB}/NC_Phase_4_CentralWestNC_GEIGER_A16/NC_Phase4_Gaston_2016` },
  { county: 'Lincoln', workunit: 'NC_Phase4_Lincoln_2016', qualityLevel: 'QL1', collectedEnd: '2017-02-21', baseUrl: `${ROCKYWEB}/USGS_LPC_NC_Phase4_Lincoln_2016_LAS_2019` },
  { county: 'Catawba', workunit: 'NC_Phase4_Catawba_2017', qualityLevel: 'QL1', collectedEnd: '2017-02-21', baseUrl: `${ROCKYWEB}/NC_Phase4_2017_A17/NC_Phase4_Catawba_2017` },
]

export const LIDAR_BUILDINGS_BUCKET = 'lidar-buildings'

export function lidarTileId(workunit: string, tileName: string): string {
  return `${workunit}/${tileName}`
}

export function lidarStoragePath(workunit: string, tileName: string): string {
  return `${workunit}/${tileName}.arxl.gz`
}
