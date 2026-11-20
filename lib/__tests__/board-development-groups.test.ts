import { groupColumnByDevelopment } from '@/lib/development-board'

type J = { id: string; development?: { name: string; key: string; lot: string | null } | null; customer?: { id: string; name: string } | null }
const lot = (id: string, dev: string | null, builder = 'b1'): J => ({
  id,
  development: dev ? { name: dev, key: dev.toLowerCase(), lot: id } : null,
  customer: { id: builder, name: `Builder ${builder}` },
})

describe('Job Board: one card per development', () => {
  it('jobs not on a lot (every roofing job) come back one by one, same order', () => {
    const jobs = [lot('a', null), lot('b', null), lot('c', null)]
    expect(groupColumnByDevelopment(jobs)).toEqual(jobs.map((job) => ({ kind: 'job', job })))
  })

  it("two or more of a builder's lots in one development become one entry, placed where the first one sorts", () => {
    const out = groupColumnByDevelopment([lot('x', null), lot('1', 'Oak Ridge'), lot('y', null), lot('2', 'Oak Ridge'), lot('3', 'Oak Ridge')])
    expect(out.map((e) => (e.kind === 'job' ? e.job.id : `${e.name}:${e.jobs.map((j) => j.id).join(',')}`))).toEqual(['x', 'Oak Ridge:1,2,3', 'y'])
  })

  it('a single lot stays a normal card; two builders in one development stay apart', () => {
    const out = groupColumnByDevelopment([lot('1', 'Oak Ridge'), lot('2', 'Pine', 'b1'), lot('3', 'Pine', 'b2'), lot('4', 'Pine', 'b2')])
    expect(out.map((e) => (e.kind === 'job' ? e.job.id : `${e.builder}:${e.jobs.length}`))).toEqual(['1', '2', 'Builder b2:2'])
  })
})
