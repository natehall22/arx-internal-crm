/**
 * OpenAI satellite photo trace (`detectionMode: 'vision'` → `/api/ai/detect-roof`).
 * Off by default — vision traces are misaligned vs the live map; enable only for internal experiments.
 */
export const ROOF_MEASURE_VISION_TRACE_ENABLED = false

/**
 * Plane-intersection ridge/hip/valley LF (2.5D). Default off until Greenway calibration beats 2D in production.
 * Ops may set NEXT_PUBLIC_USE_PLANE_INTERSECTION_LF=true for staged testing only.
 */
export const USE_PLANE_INTERSECTION_LF =
  process.env.NEXT_PUBLIC_USE_PLANE_INTERSECTION_LF === 'true'

/**
 * DSM-plane roof-mask split: label each roof pixel by the Solar plane whose predicted
 * elevation best matches the (georeferenced) DSM, so facet boundaries follow real
 * ridges/hips instead of nearest-segment-center Voronoi bisectors. Falls back to
 * Voronoi per-pixel wherever DSM is missing. On by default (verified quality win with
 * safe fallback) — set ROOF_MEASURE_DSM_PLANE_SPLIT=false to revert to pure Voronoi.
 */
export const ROOF_MEASURE_DSM_PLANE_SPLIT =
  process.env.ROOF_MEASURE_DSM_PLANE_SPLIT !== 'false'

/**
 * Plane-intersection reconstruction for ridge/hip/valley/eave/rake LF — clean, correctly-typed
 * lengths from Solar planes. Phase 2b adds facet-local valley/concave support when reliable;
 * convex hip/gable roofs use the lower-envelope model. Self-gated reliability; complex roofs
 * fall back to the 2D result. Default OFF (staged) since it changes LF-derived waste/material
 * totals; set NEXT_PUBLIC_ROOF_MEASURE_RECON_LF=true to enable after field validation.
 */
export const ROOF_MEASURE_RECON_LF =
  process.env.NEXT_PUBLIC_ROOF_MEASURE_RECON_LF === 'true'
