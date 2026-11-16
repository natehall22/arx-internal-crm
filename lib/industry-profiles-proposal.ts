/**
 * Proposal PDF wording each industry profile starts from (pure data, client-safe, no imports). Read through ONE reader,
 * `resolveProposalContent` (lib/proposal-content.ts); a company's own edits (`orgs.settings.proposalContent`) win.
 *
 * `roofing` equals the words the PDF printed before this was editable, character for character (test-locked in
 * lib/__tests__/proposal-content.test.ts) — the original company's PDF does not change until it edits something.
 * `{company}` in a text is replaced with the company's short name when the PDF is drawn.
 */
export type ProposalContentItem = { title: string; body: string }

export type ProposalContentDefaults = {
  coverSubtitle: string
  processTitle: string
  processSubtitle: string
  processSteps: readonly ProposalContentItem[]
  whyUsTitle: string
  whyUsItems: readonly ProposalContentItem[]
  /** Under "Project Details" when the proposal has no roof measurement (with one it always names the measurements). */
  detailsSubtitle: string
}

const WHY_US_TITLE = 'Why Homeowners Choose {company}'

export const ROOFING_PROPOSAL_CONTENT: ProposalContentDefaults = {
  coverSubtitle: 'Professional Roofing Services',
  processTitle: 'The Process',
  processSubtitle: 'Your roof replacement from start to finish',
  processSteps: [
    { title: 'Initial Consultation', body: 'We assess your roof, discuss your needs, and provide a detailed proposal.' },
    { title: 'Material Selection', body: 'Choose from premium roofing materials that fit your style and budget.' },
    { title: 'Project Scheduling', body: 'We coordinate a convenient installation date that works for you.' },
    { title: 'Professional Installation', body: 'Our certified crew completes your roof with precision and care.' },
    { title: 'Quality Inspection', body: 'We perform a thorough walkthrough to ensure everything meets our standards.' },
    { title: 'Final Cleanup & Warranty', body: 'We leave your property clean and provide all warranty documentation.' },
  ],
  whyUsTitle: WHY_US_TITLE,
  whyUsItems: [
    { title: 'Local & Long-Term', body: 'We are Charlotte-based and committed to serving our community for years to come.' },
    { title: 'Complete Roofing Systems', body: 'We install full roofing systems—not patchwork fixes—built for long-term performance.' },
    { title: 'Clear Communication', body: 'Every project is documented with photos and written scopes. You always know what to expect.' },
    { title: 'Professional Process', body: 'Clean job sites, final walkthroughs, and a step-by-step approach from start to finish.' },
    { title: 'Insurance Guidance', body: 'Filing a claim? We help you through the process without overpromising outcomes.' },
  ],
  detailsSubtitle: 'Property information and roof measurements',
}

/** Neutral text for a profile that defines none. */
export const GENERIC_PROPOSAL_CONTENT: ProposalContentDefaults = {
  coverSubtitle: 'Professional Services',
  processTitle: 'The Process',
  processSubtitle: 'Your project from start to finish',
  processSteps: [
    { title: 'Initial Consultation', body: 'We review your property, discuss your needs, and provide a detailed quote.' },
    { title: 'Choose Your Options', body: 'Pick the services and extras that fit your needs and budget.' },
    { title: 'Scheduling', body: 'We coordinate a convenient date that works for you.' },
    { title: 'Professional Service', body: 'Our crew completes the work with precision and care.' },
    { title: 'Quality Check', body: 'We walk through the finished work to make sure it meets our standards.' },
    { title: 'Cleanup & Follow-Up', body: 'We leave your property clean and make sure you are satisfied.' },
  ],
  whyUsTitle: WHY_US_TITLE,
  whyUsItems: [
    { title: 'Local & Long-Term', body: 'We are locally based and committed to serving our community for years to come.' },
    { title: 'Clear Communication', body: 'You always know what to expect, what it costs, and when we are coming.' },
    { title: 'Professional Process', body: 'Clean job sites, final walkthroughs, and a step-by-step approach from start to finish.' },
  ],
  detailsSubtitle: 'Property information and project details',
}

export const LAWN_LANDSCAPE_PROPOSAL_CONTENT: ProposalContentDefaults = {
  ...GENERIC_PROPOSAL_CONTENT,
  coverSubtitle: 'Professional Lawn & Landscape Services',
  processSubtitle: 'Your property care from start to finish',
  processSteps: [
    { title: 'Property Walk-Through', body: 'We look over your property, talk through what you want, and give you a clear quote.' },
    { title: 'Choose Your Services', body: 'Pick the services and extras that fit your yard and your budget.' },
    { title: 'Scheduling', body: 'We set a service day that works for you and keep you posted.' },
    { title: 'Professional Service', body: 'Our crew does the work with the right equipment and a careful eye.' },
    { title: 'Quality Check', body: 'We walk the finished work to make sure it meets our standards.' },
    { title: 'Cleanup & Follow-Up', body: 'We leave your property tidy and check in to make sure you are happy.' },
  ],
  whyUsItems: [
    { title: 'Local & Long-Term', body: 'We are locally based and committed to caring for our neighbors’ properties for years to come.' },
    { title: 'Complete Property Care', body: 'From routine maintenance to bigger landscape projects, one crew handles it.' },
    { title: 'Clear Communication', body: 'You always know what to expect, what it costs, and when we are coming.' },
    { title: 'Reliable Scheduling', body: 'We show up when we say we will and tell you if anything changes.' },
  ],
}

export const EXTERIOR_CLEANING_PROPOSAL_CONTENT: ProposalContentDefaults = {
  ...GENERIC_PROPOSAL_CONTENT,
  coverSubtitle: 'Professional Exterior Cleaning Services',
  processSubtitle: 'Your cleaning from start to finish',
  processSteps: [
    { title: 'Property Review', body: 'We look over the surfaces to be cleaned and give you a clear quote.' },
    { title: 'Choose Your Services', body: 'Pick the surfaces and extras that fit your needs and budget.' },
    { title: 'Scheduling', body: 'We set a service day that works for you and keep you posted.' },
    { title: 'Careful Cleaning', body: 'We use the right method and pressure for each surface, and protect landscaping and fixtures.' },
    { title: 'Quality Check', body: 'We walk the finished work with you to make sure it meets our standards.' },
    { title: 'Cleanup & Follow-Up', body: 'We leave your property tidy and check in to make sure you are happy.' },
  ],
  whyUsItems: [
    { title: 'Local & Long-Term', body: 'We are locally based and committed to serving our community for years to come.' },
    { title: 'Safe, Proven Methods', body: 'The right cleaning method for each surface, so you get results without damage.' },
    { title: 'Clear Communication', body: 'You always know what to expect, what it costs, and when we are coming.' },
    { title: 'Repeat Service Made Easy', body: 'Keep your property looking its best with regular visits on a schedule that suits you.' },
  ],
}

export const HOME_BUILDER_PROPOSAL_CONTENT: ProposalContentDefaults = {
  ...GENERIC_PROPOSAL_CONTENT,
  coverSubtitle: 'Professional Building Services',
  processSubtitle: 'Your build from start to finish',
  processSteps: [
    { title: 'Initial Consultation', body: 'We review your plans and goals, then provide a detailed bid.' },
    { title: 'Selections', body: 'Choose the materials and finishes that fit your style and budget.' },
    { title: 'Scheduling', body: 'We coordinate each trade so the work flows in the right order.' },
    { title: 'Construction', body: 'Our trade partners build with precision and care, with regular updates from us.' },
    { title: 'Quality Inspection', body: 'We walk the finished work with you to make sure it meets our standards.' },
    { title: 'Final Cleanup & Warranty', body: 'We leave the site clean and provide all warranty documentation.' },
  ],
  whyUsItems: [
    { title: 'Local & Long-Term', body: 'We are locally based and committed to serving our community for years to come.' },
    { title: 'One Point of Contact', body: 'We manage every trade, so you deal with one team from start to finish.' },
    { title: 'Clear Communication', body: 'Every project is documented with photos and written scopes. You always know what to expect.' },
    { title: 'Professional Process', body: 'Clean job sites, final walkthroughs, and a step-by-step approach from start to finish.' },
  ],
}
