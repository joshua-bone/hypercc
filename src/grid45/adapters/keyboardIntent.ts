import { directionFromKey } from '../domain/directions'
import type { Direction, MoveIntent } from '../domain/model'

function removeDirection(directions: Direction[], direction: Direction): void {
  const index = directions.indexOf(direction)
  if (index >= 0) directions.splice(index, 1)
}

export function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select, button, [contenteditable=""], [contenteditable="true"]') !== null
}

export function attachKeyboardIntent(target: Window, onIntentChange: (intent: MoveIntent) => void): () => void {
  const activeDirections: Direction[] = []

  const syncIntent = () => {
    onIntentChange(activeDirections[0] ?? 'stay')
  }

  const clearIntent = () => {
    if (activeDirections.length === 0) return
    activeDirections.length = 0
    syncIntent()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (isInteractiveKeyboardTarget(event.target)) {
      clearIntent()
      return
    }

    const direction = directionFromKey(event.key)
    if (!direction || direction === 'stay') return

    removeDirection(activeDirections, direction)
    activeDirections.unshift(direction)
    syncIntent()
    event.preventDefault()
  }

  const onKeyUp = (event: KeyboardEvent) => {
    if (isInteractiveKeyboardTarget(event.target)) {
      clearIntent()
      return
    }

    const direction = directionFromKey(event.key)
    if (!direction || direction === 'stay') return

    removeDirection(activeDirections, direction)
    syncIntent()
    event.preventDefault()
  }

  const onFocusIn = (event: FocusEvent) => {
    if (isInteractiveKeyboardTarget(event.target)) clearIntent()
  }

  target.addEventListener('keydown', onKeyDown, { passive: false })
  target.addEventListener('keyup', onKeyUp, { passive: false })
  target.addEventListener('focusin', onFocusIn)

  return () => {
    target.removeEventListener('keydown', onKeyDown)
    target.removeEventListener('keyup', onKeyUp)
    target.removeEventListener('focusin', onFocusIn)
  }
}
