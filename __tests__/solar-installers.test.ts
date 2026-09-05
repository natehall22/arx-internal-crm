import {
  installerNameKey,
  installerDisplayName,
  installerNameSimilarity,
  isOrphaned,
} from '@/lib/solar-installers'

describe('installerNameKey', () => {
  it('collapses legal-suffix spelling variants to one key', () => {
    const variants = [
      'SunPro Solar LLC',
      'SUNPRO SOLAR, INC.',
      'Sunpro Solar',
      '  SunPro   Solar  L.L.C.  ',
      'SunPro Solar Incorporated',
    ]
    const keys = new Set(variants.map((v) => installerNameKey(v)))
    expect(keys.size).toBe(1)
    expect(keys.has('sunpro solar')).toBe(true)
  })

  it('strips stacked legal suffixes', () => {
    expect(installerNameKey('Acme Solar Inc LLC')).toBe('acme solar')
  })

  it('keys on the legal name, dropping a d/b/a clause', () => {
    expect(installerNameKey('Acme Energy LLC DBA SunPro')).toBe('acme energy')
    expect(installerNameKey('Acme Energy LLC d/b/a SunPro')).toBe('acme energy')
  })

  it('drops a leading "the" when a distinctive name remains', () => {
    expect(installerNameKey('The Sunshine Group LLC')).toBe('sunshine group')
  })

  it('keeps "Company" when stripping it would erase the identity', () => {
    // "The Solar Company" is a real name; reducing it to "solar" would fuse it
    // with every other generic solar outfit.
    expect(installerNameKey('The Solar Company LLC')).toBe('solar company')
  })

  it('strips "Co" when the name survives without it', () => {
    expect(installerNameKey('Coastal Solar Co')).toBe('coastal solar')
  })

  it('treats punctuation and spacing as equivalent', () => {
    expect(installerNameKey('Sun-Pro Solar')).toBe(installerNameKey('Sun Pro Solar'))
  })

  it('returns null for owner-installed permits rather than inventing a company', () => {
    for (const raw of ['OWNER', 'Homeowner', 'owner builder', 'SELF', 'N/A', 'none', '']) {
      expect(installerNameKey(raw)).toBeNull()
    }
  })

  it('returns null for null, undefined, and whitespace', () => {
    expect(installerNameKey(null)).toBeNull()
    expect(installerNameKey(undefined)).toBeNull()
    expect(installerNameKey('   ')).toBeNull()
  })

  it('returns null when only a bare trade word remains', () => {
    expect(installerNameKey('Solar')).toBeNull()
    expect(installerNameKey('ELECTRICAL LLC')).toBeNull()
  })

  it('returns null when the value is nothing but a legal suffix', () => {
    expect(installerNameKey('LLC')).toBeNull()
    expect(installerNameKey('inc.')).toBeNull()
  })

  it('keeps genuinely different companies apart', () => {
    expect(installerNameKey('Blue Ridge Solar')).not.toBe(installerNameKey('Blue Sky Solar'))
    expect(installerNameKey('Carolina Solar Energy')).not.toBe(installerNameKey('Carolina Solar Works'))
  })

  it('does not strip a suffix word that is part of the name', () => {
    // "Co" here is the start of "Coastal", not a legal suffix.
    expect(installerNameKey('Coastal Solar')).toBe('coastal solar')
  })
})

describe('installerDisplayName', () => {
  it('title-cases all-caps permit entries', () => {
    expect(installerDisplayName('SUNPRO SOLAR LLC')).toBe('Sunpro Solar LLC')
  })

  it('preserves intentional mixed case', () => {
    expect(installerDisplayName('SunPower Corporation')).toBe('SunPower Corporation')
    expect(installerDisplayName('iSolar Energy')).toBe('iSolar Energy')
  })

  it('collapses stray whitespace', () => {
    expect(installerDisplayName('  Acme   Solar  ')).toBe('Acme Solar')
  })

  it('returns null for values that name no company', () => {
    expect(installerDisplayName('OWNER')).toBeNull()
    expect(installerDisplayName('')).toBeNull()
    expect(installerDisplayName(null)).toBeNull()
  })
})

describe('installerNameSimilarity', () => {
  it('scores identical keys as 1', () => {
    expect(installerNameSimilarity('acme solar', 'acme solar')).toBe(1)
  })

  it('scores shared-token names high enough to flag for review', () => {
    expect(installerNameSimilarity('abc solar charlotte', 'abc solar raleigh')).toBeGreaterThan(0.6)
  })

  it('scores unrelated names low', () => {
    expect(installerNameSimilarity('acme solar', 'zenith roofing')).toBeLessThan(0.3)
  })

  it('handles empty input without dividing by zero', () => {
    expect(installerNameSimilarity('', 'acme solar')).toBe(0)
    expect(installerNameSimilarity('', '')).toBe(1)
  })
})

describe('isOrphaned', () => {
  it('is true only for a confirmed-defunct installer', () => {
    expect(isOrphaned('defunct')).toBe(true)
    expect(isOrphaned('active')).toBe(false)
  })

  it('is false for unknown — an unmatched name is not evidence of death', () => {
    expect(isOrphaned('unknown')).toBe(false)
  })
})
