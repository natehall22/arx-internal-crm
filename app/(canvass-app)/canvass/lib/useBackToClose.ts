'use client'

import { useEffect, useRef } from 'react'

/**
 * Android Back closes the open sheet instead of leaving the app.
 *
 * A mounted sheet holds one history entry. Back pops it and calls the sheet's onClose (the same handler as its X).
 * A sheet closed any other way (X, save) gives its entry back with history.go(-1), so Back history stays clean.
 * One shared stack handles sheets that swap in the same tick (storm peek -> new pin) without a stray entry:
 * the entries are reconciled once after the tick, not per sheet.
 */
type Entry = { close: () => void }

const stack: Entry[] = []
let pushed = 0 // history entries we have added and not yet removed
let suppress = 0 // popstate events caused by our own history.go()
let scheduled = false
let listening = false

function reconcile() {
  scheduled = false
  if (suppress > 0) return schedule() // wait for our own pop to land before touching history again
  while (pushed < stack.length) {
    // Keep the existing state: Next's router reads it on popstate and hard-reloads if its marker is missing.
    window.history.pushState({ ...window.history.state, canvassSheet: true }, '')
    pushed++
  }
  if (pushed > stack.length) {
    const extra = pushed - stack.length
    pushed = stack.length
    suppress++
    window.setTimeout(() => {
      suppress = 0 // safety: if the pop never fired (user navigated away), do not swallow a real Back
    }, 1000)
    window.history.go(-extra)
  }
}

function schedule() {
  if (scheduled) return
  scheduled = true
  window.setTimeout(reconcile, 0)
}

function onPopState() {
  if (suppress > 0) {
    suppress--
    return
  }
  if (stack.length === 0) {
    pushed = 0
    return
  }
  pushed = Math.max(0, pushed - 1) // the browser already removed our entry
  stack[stack.length - 1].close()
}

export function useBackToClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const entry: Entry = { close: () => closeRef.current() }
    stack.push(entry)
    if (!listening) {
      window.addEventListener('popstate', onPopState)
      listening = true
    }
    schedule()
    return () => {
      const i = stack.indexOf(entry)
      if (i >= 0) stack.splice(i, 1)
      schedule()
    }
  }, [open])
}
