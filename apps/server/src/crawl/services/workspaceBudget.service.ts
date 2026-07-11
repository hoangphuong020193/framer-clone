import type { WorkspaceReservation } from '../models/crawl.model.js'

/**
 * Tracks cumulative captured bytes against a total-workspace cap so a large
 * or adversarial site can't fill the host's disk.
 *
 * `tryReserve`/`settle` replace a naive check-then-add because `crawlSite`
 * runs pages concurrently: checking a boolean before an `await capturePage`
 * and only committing bytes afterward lets multiple in-flight pages all pass
 * the check before any of them commits, overshooting the cap by up to
 * `concurrency - 1` pages' worth of bytes. `tryReserve` commits an estimate
 * synchronously (no `await` between the check and the reservation) so
 * concurrent callers see each other's reservations immediately; `settle`
 * reconciles the estimate against the real byte count once the page finishes.
 *
 * The estimate is the running average of previously settled pages (0 until
 * the first page settles), so the very first concurrent batch can still
 * overshoot before any page has reported real bytes — an accepted residual
 * limitation rather than one solved outright, since bounding it further
 * would mean serializing the first batch and defeating the point of
 * concurrency.
 */
export class WorkspaceBudget {
  private usedBytes = 0
  private reservedBytes = 0
  private observedPageCount = 0
  private observedPageBytesTotal = 0

  constructor(private readonly capBytes: number) {}

  get used(): number {
    return this.usedBytes
  }

  tryReserve(): WorkspaceReservation {
    if (this.usedBytes + this.reservedBytes >= this.capBytes) {
      return { reserved: false, estimateBytes: 0 }
    }
    const estimateBytes =
      this.observedPageCount === 0 ? 0 : Math.ceil(this.observedPageBytesTotal / this.observedPageCount)
    this.reservedBytes += estimateBytes
    return { reserved: true, estimateBytes }
  }

  settle(estimateBytes: number, actualBytes: number): void {
    this.reservedBytes -= estimateBytes
    this.usedBytes += actualBytes
    this.observedPageCount += 1
    this.observedPageBytesTotal += actualBytes
  }
}
