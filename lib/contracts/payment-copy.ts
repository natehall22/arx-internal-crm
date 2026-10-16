/**
 * The plain-language payment notes on the Order Form, signing page and review step — one home so
 * the PDF, the page the customer signs on and the rep's preview can't drift. They restate Terms
 * §2.1 / §5.2 / §11; the binding wording lives in the Terms (including the Substantial Completion
 * definition in §2.3). Tone is deliberately calm: insurance is covering the scope, so no scary copy.
 */

export function computeBalanceDue(projectCost?: number | null, depositAmount?: number | null): number {
  return Math.max(0, Math.round(((Number(projectCost) || 0) - (Number(depositAmount) || 0)) * 100) / 100)
}

export const BALANCE_DUE_PLAIN =
  'The balance is due when the work is substantially complete, or when your insurance carrier approves the completed scope, whichever comes first. It does not wait on insurance payments.'

export const SUBSTANTIAL_COMPLETION_PLAIN =
  '"Substantially complete" means the work listed above is installed and doing its job (for a roof, it is on and protecting your home), even if small touch-ups or final cleanup remain. Those small items do not delay the balance, and we will finish them.'

export const CHANGE_ORDERS_PLAIN =
  'Any signed change orders are due with this final payment unless the change order says otherwise.'

export const INSURANCE_SCOPE_PLAIN =
  'Working with your insurance: your carrier decides what is covered, and the approved scope can change as the job goes on, for example if hidden damage is found or the carrier approves a supplement. We handle that with your carrier for you. Any change to the work is put in writing first, so there are no surprises.'

export function financeBalancePlain(financeCompany?: string | null): string | null {
  const lender = financeCompany?.trim()
  return lender ? `Your balance is paid through your ${lender} financing when the work is complete.` : null
}

export function paymentNotes(args: { paymentMethod?: string | null; financeCompany?: string | null }): string[] {
  const notes = [BALANCE_DUE_PLAIN, SUBSTANTIAL_COMPLETION_PLAIN]
  if (args.paymentMethod === 'finance') {
    const finance = financeBalancePlain(args.financeCompany)
    if (finance) notes.push(finance)
  }
  notes.push(CHANGE_ORDERS_PLAIN)
  if (args.paymentMethod === 'insurance') notes.push(INSURANCE_SCOPE_PLAIN)
  return notes
}
