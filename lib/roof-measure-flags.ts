/**
 * OpenAI satellite photo trace (`detectionMode: 'vision'` → `/api/ai/detect-roof`).
 * Off by default — vision traces are misaligned vs the live map; enable only for internal experiments.
 */
export const ROOF_MEASURE_VISION_TRACE_ENABLED = false

/**
 * Plane-intersection ridge/hip/valley LF (2.5D). Default off until calibrated on Greenway + golden fixtures.
 */
export const USE_PLANE_INTERSECTION_LF = false
