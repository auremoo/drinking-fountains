import { describe, expect, it } from 'vitest'
import { backoffMs, FRESH_MS, planSearch } from './searchPlan.js'
import { bboxAround, bboxContains } from './geo.js'

/** A city-block-sized view, well within the area limit. */
const VIEW = bboxAround(48.8566, 2.3522, 700)
const NOW = 1_700_000_000_000

describe('planSearch', () => {
  it('searches a padded box around a fresh view', () => {
    const plan = planSearch({ bbox: VIEW, now: NOW })
    expect(plan.action).toBe('search')
    // Padded, so the next small pan is already covered.
    expect(bboxContains(plan.queryBbox, VIEW)).toBe(true)
    expect(plan.queryBbox[2] - plan.queryBbox[0]).toBeGreaterThan(
      VIEW[2] - VIEW[0],
    )
  })

  it('refuses an unusable bbox', () => {
    expect(planSearch({ bbox: null }).action).toBe('invalid')
    expect(planSearch({ bbox: [NaN, 1, 2, 3] }).action).toBe('invalid')
  })

  it('refuses a region-sized view instead of timing out on it', () => {
    const plan = planSearch({ bbox: [42, -5, 51, 8], now: NOW })
    expect(plan.action).toBe('too-large')
    expect(plan.queryBbox).toBeNull()
  })

  it('skips a view already covered by a recent search', () => {
    const covered = { bbox: bboxAround(48.8566, 2.3522, 2000), at: NOW - 1000 }
    expect(planSearch({ bbox: VIEW, covered, now: NOW }).action).toBe('covered')
  })

  it('searches again once the covered area goes stale', () => {
    const covered = {
      bbox: bboxAround(48.8566, 2.3522, 2000),
      at: NOW - FRESH_MS - 1,
    }
    expect(planSearch({ bbox: VIEW, covered, now: NOW }).action).toBe('search')
  })

  it('searches when the user pans outside the covered area', () => {
    const covered = { bbox: bboxAround(48.8566, 2.3522, 700), at: NOW - 1000 }
    const elsewhere = bboxAround(48.88, 2.4, 700)
    expect(planSearch({ bbox: elsewhere, covered, now: NOW }).action).toBe(
      'search',
    )
  })

  it('waits for an in-flight request that already covers the view', () => {
    const inflight = bboxAround(48.8566, 2.3522, 2000)
    expect(planSearch({ bbox: VIEW, inflight, now: NOW }).action).toBe(
      'inflight',
    )
  })

  it('supersedes an in-flight request for a different area', () => {
    const inflight = bboxAround(45.76, 4.83, 2000)
    expect(planSearch({ bbox: VIEW, inflight, now: NOW }).action).toBe('search')
  })

  it('stays quiet during the failure backoff', () => {
    expect(
      planSearch({ bbox: VIEW, quietUntil: NOW + 5000, now: NOW }).action,
    ).toBe('backoff')
  })

  it('resumes once the backoff has elapsed', () => {
    expect(
      planSearch({ bbox: VIEW, quietUntil: NOW - 1, now: NOW }).action,
    ).toBe('search')
  })

  it('honours a forced search despite coverage, backoff and in-flight work', () => {
    const plan = planSearch({
      bbox: VIEW,
      covered: { bbox: bboxAround(48.8566, 2.3522, 5000), at: NOW },
      inflight: bboxAround(48.8566, 2.3522, 5000),
      quietUntil: NOW + 60000,
      force: true,
      now: NOW,
    })
    expect(plan.action).toBe('search')
  })

  it('still refuses an oversized area even when forced', () => {
    expect(
      planSearch({ bbox: [42, -5, 51, 8], force: true, now: NOW }).action,
    ).toBe('too-large')
  })
})

describe('backoffMs', () => {
  it('grows exponentially and then stops', () => {
    expect(backoffMs(0)).toBe(0)
    expect(backoffMs(1)).toBe(6000)
    expect(backoffMs(2)).toBe(12000)
    expect(backoffMs(3)).toBe(24000)
    expect(backoffMs(10)).toBe(60000)
    expect(backoffMs(100)).toBe(60000)
  })
})
