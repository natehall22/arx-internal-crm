/**
 * What an inbound text IS (client-safe, pure): a carrier keyword (STOP / HELP / START), a plain-language opt-out, or an
 * ordinary message.
 *
 * Opt-outs: the seven words the FCC revocation rule names (STOP, QUIT, END, CANCEL, UNSUBSCRIBE, REVOKE, OPT OUT) plus
 * STOPALL and OPTOUT, matched as the WHOLE message (case, spacing and punctuation ignored). Past that the rule is "any
 * reasonable request": a short list of plain phrases ("please stop texting me", "take me off your list") is treated as an
 * opt-out and flagged for staff. These patterns are anchored on purpose so "can you stop by at 3?" or "end of the month
 * works" are NOT opt-outs — a wrongly silenced customer is cheap to fix (they reply START); a missed opt-out is not.
 */

export type InboundKind = 'stop' | 'help' | 'start' | 'optout_phrase' | 'wrong_number' | 'message'

const STOP_WORDS = new Set(['stop', 'quit', 'end', 'cancel', 'unsubscribe', 'stopall', 'stop all', 'revoke', 'optout', 'opt out'])
const HELP_WORDS = new Set(['help', 'info'])
const START_WORDS = new Set(['start', 'unstop'])

/** Lower-cased, punctuation / emoji removed, spaces collapsed: "  STOP! 🙏 " → "stop". */
export function normalizeKeyword(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const FILLER = '(?:please |pls |plz |kindly |just |now |i said |i said to |i want you to |i need you to |you need to |you must |can you |could you |would you |will you )*'
const TEXT_NOUN = "(?:text|texts|texting|textings|message|messages|messaging|sms|sending|contacting|reminders?|notifications?|alerts?)"
const TAIL = `(?: me| us| my phone| my number| this number| these| those| them| all| now| already| again| anymore| any more| please| pls| thanks| thank you| ${TEXT_NOUN})*`

const OPTOUT_PHRASES: RegExp[] = [
  new RegExp(`^${FILLER}(?:stop|quit|cease|end)(?: all| the| these| those| this| that| your| automated| auto)* ${TEXT_NOUN}${TAIL}$`),
  new RegExp(`^${FILLER}(?:do not|dont|don't|do nt|never) (?:text|message|contact|send)${TAIL}(?: any more| anymore| again| ever)?${TAIL}$`),
  new RegExp(`^${FILLER}(?:no more|no further) (?:${TEXT_NOUN})${TAIL}$`),
  new RegExp(`^${FILLER}(?:remove|delete|take|drop) (?:me|us|my number|this number) (?:from|off|of)(?: the| your| this| all)* (?:list|lists|texts|text|messages|messaging|sms)${TAIL}$`),
  new RegExp(`^${FILLER}(?:unsubscribe|opt out|opt me out|opt us out)(?: me| us)?(?: from| of)?(?: the| your| this| these| those| all)*(?: list| texts| messages| text messages)?${TAIL}$`),
  new RegExp(`^${FILLER}i (?:want to |would like to |wish to |need to )?(?:opt out|unsubscribe|revoke)(?: of| from)?(?: the| your| this| all)*(?: texts| messages| text messages| list)?${TAIL}$`),
  new RegExp(`^${FILLER}(?:leave me alone|quit bothering me|stop bothering me|stop contacting me)${TAIL}$`),
]

export function classifyInbound(text: string): InboundKind {
  const t = normalizeKeyword(text)
  if (!t) return 'message'
  if (STOP_WORDS.has(t)) return 'stop'
  if (HELP_WORDS.has(t)) return 'help'
  if (START_WORDS.has(t)) return 'start'
  if (OPTOUT_PHRASES.some((re) => re.test(t))) return 'optout_phrase'
  if (/^(?:sorry )?(?:this is |you have |you've got |u have )?(?:the )?wrong number(?: sorry)?$|^wrong number$|^(?:you have|you've got|u have) the wrong (?:number|person)$|^wrong person$/.test(t)) return 'wrong_number'
  return 'message'
}
