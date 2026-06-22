/**
 * Shingle order constants (GAF Timberline-class defaults).
 * Field: 3 bundles / 100 sq ft roof (@ ~33.3 sq ft/bundle, 5.625" exposure).
 * Cap: GAF Seal-A-Ridge — 25 LF/bundle @ 6-2/3" exposure; 4 bundles ≈ 100 LF
 * (see gaf.com Seal-A-Ridge sell sheet). Cap "square" here = 100 LF of cap, not field sq ft.
 */
export const BUNDLES_PER_SQUARE = 3
export const SQFT_PER_SQUARE = 100
export const SHINGLES_PER_BUNDLE = 21
export const SHINGLES_PER_SQUARE = BUNDLES_PER_SQUARE * SHINGLES_PER_BUNDLE

/** 12" tab × 36" strip; 5.625" exposure per course (GAF / OC class) */
export const SHINGLE_TAB_WIDTH_IN = 12
export const SHINGLE_LENGTH_IN = 36
export const ARCHITECTURAL_EXPOSURE_IN = 5.625
export const EXPOSURE_FT = ARCHITECTURAL_EXPOSURE_IN / 12

/** Cap order unit: 100 LF hip+ridge ≈ 4×25 LF bundles (GAF). Not the same as a field roofing square. */
export const DEFAULT_CAP_LF_PER_SQUARE = 100
/** GAF Seal-A-Ridge typical label; OC products may be ~20–31 LF/bundle — override per pricebook. */
export const CAP_LF_PER_BUNDLE = 25

/**
 * Starter strip runs along eaves + rakes. ARX uses IKO Leading Edge Plus
 * (published coverage ≈ 123.4 LF/bundle). Other products vary (GAF Pro-Start
 * ~120 LF, WeatherBlocker ~100 LF) — override per pricebook.
 */
export const STARTER_LF_PER_BUNDLE = 123.4

export const BASE_AREA_WASTE_RATE = 0.07
/** ~12" tab waste per sloped course along valley (both sides cut) */
export const WASTE_SHINGLES_PER_COURSE_VALLEY = 0.45
/** Angled course cuts along hip (field shingles only; caps ordered separately) */
export const WASTE_SHINGLES_PER_COURSE_HIP = 0.24
/** Trim at ridge line on top course of each plane */
export const WASTE_SHINGLES_PER_COURSE_RIDGE_TRIM = 0.1
export const MIN_WASTE_PERCENT = 10
export const MAX_WASTE_PERCENT = 25
