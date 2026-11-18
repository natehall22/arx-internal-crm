// The ONE roofing / ARX term list. Read by scripts/roofing-words-ratchet.mjs (static guard), the render guard
// (lib/__tests__/roofing-words-guard.test.tsx) and the phone crawl (e2e/mobile.spec.ts). CommonJS so jest and Playwright can require it.
const TERMS_SOURCE = [
  '(?<![A-Za-z0-9])ARX(?![a-z0-9])',
  'arxroofing',
  '\\broof(?:s|ing|er|ers)?\\b',
  'shingles?',
  'tear[- ]?off',
  'insurance',
  'insurer',
  'adjusters?',
  '\\bclaims?\\b',
  'setters?\\b',
  'closers?\\b',
  'canvass\\w*',
  'door[- ]?knock\\w*',
  '\\bdoors? (?:knocked|per|count)',
  'storm\\w*',
  '\\bhail\\b',
  'gutters?',
  '\\bsiding\\b',
  '\\bIKO\\b',
  'homeowners?',
  'Kannapolis',
  'Concord',
  'Charlotte',
  'dump run',
  'squares?\\b',
].join('|')

module.exports = {
  TERMS_SOURCE,
  /** Case-insensitive, NOT global: safe for .test() / toMatch / String.match in tests. */
  TERMS: new RegExp(TERMS_SOURCE, 'i'),
  /** For crawling a RENDERED page: the same list minus place names (Kannapolis / Concord / Charlotte), because customer and
   *  job addresses on screen legitimately contain them. Source code still scans with TERMS. */
  SCREEN_TERMS: new RegExp(TERMS_SOURCE.split('|').filter((t) => !['Kannapolis', 'Concord', 'Charlotte'].includes(t)).join('|'), 'i'),
}
