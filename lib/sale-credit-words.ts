/**
 * Sale credit lanes in words. A door-knocking company (canvassing on) credits a setter AND a closer, as always. Without
 * canvassing there are no setters: ONE "Salesperson" lane, no setter picker, no self-generated tick. The data model is
 * unchanged (`setterUserId` / `closerUserId` / `isSelfGenerated` are still saved as loaded) — this only decides what is shown.
 */
export type CreditLaneWords = { showSetter: boolean; closer: string; pickCloser: string; pickCloserShort: string }

export function creditLaneWords(canvassing: boolean): CreditLaneWords {
  return canvassing
    ? { showSetter: true, closer: 'Closer', pickCloser: 'Pick the closer', pickCloserShort: 'Pick who closed this sale.' }
    : { showSetter: false, closer: 'Salesperson', pickCloser: 'Pick the salesperson', pickCloserShort: 'Pick who sold this.' }
}
