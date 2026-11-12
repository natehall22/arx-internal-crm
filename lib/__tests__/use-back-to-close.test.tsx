/** @jest-environment jsdom */
import { act, render } from '@testing-library/react'
import React, { useState } from 'react'
import { useBackToClose } from '@/app/(canvass-app)/canvass/lib/useBackToClose'

function Sheet({ onClose }: { onClose: () => void }) {
  useBackToClose(true, onClose)
  return <div>sheet</div>
}

function Host({ spy }: { spy: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <button onClick={() => setOpen(false)}>x</button>
      {open && (
        <Sheet
          onClose={() => {
            spy()
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 5)) })

describe('useBackToClose', () => {
  it('opening adds one history entry; Back closes the sheet via onClose', async () => {
    const spy = jest.fn()
    const { getByText, queryByText } = render(<Host spy={spy} />)
    const before = window.history.length
    await act(async () => { getByText('open').click() })
    await tick()
    expect(window.history.length).toBe(before + 1)
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
    await tick()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(queryByText('sheet')).toBeNull()
  })

  it('closing with the X gives the entry back (history.go(-1)) without calling onClose', async () => {
    const spy = jest.fn()
    const goSpy = jest.spyOn(window.history, 'go')
    const { getByText } = render(<Host spy={spy} />)
    await act(async () => { getByText('open').click() })
    await tick()
    await act(async () => { getByText('x').click() })
    await tick()
    expect(goSpy).toHaveBeenCalledWith(-1)
    expect(spy).not.toHaveBeenCalled()
    goSpy.mockRestore()
  })
})
