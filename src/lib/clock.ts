import type { Clock } from '@/domain/period/Clock'

/**
 * The real clock. The one place outside tests that reads the wall clock for
 * the domain; everything in `domain/` receives this as a parameter
 * (ADR-0006).
 */
export const systemClock: Clock = {
  nowEpochMs: () => Date.now(),
}
