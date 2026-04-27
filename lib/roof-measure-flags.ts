/**
 * OpenAI satellite roof trace (`detectionMode: 'vision'` → `/api/ai/detect-roof`).
 * Off by default to avoid token spend while alignment/quality are improved.
 * Flip to `true` to re-enable the “AI trace roof” control and API branch.
 */
export const ROOF_MEASURE_VISION_TRACE_ENABLED = false
