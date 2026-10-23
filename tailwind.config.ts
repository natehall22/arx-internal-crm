import type { Config } from 'tailwindcss'

/**
 * Design tokens for the app UI kit (components/ui). One neutral palette, one brand accent, semantic colors.
 * Additive: Tailwind's default palette is untouched, so the canvass app and every existing screen render as before.
 * Text never goes below 14px in the kit (`text-sm`); body copy is 16px.
 */
const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        // Ink: all text. #2c2c2a on white = 13.9:1; ink-muted = 7.4:1 (both AAA). No lighter text tone exists on purpose.
        ink: { DEFAULT: '#2c2c2a', muted: '#55544f' },
        surface: { DEFAULT: '#ffffff', subtle: '#f6f5f2', line: '#e3e1db' },
        // Brand accent (olive-gold). 600 on white = 5.0:1 (AA); text on tinted 50 uses 900.
        brand: {
          50: '#f7f5e6', 100: '#efebc9', 200: '#e0d89b', 500: '#a79a2e', 600: '#857a20', 700: '#6a6119', 800: '#544d16', 900: '#3f3a12',
        },
        danger: { DEFAULT: '#b42318' },
      },
      fontSize: {
        // Kit scale. Nothing under 14px.
        'ui-sm': ['0.875rem', { lineHeight: '1.25rem' }],
        'ui-base': ['1rem', { lineHeight: '1.5rem' }],
        'ui-lg': ['1.125rem', { lineHeight: '1.75rem' }],
        'ui-xl': ['1.5rem', { lineHeight: '2rem' }],
      },
      borderRadius: { ui: '0.625rem' },
      minHeight: { tap: '2.75rem' },
      minWidth: { tap: '2.75rem' },
    },
  },
  plugins: [],
}
export default config
