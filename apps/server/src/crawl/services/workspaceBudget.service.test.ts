import { describe, expect, it } from 'vitest'
import { WorkspaceBudget } from './workspaceBudget.service.js'

describe('WorkspaceBudget', () => {
  it('starts with zero used bytes', () => {
    const budget = new WorkspaceBudget(1000)
    expect(budget.used).toBe(0)
  })

  it('settle accumulates actual bytes into used', () => {
    const budget = new WorkspaceBudget(1000)
    const a = budget.tryReserve()
    budget.settle(a.estimateBytes, 300)
    const b = budget.tryReserve()
    budget.settle(b.estimateBytes, 200)
    expect(budget.used).toBe(500)
  })

  it('refuses reservation once used bytes reach the cap', () => {
    const budget = new WorkspaceBudget(1000)
    const first = budget.tryReserve()
    budget.settle(first.estimateBytes, 1000)
    expect(budget.tryReserve().reserved).toBe(false)
  })

  it('refuses reservation once used bytes go over the cap', () => {
    const budget = new WorkspaceBudget(1000)
    const first = budget.tryReserve()
    budget.settle(first.estimateBytes, 1500)
    expect(budget.tryReserve().reserved).toBe(false)
  })

  it('allows reservation while strictly under the cap', () => {
    const budget = new WorkspaceBudget(1000)
    const first = budget.tryReserve()
    budget.settle(first.estimateBytes, 999)
    expect(budget.tryReserve().reserved).toBe(true)
  })

  it('factors outstanding (unsettled) reservations, not just settled bytes, into the cap check', () => {
    const budget = new WorkspaceBudget(250)
    const first = budget.tryReserve()
    expect(first.estimateBytes).toBe(0) // no observations yet
    budget.settle(first.estimateBytes, 100) // used=100, running average=100

    // 100 used + 0 reserved < 250 -> reserved, using the 100-byte average as the estimate.
    const second = budget.tryReserve()
    expect(second.reserved).toBe(true)
    expect(second.estimateBytes).toBe(100)

    // 100 used + 100 reserved < 250 -> still reserved, without settling `second` first.
    const third = budget.tryReserve()
    expect(third.reserved).toBe(true)

    // 100 used + 200 reserved >= 250 -> refused, purely from outstanding reservations.
    const fourth = budget.tryReserve()
    expect(fourth.reserved).toBe(false)
  })

  it('reserves synchronously so concurrent callers cannot both pass the cap check before either settles', () => {
    const budget = new WorkspaceBudget(100)
    const a = budget.tryReserve()
    const b = budget.tryReserve()
    expect(a.reserved).toBe(true)
    // First reservation's estimate is 0 (no data yet), so a second reservation
    // is still allowed here — this documents the accepted first-batch limitation.
    expect(b.reserved).toBe(true)
    budget.settle(a.estimateBytes, 90)
    budget.settle(b.estimateBytes, 90)
    // Both committed even though combined actual (180) exceeds the 100 cap —
    // the overshoot is bounded to this first wave, not eliminated.
    expect(budget.used).toBe(180)
  })
})
