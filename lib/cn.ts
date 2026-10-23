import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// The kit's own font sizes (tailwind.config.ts `ui-*`) must be known as font sizes, or twMerge treats `text-ui-lg` as a
// text COLOR and drops it (or the real color) when both appear.
const twMerge = extendTailwindMerge({ extend: { classGroups: { 'font-size': [{ text: ['ui-sm', 'ui-base', 'ui-lg', 'ui-xl'] }] } } })

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
