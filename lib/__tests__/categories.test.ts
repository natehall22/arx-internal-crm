import {
  CATEGORY_LABEL_MAX,
  DEFAULT_CATEGORIES,
  MAX_CATEGORIES,
  activeCategories,
  applyCategoryChange,
  categoryLabel,
  effectiveCategory,
  readCategories,
  resolveCategoryChoice,
  type Category,
} from '@/lib/categories'

const defaults = () => DEFAULT_CATEGORIES.map((c) => ({ ...c }))
const ok = (r: ReturnType<typeof applyCategoryChange>) => {
  if (!r.ok) throw new Error(r.error)
  return r.list
}

describe('effectiveCategory — the one answer (job override, else customer, else not set)', () => {
  it('job override wins over the customer', () => {
    expect(effectiveCategory('new_build', 'residential')).toEqual({ slug: 'new_build', source: 'job' })
  })
  it('falls back to the customer when the job has none', () => {
    expect(effectiveCategory(null, 'commercial')).toEqual({ slug: 'commercial', source: 'customer' })
    expect(effectiveCategory('', 'commercial')).toEqual({ slug: 'commercial', source: 'customer' })
  })
  it('blank on both is "not set", never a default category', () => {
    expect(effectiveCategory(null, null)).toEqual({ slug: null, source: null })
    expect(effectiveCategory(undefined, '  ')).toEqual({ slug: null, source: null })
  })
  it('a job with no customer still has its own category', () => {
    expect(effectiveCategory('commercial', undefined).slug).toBe('commercial')
  })
})

describe('the default list', () => {
  it('has the three standard categories with stable slugs', () => {
    expect(DEFAULT_CATEGORIES.map((c) => c.slug)).toEqual(['residential', 'commercial', 'new_build'])
    expect(DEFAULT_CATEGORIES.map((c) => c.label)).toEqual(['Residential', 'Commercial', 'New build'])
  })
  it('a company that never saved reads the defaults; unreadable data does too', () => {
    expect(readCategories(undefined)).toEqual({ list: defaults(), saved: false })
    expect(readCategories({ categories: { items: 'nope' } }).saved).toBe(false)
  })
  it('reads a saved list, drops junk rows and duplicate slugs, keeps order', () => {
    const { list, saved } = readCategories({
      categories: { items: [{ slug: 'b', label: 'B', sort: 20, active: true }, { slug: 'a', label: 'A', sort: 10, active: false }, { slug: 'a', label: 'dup', sort: 1 }, { slug: 'Bad Slug', label: 'x' }, { slug: 'c', label: '' }, null] },
    })
    expect(saved).toBe(true)
    expect(list.map((c) => [c.slug, c.active])).toEqual([['a', false], ['b', true]])
  })
})

describe('categoryLabel', () => {
  it('uses the company label, then a readable slug, and is empty for blank', () => {
    expect(categoryLabel('commercial', [{ slug: 'commercial', label: 'Business' }])).toBe('Business')
    expect(categoryLabel('lawn_care', [])).toBe('Lawn care')
    expect(categoryLabel(null)).toBe('')
  })
})

describe('resolveCategoryChoice', () => {
  const list = [{ slug: 'residential', active: true }, { slug: 'old', active: false }]
  it('blank clears', () => {
    expect(resolveCategoryChoice(list, null)).toEqual({ ok: true, slug: null })
    expect(resolveCategoryChoice(list, '')).toEqual({ ok: true, slug: null })
  })
  it('accepts an active slug, refuses unknown, off and non-string', () => {
    expect(resolveCategoryChoice(list, 'residential')).toEqual({ ok: true, slug: 'residential' })
    expect(resolveCategoryChoice(list, 'nope').ok).toBe(false)
    expect(resolveCategoryChoice(list, 'old').ok).toBe(false)
    expect(resolveCategoryChoice(list, 5).ok).toBe(false)
  })
  it('a row may keep a category that was turned off since (but nobody can newly pick it)', () => {
    expect(resolveCategoryChoice(list, 'old', 'old')).toEqual({ ok: true, slug: 'old' })
  })
})

describe('applyCategoryChange', () => {
  it('adds a category with a new stable slug at the end', () => {
    const list = ok(applyCategoryChange(defaults(), { action: 'add', label: '  Multi   family ' }))
    expect(list.map((c) => c.slug)).toEqual(['residential', 'commercial', 'new_build', 'multi_family'])
    expect(list[3]).toMatchObject({ label: 'Multi family', active: true })
  })
  it('refuses a duplicate name (any case, also a turned-off one), a blank name and a too-long name', () => {
    const withOff = ok(applyCategoryChange(defaults(), { action: 'setActive', slug: 'commercial', active: false }))
    expect(applyCategoryChange(withOff, { action: 'add', label: 'commercial' })).toMatchObject({ ok: false, status: 409 })
    expect(applyCategoryChange(defaults(), { action: 'add', label: 'RESIDENTIAL' })).toMatchObject({ ok: false, status: 409 })
    expect(applyCategoryChange(defaults(), { action: 'add', label: '   ' })).toMatchObject({ ok: false, status: 400 })
    expect(applyCategoryChange(defaults(), { action: 'add', label: 'x'.repeat(CATEGORY_LABEL_MAX + 1) })).toMatchObject({ ok: false, status: 400 })
    expect(applyCategoryChange(defaults(), { action: 'add', label: '!!!' })).toMatchObject({ ok: false, status: 400 })
  })
  it('two labels that make the same slug get distinct slugs', () => {
    let list: Category[] = defaults()
    list = ok(applyCategoryChange(list, { action: 'add', label: 'Re-sale' }))
    list = ok(applyCategoryChange(list, { action: 'add', label: 'Re sale' }))
    const slugs = list.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
  it('caps the list', () => {
    let list: Category[] = defaults()
    for (let i = list.length; i < MAX_CATEGORIES; i++) list = ok(applyCategoryChange(list, { action: 'add', label: `Type ${i}` }))
    expect(applyCategoryChange(list, { action: 'add', label: 'One too many' })).toMatchObject({ ok: false, status: 400 })
  })
  it('rename changes the label and never the slug; refuses another category’s name', () => {
    const list = ok(applyCategoryChange(defaults(), { action: 'rename', slug: 'commercial', label: 'Business' }))
    expect(list.find((c) => c.slug === 'commercial')?.label).toBe('Business')
    expect(applyCategoryChange(defaults(), { action: 'rename', slug: 'commercial', label: 'residential' })).toMatchObject({ ok: false, status: 409 })
    expect(applyCategoryChange(defaults(), { action: 'rename', slug: 'ghost', label: 'X' })).toMatchObject({ ok: false, status: 404 })
    // renaming to its own name (a case change) is fine
    expect(applyCategoryChange(defaults(), { action: 'rename', slug: 'commercial', label: 'COMMERCIAL' }).ok).toBe(true)
  })
  it('turning off keeps the row (never a delete) and can be turned back on; even the last one can be off', () => {
    let list = defaults()
    for (const c of defaults()) list = ok(applyCategoryChange(list, { action: 'setActive', slug: c.slug, active: false }))
    expect(list).toHaveLength(3)
    expect(activeCategories(list)).toHaveLength(0)
    list = ok(applyCategoryChange(list, { action: 'setActive', slug: 'residential', active: true }))
    expect(activeCategories(list).map((c) => c.slug)).toEqual(['residential'])
    expect(applyCategoryChange(list, { action: 'setActive', slug: 'residential', active: 'yes' })).toMatchObject({ ok: false, status: 400 })
  })
  it('reorder needs every slug exactly once', () => {
    const list = ok(applyCategoryChange(defaults(), { action: 'reorder', order: ['new_build', 'residential', 'commercial'] }))
    expect(list.map((c) => c.slug)).toEqual(['new_build', 'residential', 'commercial'])
    expect(applyCategoryChange(defaults(), { action: 'reorder', order: ['residential'] })).toMatchObject({ ok: false, status: 400 })
    expect(applyCategoryChange(defaults(), { action: 'reorder', order: ['residential', 'residential', 'commercial'] })).toMatchObject({ ok: false, status: 400 })
  })
  it('does not change the list it was given', () => {
    const before = defaults()
    applyCategoryChange(before, { action: 'rename', slug: 'commercial', label: 'Business' })
    expect(before).toEqual(defaults())
  })
})
