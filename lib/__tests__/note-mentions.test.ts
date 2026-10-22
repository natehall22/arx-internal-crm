import { mentionCandidates, noteMentionHighlightRegex, resolveNoteMentions, type MentionCandidate } from '@/lib/note-mentions'

const users = [
  { id: 'u-steve', full_name: 'Steve Potts' },
  { id: 'u-stephanie', full_name: 'Stephanie Reyes' },
  { id: 'u-sten', full_name: 'Sten' },
  { id: 'u-andrew', full_name: 'Andrew Waltz' },
  { id: 'u-andy', full_name: 'Andrew' },
]
const ids = (note: string, picked: string[] = [], list: MentionCandidate[] = users) =>
  resolveNoteMentions(note, list, picked).map((u) => u.id)

describe('resolveNoteMentions — exact only, never prefix fan-out', () => {
  it('"@Ste" matches nobody (the old prefix bug pinged every Ste…)', () => {
    expect(ids('@Ste can you check the gutters?')).toEqual([])
  })

  it('a partial first name matches nobody', () => {
    expect(ids('ping @Steve about the dumpster')).toEqual([])
  })

  it('exact full name matches, case-insensitive, with trailing punctuation', () => {
    expect(ids('@steve potts, dumpster is late.')).toEqual(['u-steve'])
    expect(ids('Thanks @Stephanie Reyes!')).toEqual(['u-stephanie'])
    expect(ids('(@Steve Potts)')).toEqual(['u-steve'])
  })

  it('longest name wins at one @ — "@Andrew Waltz" does not also ping "Andrew"', () => {
    expect(ids('@Andrew Waltz please confirm')).toEqual(['u-andrew'])
    expect(ids('@Andrew please confirm')).toEqual(['u-andy'])
  })

  it('a name followed by more letters is not a match ("@Stenson" ≠ Sten)', () => {
    expect(ids('@Stenson is the adjuster')).toEqual([])
    expect(ids('@Sten is the adjuster')).toEqual(['u-sten'])
  })

  it('email addresses are not mentions', () => {
    expect(ids('send to sten@Sten example')).toEqual([])
  })

  it('several mentions, de-duplicated, in order of appearance', () => {
    expect(ids('@Sten and @Steve Potts — @Sten again')).toEqual(['u-sten', 'u-steve'])
  })

  it('collapses extra spaces inside a typed name', () => {
    expect(ids('@Steve   Potts\nsee photos')).toEqual(['u-steve'])
  })

  describe('two users with the same full name', () => {
    const dupes = [
      { id: 'u-john-1', full_name: 'John Smith' },
      { id: 'u-john-2', full_name: 'John Smith' },
    ]
    it('with no pick, nobody is pinged (never both)', () => {
      expect(ids('@John Smith call the homeowner', [], dupes)).toEqual([])
    })
    it('the one picked in the composer is pinged', () => {
      expect(ids('@John Smith call the homeowner', ['u-john-2'], dupes)).toEqual(['u-john-2'])
    })
  })

  it('a picked id never adds someone whose @name is not in the text', () => {
    expect(ids('no mentions here', ['u-steve'])).toEqual([])
    expect(ids('@Sten only', ['u-steve'])).toEqual(['u-sten'])
  })

  it('a client-sent id for someone outside the user list is ignored', () => {
    expect(ids('@Steve Potts', ['u-outsider'])).toEqual(['u-steve'])
  })

  it('ignores users with blank names', () => {
    expect(ids('@ hello', [], [{ id: 'x', full_name: '' }, { id: 'y', full_name: null }])).toEqual([])
  })

  describe('what may come right before the @', () => {
    it.each([
      ['"@Sten" said', 'double quote'],
      ["'@Sten' said", 'apostrophe'],
      ['*@Sten* bold', 'asterisk'],
      ['-@Sten', 'hyphen'],
      ['—@Sten', 'em dash'],
      ['–@Sten', 'en dash'],
      ['ask Steve/@Sten', 'slash'],
      ['(@Sten)', 'paren'],
    ])('%s (%s) is a mention', (note) => {
      expect(ids(note)).toEqual(['u-sten'])
    })

    it('an @ after a letter or digit (email address) is not a mention', () => {
      expect(ids('mail sten@Sten now')).toEqual([])
      expect(ids('x2@Sten')).toEqual([])
    })

    it('an @ inside a URL is not a mention', () => {
      expect(ids('see https://social.example/@Sten for photos')).toEqual([])
      expect(ids('www.example.com/@Sten')).toEqual([])
    })
  })

  describe('what may come right after the name', () => {
    it('"@Andrew Waltzman" pings neither "Andrew Waltz" nor "Andrew"', () => {
      expect(ids('@Andrew Waltzman is the adjuster')).toEqual([])
    })
    it('"@Andrew-Waltz" (hyphenated continuation) does not ping "Andrew"', () => {
      expect(ids('@Andrew-Waltz')).toEqual([])
    })
    it('trailing hyphen, dash or punctuation ends the name', () => {
      expect(ids('@Sten- can you')).toEqual(['u-sten'])
      expect(ids('@Sten — can you')).toEqual(['u-sten'])
      expect(ids('@Sten: can you')).toEqual(['u-sten'])
      expect(ids('@Sten?')).toEqual(['u-sten'])
    })
    it("possessive 's ends the name; other apostrophe continuations do not", () => {
      expect(ids("@Steve Potts's truck")).toEqual(['u-steve'])
      expect(ids('@Steve Potts\u2019s truck')).toEqual(['u-steve'])
      expect(ids("@Sten'ar")).toEqual([])
    })
    it('accented names match exactly', () => {
      const list = [{ id: 'u-jose', full_name: 'José Núñez' }]
      expect(ids('@José Núñez please', [], list)).toEqual(['u-jose'])
      expect(ids('@José Núñezz', [], list)).toEqual([])
    })
  })
})

describe('mentionCandidates — one candidate list', () => {
  it('keeps only active users with a name and an email', () => {
    const list = [
      { id: 'a', full_name: 'A', email: 'a@x.test', active: true },
      { id: 'b', full_name: 'B', email: 'b@x.test', active: false },
      { id: 'c', full_name: 'C', email: null, active: true },
      { id: 'd', full_name: ' ', email: 'd@x.test', active: true },
      { id: 'e', full_name: 'E', email: '  ', active: null },
      { id: 'f', full_name: 'F', email: 'f@x.test', active: null },
    ]
    expect(mentionCandidates(list).map((u) => u.id)).toEqual(['a', 'f'])
  })
})

describe('noteMentionHighlightRegex (display only)', () => {
  const highlights = (text: string) => Array.from(text.matchAll(noteMentionHighlightRegex())).map((m) => m[2])
  it('highlights first + capitalised last name, accents, hyphens and apostrophes', () => {
    expect(highlights('@Steve Potts can you')).toEqual(['Steve Potts'])
    expect(highlights('@José Núñez ok')).toEqual(['José Núñez'])
    expect(highlights("@Ann O'Neil and @Mary-Kate")).toEqual(["Ann O'Neil", 'Mary-Kate'])
  })
  it('does not swallow a following lowercase word or highlight email addresses', () => {
    expect(highlights('@Steve can you')).toEqual(['Steve'])
    expect(highlights('mail sten@example.com')).toEqual([])
  })
})
