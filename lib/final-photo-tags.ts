/**
 * Final (completion) photo tags — one list for the ops Final Photos card, the
 * crew photo page, and the trade-completion check, so "which 4 shots are
 * required" has one answer.
 *
 * The same four walk-around angles are required PER TRADE: the siding crew
 * shows the siding, the gutter crew shows the gutters.
 */

export const REQUIRED_FINAL_PHOTO_TAGS = ['final_front', 'final_back', 'final_left', 'final_right'] as const

export const FINAL_PHOTO_TAGS: { value: string; label: string }[] = [
  { value: 'final_front', label: 'Front' },
  { value: 'final_back', label: 'Back' },
  { value: 'final_left', label: 'Left Side' },
  { value: 'final_right', label: 'Right Side' },
  { value: 'final_slope_1', label: 'Slope 1' },
  { value: 'final_slope_2', label: 'Slope 2' },
  { value: 'flashing_detail', label: 'Flashing Detail' },
  { value: 'pipe_boots', label: 'Pipe Boots' },
  { value: 'cleanup', label: 'Cleanup' },
  { value: 'other_final', label: 'Other' },
]

/** Crews can only use these — never arbitrary tags. */
export const CREW_PHOTO_TAGS = [...REQUIRED_FINAL_PHOTO_TAGS, 'other_final'] as const

export function finalPhotoTagLabel(tag: string | null | undefined): string | null {
  if (!tag) return null
  return FINAL_PHOTO_TAGS.find((t) => t.value === tag)?.label ?? tag
}

export function missingRequiredPhotoTags(tags: Iterable<string | null | undefined>): string[] {
  const have = new Set(Array.from(tags).filter(Boolean) as string[])
  return REQUIRED_FINAL_PHOTO_TAGS.filter((t) => !have.has(t))
}
