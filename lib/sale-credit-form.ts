/**
 * Client-safe pieces of the "Sale credit" step on the Send Agreement screen (components/contracts/ContractModal.tsx).
 * Display and validation only — sale credit is WRITTEN solely by lib/deal-sale-credit.ts, which enforces the same
 * self-generated rule on the server.
 */

export type SaleCreditForm = {
  closerUserId: string
  setterUserId: string
  isSelfGenerated: boolean
}

export type CreditPerson = { id: string; name: string | null; active: boolean }

export const SELF_GEN_SETTER_PROBLEM =
  'A self-generated sale has no separate setter. Clear the setter or untick self-generated.'

/** The self-generated rule the server enforces: a self-generated sale has no setter other than the closer. */
export function saleCreditFormProblem(credit: SaleCreditForm): string | null {
  if (!credit.closerUserId) return 'Pick who closed this sale'
  if (credit.isSelfGenerated && credit.setterUserId && credit.setterUserId !== credit.closerUserId) {
    return SELF_GEN_SETTER_PROBLEM
  }
  return null
}

/**
 * Ticking self-generated clears the setter in the form itself, so what is on screen is what is checked and saved.
 * Unticking restores the setter the form loaded with (`loadedSetterUserId`), so a mis-tick does not lose the stored one.
 */
export function setSelfGenerated(credit: SaleCreditForm, checked: boolean, loadedSetterUserId = ''): SaleCreditForm {
  return {
    ...credit,
    isSelfGenerated: checked,
    setterUserId: checked ? '' : credit.setterUserId || loadedSetterUserId,
  }
}

/**
 * Options for a closer/setter select: the active users, plus the person the deal already names when they are not in
 * that list (left the company, deactivated) — shown by name with "(inactive)" so the select never says "No setter"
 * over a stored setter.
 */
export function creditSelectOptions(
  activeUsers: Array<{ id: string; full_name: string | null }>,
  selectedId: string,
  people: CreditPerson[],
  /** Ids to keep listed even when not selected (the setter the form loaded with, while self-generated hides it). */
  keepIds: string[] = []
): Array<{ id: string; label: string }> {
  const options = activeUsers.map((u) => ({ id: u.id, label: u.full_name || 'Unnamed' }))
  for (const id of [selectedId, ...keepIds]) {
    if (!id || options.some((o) => o.id === id)) continue
    const person = people.find((p) => p.id === id)
    options.push({ id, label: `${person?.name || 'Unknown user'}${person?.active === false || !person ? ' (inactive)' : ''}` })
  }
  return options
}

/** Name for the review step, same rule as the options. */
export function creditPersonLabel(
  activeUsers: Array<{ id: string; full_name: string | null }>,
  id: string,
  people: CreditPerson[]
): string {
  if (!id) return 'None'
  return creditSelectOptions(activeUsers, id, people).find((o) => o.id === id)?.label ?? 'Unknown'
}
