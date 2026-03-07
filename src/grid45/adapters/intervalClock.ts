import type { ClockPort } from '../application/ports'

export function createIntervalClock(ticksPerSecond: number): ClockPort {
  const intervalMs = Math.max(1, Math.round(1000 / ticksPerSecond))

  return {
    start(onTick) {
      const id = window.setInterval(onTick, intervalMs)
      return () => {
        window.clearInterval(id)
      }
    },
  }
}
