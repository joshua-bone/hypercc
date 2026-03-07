import { createInitialGameState, advanceGame } from '../domain/engine'
import type { GameState, MoveIntent } from '../domain/model'
import { createGrid45World, defaultWorldSize, type WorldSize } from '../domain/world'
import type { ClockPort, SeedPort } from './ports'

export type Grid45Session = {
  getSnapshot(): GameState
  subscribe(listener: (state: GameState) => void): () => void
  setIntent(intent: MoveIntent): void
  reset(size?: WorldSize): void
  start(): void
  stop(): void
}

type CreateGrid45SessionOptions = {
  clock: ClockPort
  seedPort: SeedPort
  initialWorldSize?: WorldSize
}

export function createGrid45Session(options: CreateGrid45SessionOptions): Grid45Session {
  const { clock, seedPort, initialWorldSize = defaultWorldSize } = options
  const listeners = new Set<(state: GameState) => void>()
  let worldSize = initialWorldSize
  const createWorld = () => createGrid45World({ seed: seedPort.nextSeed(), size: worldSize })

  let state = createInitialGameState(createWorld())
  let pendingIntent: MoveIntent = 'stay'
  let stopClock = () => {}
  let running = false

  const emit = () => {
    for (const listener of listeners) listener(state)
  }

  const haltClock = () => {
    if (!running) return
    running = false
    stopClock()
    stopClock = () => {}
  }

  const tick = () => {
    state = advanceGame(state, pendingIntent)
    emit()
    if (state.levelComplete) haltClock()
  }

  const beginTicking = () => {
    if (running || state.levelComplete) return
    running = true
    stopClock = clock.start(tick)
  }

  return {
    getSnapshot() {
      return state
    },
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => {
        listeners.delete(listener)
      }
    },
    setIntent(intent) {
      pendingIntent = intent
      if (!running && intent !== 'stay' && !state.levelComplete) {
        tick()
        if (!state.levelComplete) beginTicking()
      }
    },
    reset(size = worldSize) {
      worldSize = size
      haltClock()
      pendingIntent = 'stay'
      state = createInitialGameState(createWorld())
      emit()
    },
    start() {
      beginTicking()
    },
    stop() {
      haltClock()
    },
  }
}
