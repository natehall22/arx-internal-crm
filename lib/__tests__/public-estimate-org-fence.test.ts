/** @jest-environment node */
/** The website estimate's company is always explicit and, on a fenced copy, must be that copy's own company. */
import * as config from '@/lib/public-estimate-config'

const ENV = { ...process.env }
beforeEach(() => { process.env = { ...ENV }; delete process.env.PUBLIC_ESTIMATE_ORG_ID; delete process.env.DEPLOYMENT_ORG_ID })
afterAll(() => { process.env = ENV })

test('no built-in company id: unset env throws (callers answer "misconfigured")', () => {
  expect(() => config.getPublicEstimateOrgId()).toThrow('PUBLIC_ESTIMATE_ORG_ID must be set')
  expect('PUBLIC_ESTIMATE_ORG_ID' in config).toBe(false) // the old exported constant with a hardcoded fallback is gone
})

test('set and unfenced → that id', () => {
  process.env.PUBLIC_ESTIMATE_ORG_ID = ' org-a '
  expect(config.getPublicEstimateOrgId()).toBe('org-a')
})

test('fenced copy: must match DEPLOYMENT_ORG_ID (a copied env cannot write another company\'s leads)', () => {
  process.env.PUBLIC_ESTIMATE_ORG_ID = 'org-a'
  process.env.DEPLOYMENT_ORG_ID = 'org-b'
  expect(() => config.getPublicEstimateOrgId()).toThrow('does not match DEPLOYMENT_ORG_ID')
  process.env.DEPLOYMENT_ORG_ID = 'org-a'
  expect(config.getPublicEstimateOrgId()).toBe('org-a')
})
