/** @jest-environment node */
/** The legacy job-files bucket is read/written with the service client (202611240050): only the caller's company folder. */
import { jobFilesKeyInOrg } from '@/lib/files/storage'

test.each([
  ['orgs/org-a/jobs/j1/contract.pdf', true],
  ['orgs/org-b/jobs/j1/contract.pdf', false],
  ['orgs/org-a/', false],
  ['orgs/org-a', false],
  ['orgs/org-a/../org-b/x.pdf', false],
  ['org/org-a/jobs/x.pdf', false],
  ['orgs/org-ab/jobs/x.pdf', false],
  [null, false],
  [42, false],
])('%s -> %s', (key, ok) => {
  expect(jobFilesKeyInOrg(key, 'org-a')).toBe(ok)
})

test('an empty company id never matches', () => {
  expect(jobFilesKeyInOrg('orgs//x.pdf', '')).toBe(false)
})
