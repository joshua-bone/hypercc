import { createInitialGameState, advanceGame } from '../domain/engine'
import type { GameState, MoveIntent } from '../domain/model'
import { createGrid45World } from '../domain/world'
import type { ClockPort, SeedPort } from './ports'

export type Grid45Session = {
  getSnapshot(): GameState
  subscribe(listener: (state: GameState) => void): () => void
  setIntent(intent: MoveIntent): void
  reset(): void
  start(): void
  stop(): void
}

type CreateGrid45SessionOptions = {
  clock: ClockPort
  seedPort: SeedPort
}

export function createGrid45Session(options: CreateGrid45SessionOptions): Grid45Session {
  const { clock, seedPort } = options
  const listeners = new Set<(state: GameState) => void>()

  let state = createInitialGameState(createGrid45World({ seed: seedPort.nextSeed() }))
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
    },
    reset() {
      pendingIntent = 'stay'
      state = createInitialGameState(createGrid45World({ seed: seedPort.nextSeed() }))
      emit()
      if (!running) {
        running = true
        stopClock = clock.start(tick)
      }
    },
    start() {
      if (running) return
      running = true
      stopClock = clock.start(tick)
    },
    stop() {
      haltClock()
    },
  }
}
