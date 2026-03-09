import { createInitialGameState, advanceGame } from '../domain/engine'
import type { GameState, MazeWorld, MoveIntent } from '../domain/model'
import { createGrid45World, defaultAntCount, defaultPinkBallCount, defaultTeethCount, defaultWorldSize, type WorldSize } from '../domain/world'
import type { ClockPort, SeedPort } from './ports'

export type Grid45Session = {
  getSnapshot(): GameState
  subscribe(listener: (state: GameState) => void): () => void
  setIntent(intent: MoveIntent): void
  restart(): void
  reset(size?: WorldSize, antCount?: number, pinkBallCount?: number, teethCount?: number, seed?: number): void
  start(): void
  stop(): void
}

type CreateGrid45SessionOptions = {
  clock: ClockPort
  seedPort: SeedPort
  initialWorld?: MazeWorld
  initialWorldSize?: WorldSize
  initialAntCount?: number
  initialPinkBallCount?: number
  initialTeethCount?: number
}

export function createGrid45Session(options: CreateGrid45SessionOptions): Grid45Session {
  const {
    clock,
    seedPort,
    initialWorld,
    initialWorldSize = defaultWorldSize,
    initialAntCount = defaultAntCount,
    initialPinkBallCount = defaultPinkBallCount,
    initialTeethCount = defaultTeethCount,
  } = options
  const listeners = new Set<(state: GameState) => void>()
  let worldSize = initialWorldSize
  let antCount = initialAntCount
  let pinkBallCount = initialPinkBallCount
  let teethCount = initialTeethCount
  const createWorld = (seedOverride?: number) =>
    createGrid45World({ seed: seedOverride ?? seedPort.nextSeed(), size: worldSize, antCount, pinkBallCount, teethCount })
  let currentWorld = initialWorld ? structuredClone(initialWorld) : createWorld()

  let state = createInitialGameState(currentWorld)
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
    if (state.levelComplete || state.playerDead) haltClock()
  }

  const beginTicking = () => {
    if (running || state.levelComplete || state.playerDead) return
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
      if (!running && intent !== 'stay' && !state.levelComplete && !state.playerDead) {
        tick()
        if (!state.levelComplete && !state.playerDead) beginTicking()
      }
    },
    restart() {
      haltClock()
      pendingIntent = 'stay'
      state = createInitialGameState(currentWorld)
      emit()
    },
    reset(size = worldSize, nextAntCount = antCount, nextPinkBallCount = pinkBallCount, nextTeethCount = teethCount, seedOverride) {
      worldSize = size
      antCount = nextAntCount
      pinkBallCount = nextPinkBallCount
      teethCount = nextTeethCount
      haltClock()
      pendingIntent = 'stay'
      currentWorld = createWorld(seedOverride)
      state = createInitialGameState(currentWorld)
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
