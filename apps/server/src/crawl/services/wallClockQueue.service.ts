import PQueue from 'p-queue'
import type { WallClockQueue } from '../models/crawl.model.js'

/**
 * Wraps a `p-queue` worker pool with a wall-clock deadline: once `timeoutMs`
 * elapses, in-flight tasks finish normally but the queue is paused and
 * cleared so no further queued work starts. `isTripped()` lets callers (see
 * `crawlSite.service.ts`'s `enqueue`) stop adding new work once the deadline
 * has fired — without that check, seeding calls made after the timer runs
 * would add tasks to a queue nothing ever resumes, and `onIdle()` would
 * never resolve.
 */
export function createWallClockQueue(concurrency: number, timeoutMs: number): WallClockQueue {
  let tripped = false
  let droppedByTimeout = 0
  const queue = new PQueue({ concurrency })

  const deadlineTimer = setTimeout(() => {
    tripped = true
    droppedByTimeout = queue.size
    queue.pause()
    queue.clear()
  }, timeoutMs)

  return {
    isTripped: () => tripped,
    pagesDroppedByTimeout: () => droppedByTimeout,
    add: (task) => queue.add(task) as Promise<void>,
    onIdle: () => queue.onIdle(),
    stop: () => clearTimeout(deadlineTimer),
  }
}
