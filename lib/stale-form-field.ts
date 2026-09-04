/**
 * Reconciles one field of a long-lived form against the row as it stands now.
 *
 * Server-rendered edit forms are populated from a row at page load and can sit open for a long
 * time. Submitting one writes those page-load values back wholesale, silently reverting anything
 * that moved in between. On 2026-09-01 lead 3e141d02 "went back to caleb" this way: canvass
 * reassigned the setter (the stale-pin rule in app/api/canvass/lead/route.ts) minutes before a
 * save from a form that had been rendered before the reassignment.
 *
 * `baseline` is what the form was rendered with (carried in a hidden input alongside the field),
 * `submitted` is what came back, `current` is the freshly-read row. A submitted value equal to
 * the baseline is not an edit — it is the form echoing what it was given — so when the row moved
 * underneath, `current` wins. Anything the user actually changed still wins, so deliberate edits,
 * including clearing a field, are never swallowed.
 *
 * Not a full optimistic-concurrency check: it silently prefers the newer value rather than
 * refusing the save. That is the right trade for attribution fields, where the failure being
 * prevented (silently reverting a reassignment, then propagating it to commission) is far worse
 * than a stale echo being ignored.
 */
export function reconcileStaleFormField<T extends string | null>(args: {
  baseline: T
  submitted: T
  current: T
}): T {
  const movedUnderneath = args.baseline !== args.current
  const editedByUser = args.submitted !== args.baseline
  return movedUnderneath && !editedByUser ? args.current : args.submitted
}
