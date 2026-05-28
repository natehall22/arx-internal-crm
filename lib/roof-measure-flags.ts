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
