import { directionFromKey } from '../domain/directions'
import type { Direction, MoveIntent } from '../domain/model'

function removeDirection(directions: Direction[], direction: Direction): void {
  const index = directions.indexOf(direction)
  if (index >= 0) directions.splice(index, 1)
}

export function attachKeyboardIntent(target: Window, onIntentChange: (intent: MoveIntent) => void): () => void {
  const activeDirections: Direction[] = []

  const syncIntent = () => {
    onIntentChange(activeDirections[0] ?? 'stay')
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const direction = directionFromKey(event.key)
    if (!direction || direction === 'stay') return

    removeDirection(activeDirections, direction)
    activeDirections.unshift(direction)
    syncIntent()
    event.preventDefault()
  }

  const onKeyUp = (event: KeyboardEvent) => {
    const direction = directionFromKey(event.key)
    if (!direction || direction === 'stay') return

    removeDirection(activeDirections, direction)
    syncIntent()
    event.preventDefault()
  }

  target.addEventListener('keydown', onKeyDown, { passive: false })
  target.addEventListener('keyup', onKeyUp, { passive: false })

  return () => {
    target.removeEventListener('keydown', onKeyDown)
    target.removeEventListener('keyup', onKeyUp)
  }
}
