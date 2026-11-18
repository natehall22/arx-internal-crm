/** Case- and spacing-insensitive comparison key (addresses, names). Client-safe; the one normalizer for "is this the same text". */
export const textKey = (v: string | null | undefined): string => (v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
