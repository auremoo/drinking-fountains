// @vitest-environment jsdom
/**
 * The bottom sheet only renders rows somebody can see. These tests pin that
 * down, because getting it wrong is invisible in normal use: either the page
 * silently carries hundreds of off-screen rows again, or the list a user opens
 * is missing fountains.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import FountainList from './FountainList.jsx'

const USER = { lat: 48.85, lng: 2.35, accuracy: 0 }

/** `count` fountains strung out northwards, listed farthest-first. */
function fountains(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `node/${i}`,
    lat: 48.85 + (i + 1) * 0.001,
    lng: 2.35,
    name: `Fountain ${i}`,
    wheelchair: null,
    bottle: null,
    tags: {},
  })).reverse()
}

function renderList(props) {
  const all = {
    fountains: fountains(100),
    searched: true,
    userPosition: USER,
    open: false,
    onToggle: () => {},
    onSelect: () => {},
    ...props,
  }
  const view = render(<FountainList {...all} />)
  return { ...view, update: (next) => view.rerender(<FountainList {...all} {...next} />) }
}

const rows = () => document.querySelectorAll('.fountain-item')

/** The closing slide finishing, as the browser reports it. */
function finishSlide() {
  const event = new Event('transitionend', { bubbles: true })
  Object.assign(event, { propertyName: 'transform' })
  act(() => {
    screen.getByLabelText('Nearby fountains').dispatchEvent(event)
  })
}

afterEach(cleanup)

describe('FountainList', () => {
  it('renders no rows while closed, but still reports the count', () => {
    renderList({ open: false })
    expect(rows()).toHaveLength(0)
    expect(screen.getByRole('button', { expanded: false }).textContent).toBe(
      '100 fountains nearby',
    )
  })

  it('opens on the nearest fountains only', () => {
    renderList({ open: true })
    expect(rows()).toHaveLength(40)
    expect(rows()[0].textContent).toContain('Fountain 0')
    expect(rows()[0].textContent).toContain('111 m')
  })

  it('adds rows as the user scrolls towards the end', () => {
    renderList({ open: true })
    // jsdom has no layout: every size is 0, i.e. "already at the end".
    fireEvent.scroll(document.querySelector('.sheet__list'))
    expect(rows()).toHaveLength(80)
    fireEvent.scroll(document.querySelector('.sheet__list'))
    fireEvent.scroll(document.querySelector('.sheet__list'))
    expect(rows()).toHaveLength(100)
  })

  it('keeps the rows while sliding shut, then drops them', () => {
    const { update } = renderList({ open: true })
    update({ open: false })
    expect(rows()).toHaveLength(40)
    finishSlide()
    expect(rows()).toHaveLength(0)
  })

  it('says so when a completed search found nothing', () => {
    renderList({ open: true, fountains: [] })
    expect(screen.getByText(/No fountains found here/)).toBeTruthy()
  })

  it('hands the chosen fountain back', () => {
    const onSelect = vi.fn()
    renderList({ open: true, onSelect })
    fireEvent.click(screen.getByText('Fountain 2'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'node/2' }),
    )
  })
})
