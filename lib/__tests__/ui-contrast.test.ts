import config from '../../tailwind.config'

// Contrast is solved once in the tokens; this keeps it solved.
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const colors = (config.theme!.extend as any).colors

describe('design tokens', () => {
  it('text and button colors meet WCAG AA on their surfaces', () => {
    expect(ratio(colors.ink.DEFAULT, colors.surface.DEFAULT)).toBeGreaterThanOrEqual(7)
    expect(ratio(colors.ink.muted, colors.surface.DEFAULT)).toBeGreaterThanOrEqual(7)
    expect(ratio(colors.ink.muted, colors.surface.subtle)).toBeGreaterThanOrEqual(4.5)
    expect(ratio('#ffffff', colors.brand[700])).toBeGreaterThanOrEqual(4.5) // primary button
    expect(ratio('#ffffff', colors.danger.DEFAULT)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(colors.brand[900], colors.brand[50])).toBeGreaterThanOrEqual(7) // accent pill
  })
})
