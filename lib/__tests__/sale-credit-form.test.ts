import { creditPersonLabel, creditSelectOptions, saleCreditFormProblem, setSelfGenerated, SELF_GEN_SETTER_PROBLEM } from '@/lib/sale-credit-form'

const users = [
  { id: 'nathan', full_name: 'Nathan Hall' },
  { id: 'sam', full_name: 'Sam Setter' },
]

describe('sale credit form', () => {
  it('self-generated with a different stored setter is a real conflict, and the form can see it', () => {
    expect(saleCreditFormProblem({ closerUserId: 'nathan', setterUserId: 'gone', isSelfGenerated: true })).toBe(SELF_GEN_SETTER_PROBLEM)
  })

  it('no setter, or the closer as setter, passes when self-generated', () => {
    expect(saleCreditFormProblem({ closerUserId: 'nathan', setterUserId: '', isSelfGenerated: true })).toBeNull()
    expect(saleCreditFormProblem({ closerUserId: 'nathan', setterUserId: 'nathan', isSelfGenerated: true })).toBeNull()
    expect(saleCreditFormProblem({ closerUserId: 'nathan', setterUserId: 'sam', isSelfGenerated: false })).toBeNull()
  })

  it('a closer is required', () => {
    expect(saleCreditFormProblem({ closerUserId: '', setterUserId: '', isSelfGenerated: false })).toBe('Pick who closed this sale')
  })

  it('ticking self-generated clears the hidden setter; unticking leaves it empty', () => {
    const ticked = setSelfGenerated({ closerUserId: 'nathan', setterUserId: 'gone', isSelfGenerated: false }, true)
    expect(ticked).toEqual({ closerUserId: 'nathan', setterUserId: '', isSelfGenerated: true })
    expect(saleCreditFormProblem(ticked)).toBeNull()
    expect(setSelfGenerated(ticked, false).setterUserId).toBe('')
  })

  it('a stored setter who is not in the active list is shown by name with (inactive), never as "No setter"', () => {
    const people = [{ id: 'gone', name: 'Dana Departed', active: false }]
    expect(creditSelectOptions(users, 'gone', people)).toEqual([
      { id: 'nathan', label: 'Nathan Hall' },
      { id: 'sam', label: 'Sam Setter' },
      { id: 'gone', label: 'Dana Departed (inactive)' },
    ])
    expect(creditPersonLabel(users, 'gone', people)).toBe('Dana Departed (inactive)')
  })

  it('an unknown stored id still shows an option; active users add nothing extra', () => {
    expect(creditSelectOptions(users, 'ghost', []).at(-1)).toEqual({ id: 'ghost', label: 'Unknown user (inactive)' })
    expect(creditSelectOptions(users, 'sam', [])).toHaveLength(2)
    expect(creditSelectOptions(users, '', [])).toHaveLength(2)
    expect(creditPersonLabel(users, '', [])).toBe('None')
  })
})
