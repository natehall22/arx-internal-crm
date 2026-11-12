import React from 'react'
import { fireEvent, render } from '@testing-library/react'
import SignaturePad from '@/components/contracts/SignaturePad'

class FakePointerEvent extends MouseEvent {
  pointerId: number
  pointerType: string
  constructor(type: string, init: any = {}) {
    super(type, { bubbles: true, cancelable: true, ...init })
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'touch'
  }
}

const RealImage = window.Image
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAA'
let ctx: Record<string, jest.Mock | unknown>
let toDataURL: jest.Mock
let captured: number[]
let released: number[]

beforeEach(() => {
  ;(window as any).PointerEvent = FakePointerEvent
  captured = []
  released = []
  ctx = {
    setTransform: jest.fn(), fillRect: jest.fn(), drawImage: jest.fn(), beginPath: jest.fn(),
    moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(),
  }
  toDataURL = jest.fn(() => PNG)
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as any)
  jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(toDataURL)
  jest.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 75, right: 200, bottom: 75, x: 0, y: 0, toJSON() {} } as DOMRect)
  ;(HTMLCanvasElement.prototype as any).setPointerCapture = (id: number) => { captured.push(id) }
  ;(HTMLCanvasElement.prototype as any).releasePointerCapture = (id: number) => { released.push(id) }
})
afterEach(() => { jest.restoreAllMocks(); ;(window as any).Image = RealImage; delete (window as any).devicePixelRatio })

const canvasOf = (c: HTMLElement) => c.querySelector('canvas') as HTMLCanvasElement

describe('SignaturePad pointer input + sharp backing store', () => {
  it('sizes the backing store to CSS size x devicePixelRatio, capped at 3', () => {
    ;(window as any).devicePixelRatio = 2.6
    let { container } = render(<SignaturePad onChange={() => {}} />)
    expect(canvasOf(container).width).toBe(Math.round(200 * 2.6))
    expect(canvasOf(container).height).toBe(Math.round((Math.round(200 * 2.6) * 150) / 400))
    ;(window as any).devicePixelRatio = 4
    ;({ container } = render(<SignaturePad onChange={() => {}} />))
    expect(canvasOf(container).width).toBe(600)
  })

  it('draws with pointer events, captures the pointer, and emits one PNG data URL on up', () => {
    const onChange = jest.fn()
    const { container } = render(<SignaturePad onChange={onChange} />)
    const c = canvasOf(container)
    fireEvent.pointerDown(c, { pointerId: 7, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(c, { pointerId: 7, clientX: 50, clientY: 30 })
    expect(captured).toEqual([7])
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 60) // 50/200*400, 30/75*150: logical 400x150 space
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerUp(c, { pointerId: 7 })
    expect(onChange).toHaveBeenCalledWith(PNG)
    expect(released).toEqual([7])
  })

  it('a cancelled pointer ends the stroke: nothing stays down, the next stroke works', () => {
    const onChange = jest.fn()
    const { container } = render(<SignaturePad onChange={onChange} />)
    const c = canvasOf(container)
    fireEvent.pointerDown(c, { pointerId: 1, clientX: 5, clientY: 5 })
    fireEvent.pointerMove(c, { pointerId: 1, clientX: 20, clientY: 20 })
    fireEvent.pointerCancel(c, { pointerId: 1 })
    expect(onChange).toHaveBeenCalledTimes(1)
    const lines = (ctx.lineTo as jest.Mock).mock.calls.length
    fireEvent.pointerMove(c, { pointerId: 1, clientX: 40, clientY: 40 }) // stray move after cancel draws nothing
    expect((ctx.lineTo as jest.Mock).mock.calls.length).toBe(lines)
    fireEvent.pointerDown(c, { pointerId: 2, clientX: 5, clientY: 5 })
    fireEvent.pointerMove(c, { pointerId: 2, clientX: 9, clientY: 9 })
    expect((ctx.lineTo as jest.Mock).mock.calls.length).toBe(lines + 1)
  })

  it('a tap with no movement is still "empty" (no signature emitted); ignores a second finger and disabled', () => {
    const onChange = jest.fn()
    const { container, rerender } = render(<SignaturePad onChange={onChange} />)
    const c = canvasOf(container)
    fireEvent.pointerDown(c, { pointerId: 1, clientX: 5, clientY: 5 })
    fireEvent.pointerUp(c, { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerDown(c, { pointerId: 1, clientX: 5, clientY: 5 })
    fireEvent.pointerDown(c, { pointerId: 2, clientX: 80, clientY: 5 })
    expect(ctx.moveTo).toHaveBeenCalledTimes(2) // the earlier tap + the first finger; the second finger is ignored
    fireEvent.pointerUp(c, { pointerId: 1 })
    rerender(<SignaturePad onChange={onChange} disabled />)
    const before = (ctx.moveTo as jest.Mock).mock.calls.length
    fireEvent.pointerDown(c, { pointerId: 3, clientX: 5, clientY: 5 })
    expect((ctx.moveTo as jest.Mock).mock.calls.length).toBe(before)
  })

  it('clear emits null and empties the pad', () => {
    const onChange = jest.fn()
    const { container, getByText } = render(<SignaturePad onChange={onChange} />)
    const c = canvasOf(container)
    fireEvent.pointerDown(c, { pointerId: 1, clientX: 5, clientY: 5 })
    fireEvent.pointerMove(c, { pointerId: 1, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(c, { pointerId: 1 })
    fireEvent.click(getByText('Clear signature'))
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(container.textContent).toContain('Sign here')
  })

  it('falls back to the 1x PNG when the sharp one is too big for the server limit', () => {
    toDataURL.mockReturnValueOnce('data:image/png;base64,' + 'A'.repeat(310_000)).mockReturnValue(PNG)
    const onChange = jest.fn()
    const { container } = render(<SignaturePad onChange={onChange} />)
    const c = canvasOf(container)
    fireEvent.pointerDown(c, { pointerId: 1, clientX: 5, clientY: 5 })
    fireEvent.pointerMove(c, { pointerId: 1, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(c, { pointerId: 1 })
    expect(onChange).toHaveBeenCalledWith(PNG)
  })

  it('keeps the drawn strokes when the on-screen size changes (copies the old bitmap, does not clear)', () => {
    ;(window as any).devicePixelRatio = 2
    let fire: () => void = () => {}
    ;(window as any).ResizeObserver = class { constructor(cb: () => void) { fire = cb } observe() {} disconnect() {} }
    const { container } = render(<SignaturePad onChange={() => {}} />)
    const c = canvasOf(container)
    expect(c.width).toBe(400)
    ;(ctx.drawImage as jest.Mock).mockClear()
    ;(HTMLCanvasElement.prototype.getBoundingClientRect as jest.Mock).mockReturnValue({ left: 0, top: 0, width: 300, height: 112, right: 300, bottom: 112, x: 0, y: 0, toJSON() {} })
    fire()
    expect(c.width).toBe(600)
    expect(ctx.drawImage).toHaveBeenCalledTimes(2) // old bitmap into the scratch canvas, then scratch back, scaled
    delete (window as any).ResizeObserver
  })

  it('does not wipe the canvas when the parent echoes back the value it just emitted (fast second stroke)', () => {
    const Controlled = () => {
      const [v, setV] = React.useState<string | null>(null)
      return <SignaturePad value={v} onChange={setV} />
    }
    const images: Array<{ onload?: () => void }> = []
    ;(window as any).Image = class { onload?: () => void; set src(_: string) { images.push(this) } }
    const { container } = render(<Controlled />)
    const c = canvasOf(container)
    fireEvent.pointerDown(c, { pointerId: 1, clientX: 5, clientY: 5 })
    fireEvent.pointerMove(c, { pointerId: 1, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(c, { pointerId: 1 }) // stroke 1 emits; parent echoes it back as value
    const fills = (ctx.fillRect as jest.Mock).mock.calls.length
    // stroke 2 begins before any image load could resolve
    fireEvent.pointerDown(c, { pointerId: 2, clientX: 30, clientY: 5 })
    fireEvent.pointerMove(c, { pointerId: 2, clientX: 31, clientY: 6 })
    fireEvent.pointerUp(c, { pointerId: 2 })
    expect((ctx.fillRect as jest.Mock).mock.calls.length).toBe(fills) // never cleared after the echo
    expect(images).toHaveLength(0) // no redraw of its own output
    expect(toDataURL).toHaveBeenCalledTimes(2) // both strokes exported from the same, uncleared canvas
  })

  it('a parent that empties the value resets the pad, so a tap cannot export a blank PNG', () => {
    const onChange = jest.fn()
    const { container, rerender } = render(<SignaturePad value={PNG} onChange={onChange} />)
    ;(window as any).Image = class { onload?: () => void; set src(_: string) { this.onload?.() } }
    rerender(<SignaturePad value={null} onChange={onChange} />)
    const c = canvasOf(container)
    fireEvent.pointerDown(c, { pointerId: 1, clientX: 5, clientY: 5 })
    fireEvent.pointerUp(c, { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Sign here')
  })
})
