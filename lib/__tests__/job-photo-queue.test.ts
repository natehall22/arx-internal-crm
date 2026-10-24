import { enqueuePhotos, flushPhotoQueue, memoryPhotoStore, MAX_ATTEMPTS, type UploadSteps } from '@/lib/job-photo-queue'

const file = (name: string) => Object.assign(new Blob(['x'], { type: 'image/jpeg' }), { name })
const steps = (over: Partial<UploadSteps> = {}): UploadSteps => ({
  register: async () => ({ photoId: 'p1', storagePath: 'a/b', bucket: 'files', signedUploadToken: 't' }),
  upload: async () => {},
  finalize: async () => ({ photo: { id: 'p1' } }),
  ...over,
})

describe('job photo queue', () => {
  it('saves first, uploads, and clears the queue', async () => {
    const store = memoryPhotoStore()
    await enqueuePhotos(store, [{ jobId: 'j', file: file('a.jpg'), tag: 'final_front', workOrderId: 'w1', filename: 'a.jpg' }])
    expect(await store.list()).toHaveLength(1)
    const seen: unknown[] = []
    const r = await flushPhotoQueue(store, steps({ finalize: async (_j, body) => { seen.push(body); return {} } }))
    expect(r).toMatchObject({ uploaded: 1, failed: 0, remaining: 0, offline: false })
    expect(seen[0]).toMatchObject({ photo_tag: 'final_front', work_order_id: 'w1', mime_type: 'image/jpeg' })
  })

  it('offline: nothing is lost, nothing counts as a failed attempt, and the next flush uploads it', async () => {
    const store = memoryPhotoStore()
    await enqueuePhotos(store, [{ jobId: 'j', file: file('a.jpg'), tag: null, workOrderId: null, filename: 'a.jpg' }, { jobId: 'j', file: file('b.jpg'), tag: null, workOrderId: null, filename: 'b.jpg' }])
    const down = await flushPhotoQueue(store, steps({ register: async () => { throw new TypeError('Failed to fetch') } }))
    expect(down).toMatchObject({ uploaded: 0, remaining: 2, offline: true })
    expect((await store.list()).every((q) => q.attempts === 0)).toBe(true)
    const up = await flushPhotoQueue(store, steps())
    expect(up).toMatchObject({ uploaded: 2, remaining: 0 })
  })

  it('a real server error counts an attempt and stops retrying after MAX_ATTEMPTS', async () => {
    const store = memoryPhotoStore()
    await enqueuePhotos(store, [{ jobId: 'j', file: file('a.jpg'), tag: null, workOrderId: null, filename: 'a.jpg' }])
    const bad = steps({ finalize: async () => { throw new Error('Upload not found in storage') } })
    for (let i = 0; i < MAX_ATTEMPTS; i++) await flushPhotoQueue(store, bad)
    const [q] = await store.list()
    expect(q.attempts).toBe(MAX_ATTEMPTS)
    expect(q.lastError).toMatch(/not found/)
    const after = await flushPhotoQueue(store, steps())
    expect(after).toMatchObject({ uploaded: 0, failed: 1, remaining: 1 }) // parked, not retried forever
  })

  it('only touches the job it is asked about', async () => {
    const store = memoryPhotoStore()
    await enqueuePhotos(store, [{ jobId: 'j1', file: file('a.jpg'), tag: null, workOrderId: null, filename: 'a.jpg' }, { jobId: 'j2', file: file('b.jpg'), tag: null, workOrderId: null, filename: 'b.jpg' }])
    const r = await flushPhotoQueue(store, steps(), { jobId: 'j1' })
    expect(r.uploaded).toBe(1)
    expect((await store.list()).map((q) => q.jobId)).toEqual(['j2'])
  })
})

describe('resume and stuck photos', () => {
  it('reuses the registered upload on a retry instead of registering a second photo', async () => {
    const store = memoryPhotoStore()
    await enqueuePhotos(store, [{ jobId: 'j', file: new Blob(['x']), tag: null, workOrderId: null, filename: 'a.jpg' }])
    let registers = 0
    let finalizeFails = true
    const steps = {
      register: async () => { registers++; return { photoId: 'p1', storagePath: 'x', bucket: 'b', signedUploadToken: 't' } },
      upload: async () => undefined,
      finalize: async () => { if (finalizeFails) throw new TypeError('Failed to fetch'); return {} },
    }
    await flushPhotoQueue(store, steps, { jobId: 'j' })
    finalizeFails = false
    const r = await flushPhotoQueue(store, steps, { jobId: 'j' })
    expect(registers).toBe(1)
    expect(r.uploaded).toBe(1)
  })
})
