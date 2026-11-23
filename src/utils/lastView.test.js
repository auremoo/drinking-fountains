import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLastView, readLastView, saveLastView } from './lastView.js'

const KEY = 'drinking-fountains:last-view'

/** A minimal in-memory `localStorage`. */
function fakeStorage() {
  const data = new Map()
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('lastView', () => {
  it('has nothing to offer on a first visit', () => {
    expect(readLastView()).toBeNull()
  })

  it('gives back the view that was saved', () => {
    saveLastView(45.764, 4.8357, 15)
    expect(readLastView()).toEqual({ lat: 45.764, lng: 4.8357, zoom: 15 })
  })

  it('stores about a metre of precision, not the raw float', () => {
    saveLastView(45.123456789, 4.987654321, 16)
    expect(readLastView()).toEqual({ lat: 45.12346, lng: 4.98765, zoom: 16 })
  })

  it('refuses to store a view the map could not show', () => {
    saveLastView(NaN, 4.8, 15)
    saveLastView(45, 999, 15)
    saveLastView(45, 4.8, undefined)
    expect(readLastView()).toBeNull()
  })

  it('ignores a stored value that would crash the map', () => {
    for (const bad of [
      'not json',
      'null',
      '{"lat":"45","lng":4,"zoom":15}',
      '{"lat":95,"lng":4,"zoom":15}',
      '{"lat":45,"lng":4}',
    ]) {
      localStorage.setItem(KEY, bad)
      expect(readLastView()).toBeNull()
    }
  })

  it('keeps a stored zoom inside what the map allows', () => {
    localStorage.setItem(KEY, '{"lat":45,"lng":4,"zoom":42}')
    expect(readLastView().zoom).toBe(19)
    localStorage.setItem(KEY, '{"lat":45,"lng":4,"zoom":-3}')
    expect(readLastView().zoom).toBe(3)
  })

  it('forgets on request', () => {
    saveLastView(45.764, 4.8357, 15)
    clearLastView()
    expect(readLastView()).toBeNull()
  })

  it('never throws when storage is denied (private browsing)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    })
    expect(() => saveLastView(45, 4, 15)).not.toThrow()
    expect(readLastView()).toBeNull()
    expect(() => clearLastView()).not.toThrow()
  })
})
