import { describe, expect, it } from 'vitest'
import {
  bboxAreaKm2,
  bboxAround,
  bboxCenter,
  bboxContains,
  bboxKey,
  isValidLatLng,
  normalizeBbox,
  padBbox,
  toNumber,
  wrapLng,
} from './geo.js'

describe('isValidLatLng', () => {
  it('accepts real coordinates', () => {
    expect(isValidLatLng(48.8566, 2.3522)).toBe(true)
    expect(isValidLatLng(0, 0)).toBe(true)
    expect(isValidLatLng(-90, 180)).toBe(true)
  })

  it('rejects everything Leaflet would throw on', () => {
    expect(isValidLatLng(NaN, 2)).toBe(false)
    expect(isValidLatLng(48, Infinity)).toBe(false)
    expect(isValidLatLng(null, 2)).toBe(false)
    expect(isValidLatLng(undefined, undefined)).toBe(false)
    expect(isValidLatLng('48.8', '2.3')).toBe(false)
    expect(isValidLatLng(91, 2)).toBe(false)
    expect(isValidLatLng(48, 181)).toBe(false)
  })
})

describe('toNumber', () => {
  it('reads numeric strings from API payloads', () => {
    expect(toNumber('48.8566')).toBeCloseTo(48.8566)
    expect(toNumber(2.3522)).toBe(2.3522)
  })

  it('returns null for unusable values', () => {
    expect(toNumber('')).toBeNull()
    expect(toNumber('   ')).toBeNull()
    expect(toNumber('abc')).toBeNull()
    expect(toNumber(null)).toBeNull()
    expect(toNumber(undefined)).toBeNull()
    expect(toNumber(NaN)).toBeNull()
  })
})

describe('wrapLng', () => {
  it('brings longitudes back into range', () => {
    expect(wrapLng(2.35)).toBeCloseTo(2.35)
    expect(wrapLng(190)).toBeCloseTo(-170)
    expect(wrapLng(-190)).toBeCloseTo(170)
    expect(wrapLng(540)).toBeCloseTo(180)
  })
})

describe('normalizeBbox', () => {
  it('passes a sane box through untouched', () => {
    expect(normalizeBbox([48.8, 2.3, 48.9, 2.4])).toEqual([48.8, 2.3, 48.9, 2.4])
  })

  it('reorders inverted latitudes', () => {
    expect(normalizeBbox([48.9, 2.3, 48.8, 2.4])).toEqual([48.8, 2.3, 48.9, 2.4])
  })

  it('clamps latitudes to the poles', () => {
    const [south, , north] = normalizeBbox([-120, 2.3, 120, 2.4])
    expect(south).toBe(-90)
    expect(north).toBe(90)
  })

  it('repairs the out-of-range longitudes Leaflet reports past the antimeridian', () => {
    const bbox = normalizeBbox([48.8, 185, 48.9, 195])
    expect(bbox).not.toBeNull()
    expect(bbox[1]).toBeGreaterThanOrEqual(-180)
    expect(bbox[3]).toBeLessThanOrEqual(180)
    expect(bbox[1]).toBeLessThanOrEqual(bbox[3])
  })

  it('collapses a world-spanning box instead of leaving it inverted', () => {
    expect(normalizeBbox([-80, -400, 80, 400])).toEqual([-80, -180, 80, 180])
  })

  it('rejects malformed input', () => {
    expect(normalizeBbox(null)).toBeNull()
    expect(normalizeBbox([1, 2, 3])).toBeNull()
    expect(normalizeBbox([1, 2, 3, 'x'])).toBeNull()
    expect(normalizeBbox([NaN, 2, 3, 4])).toBeNull()
  })
})

describe('padBbox', () => {
  it('grows the box on every side', () => {
    const [south, west, north, east] = padBbox([48.0, 2.0, 48.2, 2.2], 0.5)
    expect(south).toBeCloseTo(47.9)
    expect(north).toBeCloseTo(48.3)
    expect(west).toBeCloseTo(1.9)
    expect(east).toBeCloseTo(2.3)
  })

  it('keeps the result valid at extreme latitudes', () => {
    const padded = padBbox([88, 2, 89.9, 3], 1)
    expect(padded[2]).toBeLessThanOrEqual(90)
  })
})

describe('bboxContains', () => {
  const outer = [48.0, 2.0, 49.0, 3.0]

  it('detects containment', () => {
    expect(bboxContains(outer, [48.4, 2.4, 48.6, 2.6])).toBe(true)
    expect(bboxContains(outer, outer)).toBe(true)
  })

  it('detects escape in any direction', () => {
    expect(bboxContains(outer, [47.9, 2.4, 48.6, 2.6])).toBe(false)
    expect(bboxContains(outer, [48.4, 1.9, 48.6, 2.6])).toBe(false)
    expect(bboxContains(outer, [48.4, 2.4, 49.1, 2.6])).toBe(false)
    expect(bboxContains(outer, [48.4, 2.4, 48.6, 3.1])).toBe(false)
  })

  it('is false when a box is missing', () => {
    expect(bboxContains(null, outer)).toBe(false)
    expect(bboxContains(outer, null)).toBe(false)
  })
})

describe('bboxAround', () => {
  it('builds a box of about the requested radius', () => {
    const bbox = bboxAround(48.8566, 2.3522, 1300)
    const heightKm = (bbox[2] - bbox[0]) * 111.32
    expect(heightKm).toBeCloseTo(2.6, 1)
    expect(bboxCenter(bbox).lat).toBeCloseTo(48.8566, 4)
  })

  it('keeps the ground radius honest away from the equator', () => {
    const paris = bboxAround(48.8566, 2.3522, 1300)
    const reykjavik = bboxAround(64.1466, -21.9426, 1300)
    // Longitude degrees shrink towards the poles, so the same distance needs a
    // wider span in degrees. A fixed degree offset silently under-searched here.
    expect(reykjavik[3] - reykjavik[1]).toBeGreaterThan(paris[3] - paris[1])
  })

  it('rejects invalid input', () => {
    expect(bboxAround(NaN, 2, 1000)).toBeNull()
    expect(bboxAround(48, 2, NaN)).toBeNull()
  })
})

describe('bboxAreaKm2', () => {
  it('measures a city-sized box', () => {
    // ~2.6 km × ~2.6 km around Paris.
    const area = bboxAreaKm2(bboxAround(48.8566, 2.3522, 1300))
    expect(area).toBeGreaterThan(5)
    expect(area).toBeLessThan(9)
  })

  it('flags a country-sized box as huge', () => {
    expect(bboxAreaKm2([42, -5, 51, 8])).toBeGreaterThan(100000)
  })
})

describe('bboxKey', () => {
  it('is stable for visually identical views', () => {
    expect(bboxKey([48.85661, 2.35221, 48.86, 2.36])).toBe(
      bboxKey([48.856614, 2.352214, 48.86, 2.36]),
    )
  })

  it('differs for different areas', () => {
    expect(bboxKey([48.8, 2.3, 48.9, 2.4])).not.toBe(
      bboxKey([48.8, 2.3, 48.9, 2.5]),
    )
  })
})
