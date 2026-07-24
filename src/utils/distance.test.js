import { describe, expect, it } from 'vitest'
import { distanceMeters, formatDistance } from './distance.js'

describe('distanceMeters', () => {
  it('matches a known city-to-city distance', () => {
    // Paris → Lyon is ~392 km as the crow flies.
    const d = distanceMeters(48.8566, 2.3522, 45.764, 4.8357)
    expect(d / 1000).toBeGreaterThan(388)
    expect(d / 1000).toBeLessThan(396)
  })

  it('is zero for the same point and symmetric', () => {
    expect(distanceMeters(48.85, 2.35, 48.85, 2.35)).toBe(0)
    expect(distanceMeters(48.85, 2.35, 48.86, 2.36)).toBeCloseTo(
      distanceMeters(48.86, 2.36, 48.85, 2.35),
      6,
    )
  })

  it('handles street-scale distances', () => {
    // 0.001° of latitude ≈ 111 m.
    expect(distanceMeters(48.85, 2.35, 48.851, 2.35)).toBeCloseTo(111, 0)
  })
})

describe('formatDistance', () => {
  it('uses metres below a kilometre', () => {
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(123.4)).toBe('123 m')
    expect(formatDistance(999)).toBe('999 m')
  })

  it('switches to kilometres above', () => {
    expect(formatDistance(1000)).toBe('1.0 km')
    expect(formatDistance(1449)).toBe('1.4 km')
  })
})
