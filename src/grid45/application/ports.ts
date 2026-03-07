export type ClockPort = {
  start(onTick: () => void): () => void
}

export type SeedPort = {
  nextSeed(): number
}
