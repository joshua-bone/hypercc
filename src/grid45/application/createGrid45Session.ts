import { createInitialGameState, advanceGame } from '../domain/engine'
import type { GameState, MazeWorld, MoveIntent } from '../domain/model'
import { createGrid45World, defaultAntCount, defaultPinkBallCount, defaultTankCount, defaultTeethCount, defaultWorldSize, type WorldSize } from '../domain/world'
import type { ClockPort, SeedPort } from './ports'

export type Grid45Session = {
  getSnapshot(): GameState
  subscribe(listener: (state: GameState) => void): () => void
  setIntent(intent: MoveIntent): void
  step(intent: MoveIntent, ticks: number): void
  undo(): void
  restart(): void
  reset(size?: WorldSize, antCount?: number, pinkBallCount?: number, teethCount?: number, tankCount?: number, seed?: number): void
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
  initialTankCount?: number
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
    initialTankCount = defaultTankCount,
  } = options
  const listeners = new Set<(state: GameState) => void>()
  let worldSize = initialWorldSize
  let antCount = initialAntCount
  let pinkBallCount = initialPinkBallCount
  let teethCount = initialTeethCount
  let tankCount = initialTankCount
  const createWorld = (seedOverride?: number) =>
    createGrid45World({ seed: seedOverride ?? seedPort.nextSeed(), size: worldSize, antCount, pinkBallCount, teethCount, tankCount })
  let currentWorld = initialWorld ? structuredClone(initialWorld) : createWorld()

  let state = createInitialGameState(currentWorld)
  let pendingIntent: MoveIntent = 'stay'
  let history: GameState[] = []
  let stopClock = () => {}
  let running = false

  const emit = () => {
    for (const listener of listeners) listener(state)
  }

  const pushHistory = () => {
    history = history.concat(state).slice(-256)
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
    step(intent, ticks) {
      if (ticks <= 0) return
      haltClock()
      if (state.levelComplete || state.playerDead) return
      pushHistory()
      for (let stepIndex = 0; stepIndex < ticks; stepIndex += 1) {
        state = advanceGame(state, stepIndex === 0 ? intent : 'stay')
        if (state.levelComplete || state.playerDead) break
      }
      pendingIntent = 'stay'
      emit()
    },
    undo() {
      haltClock()
      const previous = history[history.length - 1]
      if (!previous) return
      history = history.slice(0, -1)
      pendingIntent = 'stay'
      state = previous
      emit()
    },
    restart() {
      haltClock()
      pendingIntent = 'stay'
      history = []
      state = createInitialGameState(currentWorld)
      emit()
    },
    reset(size = worldSize, nextAntCount = antCount, nextPinkBallCount = pinkBallCount, nextTeethCount = teethCount, nextTankCount = tankCount, seedOverride) {
      worldSize = size
      antCount = nextAntCount
      pinkBallCount = nextPinkBallCount
      teethCount = nextTeethCount
      tankCount = nextTankCount
      haltClock()
      pendingIntent = 'stay'
      history = []
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
