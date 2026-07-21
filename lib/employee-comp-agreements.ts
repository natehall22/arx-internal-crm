export type EmployeeAgreementKey = 'field_marketer' | 'senior_field_marketer' | 'closer'
export type AgreementSection = { heading: string; paragraphs?: string[]; bullets?: string[] }
export type EmployeeAgreementTemplate = { key: EmployeeAgreementKey; version: string; title: string; roleName: string; summary: string; sections: AgreementSection[] }

const VERSION = '2026-07-20.2'

const fmOpening = (role: string): AgreementSection[] => [
  { heading: '1. Role & Expectations', paragraphs: [`The ${role} is engaged as a 1099 independent worker to perform lead generation and appointment setting in the Company’s roofing and home-services division.`, 'Expected daily performance:', 'Responsibilities include communicating professionally with homeowners, collecting required job information, entering appointments into the Company CRM, arriving on time to assigned field areas, and attending all team meetings and trainings.'], bullets: ['Set a minimum of two (2) new roofing appointments per day; or', 'Knock a minimum of eighty (80) doors per day to generate same-day or next-day inspection opportunities.'] },
  { heading: '2. Independent Work Classification', paragraphs: [`This is a 1099 independent role. No salary or hourly wage is provided. Earnings come only from compensation earned under Section 5 on jobs attributed to the ${role}. The ${role} is responsible for taxes, transportation, and business expenses.`] },
  { heading: '3. Eligibility Requirements', paragraphs: [`The ${role} must have a valid driver’s license or reliable transportation, attend team meetings, follow Company rules, and be legally authorized to work in the United States.`] },
  { heading: '4. Uniforms & Brand Standards', paragraphs: ['The Company will provide uniforms to be worn in the field. Uniforms remain Company property.'] },
]

const fmTail = (role: string): AgreementSection[] => [
  { heading: '6. Performance Standards', paragraphs: [`The ${role} must participate in meetings, trainings, and coaching sessions. Failure to meet expectations may result in removal.`] },
  { heading: '7. Territory', paragraphs: ['Territories are assigned at Company discretion and are not guaranteed.'] },
  { heading: '8. Professional Conduct', paragraphs: [`The ${role} agrees to follow Company compliance rules, avoid misrepresentation, and maintain professional behavior.`] },
  { heading: '9. Confidentiality', paragraphs: ['All customer data, pricing, training materials, compensation structures, and internal systems are Company property and may not be shared.'] },
  { heading: '10. Post-Departure Limitations & Active-Engagement Restrictions', paragraphs: [`While actively engaged with the Company, the ${role} shall not perform roofing-related sales, canvassing, inspections, appointment setting, or lead-generation services for another roofing or exterior-services company.`, `For six (6) months after ending work with the Company, the ${role} agrees not to:`], bullets: ['Recruit Company personnel.', 'Use Company leads or data.', 'Represent affiliation with the Company.', 'Contact Company-generated homeowners for competing services.'] },
]

const governingLaw: AgreementSection = { heading: '12. Governing Law', paragraphs: ['This Agreement is governed by North Carolina law.'] }

export const EMPLOYEE_AGREEMENT_TEMPLATES: Record<EmployeeAgreementKey, EmployeeAgreementTemplate> = {
  field_marketer: {
    key: 'field_marketer', version: VERSION, title: 'Independent Field Marketer Agreement', roleName: 'Field Marketer',
    summary: 'Whichever is greater: eligible $500 weekly performance pay or 3% of attributed commissionable sale value.',
    sections: [...fmOpening('Field Marketer'),
      { heading: '5. Compensation Structure', paragraphs: ['The Field Marketer receives whichever is greater for each payroll cycle: eligible $500 weekly performance pay or 3% of attributed commissionable sale value becoming payable in that payroll cycle. The two amounts are not added together.', 'Each pay period runs Monday through Sunday and is paid the following Friday. The $500 weekly performance pay is eligible only when the Company’s documented weekly performance requirements for that Monday-through-Sunday period are completed and verified.', 'Commission is earned only when a job is sold, installed, fully paid, and verified as attributed to the Field Marketer. For a financed installed sale to be included in Friday payroll, the funds must reach the Company’s bank account no later than 11:59:59 p.m. Eastern Time on Wednesday of that payroll week. A job funded after the Wednesday cutoff becomes payable in the first later payroll cycle in which all requirements are satisfied.', 'Attribution and completed performance requirements are determined from the Company’s verified CRM records. Commissionable sale value means the contract value recorded in the CRM after applicable cancellations, insurance denials, reductions, chargebacks, or other documented adjustments.'] },
      ...fmTail('Field Marketer'),
      { heading: '11. Term & Termination', paragraphs: ['This Agreement is at-will. Upon separation, the Field Marketer is paid only for compensation earned under Section 5 on jobs sold before separation and subsequently installed, fully paid, and verified as attributed to the Field Marketer. Weekly performance pay is owed only for completed, verified workweeks before separation.'] }, governingLaw],
  },
  senior_field_marketer: {
    key: 'senior_field_marketer', version: VERSION, title: 'Independent Senior Field Marketer Agreement', roleName: 'Senior Field Marketer',
    summary: '6% of attributed commissionable sale value, plus 1% on verified personally inspected attributed sold jobs (7% total). No weekly floor.',
    sections: [...fmOpening('Senior Field Marketer'),
      { heading: '5. Compensation Structure', paragraphs: ['The Senior Field Marketer earns a flat 6% commission on all attributed commissionable sale value. On attributed sold jobs personally inspected by the Senior Field Marketer, an additional 1% of attributed commissionable sale value applies, for a total 7% commission on those jobs. No weekly performance pay or weekly floor applies.', 'Commissions are earned only when a job is sold, installed, fully paid, and verified as attributed to the Senior Field Marketer. The additional 1% applies only when the personally completed inspection is verified. Chargebacks may apply for cancellations, insurance denials, reductions, or misrepresentation.', 'Attribution and personally completed inspections are determined from the Company’s verified CRM records. Commissionable sale value means the contract value recorded in the CRM after applicable cancellations, insurance denials, reductions, chargebacks, or other documented adjustments.'] },
      ...fmTail('Senior Field Marketer'),
      { heading: '11. Term & Termination', paragraphs: ['This Agreement is at-will. Upon separation, the Senior Field Marketer is paid only for commissions earned under Section 5 on jobs sold before separation and subsequently installed, fully paid, and verified as attributed to the Senior Field Marketer. This includes the additional inspection commission when the personally completed inspection is verified.'] }, governingLaw],
  },
  closer: {
    key: 'closer', version: VERSION, title: 'Independent Sales Representative (Closer) Agreement', roleName: 'Sales Representative',
    summary: '6% base, plus 6% on self-generated sales, plus 1% on inspected roofs that buy. No monthly bonus.',
    sections: [
      { heading: '1. Role & Expectations', paragraphs: ['The Sales Representative is engaged as an independent 1099 sales professional responsible for conducting roofing inspections, presenting solutions, closing deals, prospecting for new clients, maintaining CRM records, attending meetings, and representing the Company professionally.'] },
      { heading: '2. Independent Work Classification', paragraphs: ['This is a 1099 commission-only role. No salary or hourly wage is provided. Earnings come solely from commissions under Section 5 on sold, installed, fully paid Company projects attributed to the Sales Representative. The Sales Representative is responsible for taxes, transportation, and business expenses. The Company sets performance expectations but not daily methods or hours. This Agreement does not create an employer-employee relationship.'] },
      { heading: '3. Eligibility Requirements', paragraphs: ['The Sales Representative must have a valid driver’s license or reliable transportation, be legally authorized to work in the United States, attend trainings, and wear Company uniforms.'] },
      { heading: '4. Uniforms & Brand Standards', paragraphs: ['Company-provided uniforms must be worn as required and remain Company property.'] },
      { heading: '5. Compensation Structure', paragraphs: ['The Sales Representative earns 6% on all attributed closed revenue, plus an additional 6% on attributed self-generated sales, for a total 12% on those sales. On attributed sold jobs personally inspected by the Sales Representative, an additional 1% of attributed closed revenue applies. When the same job is both self-generated and personally inspected, all three amounts stack for a total 13% commission. There is no monthly bonus.', 'Commissions are earned only when a job is sold, installed, fully paid, and verified as attributed to the Sales Representative. Self-generation and personally completed inspections must be verified in the Company CRM. Commissions are paid in the pay cycle following installation and full funding.', 'Attributed closed revenue means the contract value recorded in the CRM after applicable cancellations, insurance denials, reductions, chargebacks, or other documented adjustments.'] },
      { heading: '6. Performance Standards', paragraphs: ['The Sales Representative must run assigned appointments, prospect daily, maintain CRM discipline, attend trainings, and uphold professionalism. The minimum closing rate on Company-provided leads is 30%. If the closing rate remains below 30% for three consecutive weeks, the Sales Representative will be moved to self-generated-only appointments.'] },
      { heading: '7. Territory', paragraphs: ['Territory assignments are at Company discretion and are not guaranteed.'] },
      { heading: '8. Professional Conduct', paragraphs: ['No insurance promises, deductible manipulation, or misrepresentation is permitted. The Sales Representative must follow North Carolina law and Company policies.'] },
      { heading: '9. Confidentiality', paragraphs: ['All customer data, pricing, training materials, compensation structures, and internal systems are Company property and confidential.'] },
      { heading: '10. Competitive Boundaries & Non-Solicitation', paragraphs: ['While active, the Sales Representative may not perform roofing sales for competing companies. For six (6) months after departure, the Sales Representative may not:'], bullets: ['Recruit Company personnel.', 'Use Company leads or data.', 'Represent affiliation with the Company.', 'Contact Company-generated homeowners for competing services.'] },
      { heading: '11. Term & Termination', paragraphs: ['This Agreement is at-will. Upon termination, the Sales Representative is paid only for commissions earned under Section 5 on jobs sold before termination and subsequently installed, fully paid, and verified as attributed to the Sales Representative.'] }, governingLaw],
  },
}

export function isEmployeeAgreementKey(value: unknown): value is EmployeeAgreementKey { return typeof value === 'string' && value in EMPLOYEE_AGREEMENT_TEMPLATES }
