/**
 * Client-side disposition filter for merged map pins (viewport + offline pending).
 * Must match /api/canvass/leads/viewport disposition handling.
 */
export function matchesCanvassDispositionFilter(
  pin: {
    disposition?: string | null
    status?: string
    d?: string | null
    s?: string
  },
  filter: string | null
): boolean {
  if (filter == null || filter === '') return true

  if (filter === 'scheduled') {
    return (
      pin.status === 'inspection' ||
      pin.s === 'inspection' ||
      pin.disposition === 'inspection_scheduled' ||
      pin.d === 'inspection_scheduled'
    )
  }

  const disp = pin.disposition ?? pin.d ?? null
  return disp === filter
}
