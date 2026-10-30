// @vitest-environment jsdom
/**
 * Component tests for the Best Moments review controls (React Testing Library, simulated browser):
 * the unsaved-changes dialog's keyboard behaviour and focus handling, the favorite toggle, pinch and wheel zoom, the
 * offline image fallback, and the favorites draft logic. These are the details a screen-reader or keyboard user relies on.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComparePanel, FIT, type Member } from '../../src/renderer/src/best-moments/ComparePanel'
import { favoriteAll, isDirty, keepMembers, toggleFavorite } from '../../src/renderer/src/best-moments/review-draft'
import { UnsavedChangesDialog } from '../../src/renderer/src/best-moments/UnsavedChangesDialog'

afterEach(cleanup)

const member: Member = {
  assetId: '3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e',
  favorite: false,
  width: 400,
  height: 300,
  capturedAt: Date.UTC(2024, 6, 20, 10),
  offline: false,
  addedByYou: false,
}

describe('the unsaved-changes dialog', () => {
  function open() {
    const handlers = { onSave: vi.fn(), onDiscard: vi.fn(), onContinue: vi.fn() }
    const opener = document.createElement('button')
    opener.textContent = 'Library'
    document.body.append(opener)
    opener.focus()
    const view = render(<UnsavedChangesDialog {...handlers} />)
    return { handlers, opener, view }
  }

  it('is a labelled modal dialog with Save focused first', () => {
    open()
    const dialog = screen.getByRole('dialog', { name: 'Save your choices?' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }))
  })

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    open()
    const user = userEvent.setup()
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continue reviewing' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continue reviewing' }))
  })

  it('Escape means "continue reviewing", and each button does what it says', async () => {
    const { handlers } = open()
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    expect(handlers.onContinue).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(handlers.onDiscard).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(handlers.onSave).toHaveBeenCalledTimes(1)
  })

  it('gives focus back to where it was when it closes', () => {
    const { opener, view } = open()
    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('a compare panel', () => {
  const props = { member, label: 'Photo A', view: FIT, onPan: () => {}, onZoom: () => {}, onRemove: () => {} }

  it('zooms on a pinch or mouse wheel over the photo, instead of scrolling the page', () => {
    const onZoom = vi.fn()
    render(<ComparePanel {...props} onZoom={onZoom} favorite={false} onToggleFavorite={() => {}} />)
    const frame = screen.getByRole('img').parentElement!
    // Wheel away from you (negative deltaY) or pinch open zooms in; towards you zooms out.
    expect(fireEvent.wheel(frame, { deltaY: -100 })).toBe(false) // false: the page's own scrolling was stopped
    expect(fireEvent.wheel(frame, { deltaY: 5, ctrlKey: true })).toBe(false)
    expect(onZoom).toHaveBeenCalledTimes(2)
    expect(onZoom.mock.calls[0]![0]).toBeGreaterThan(1)
    expect(onZoom.mock.calls[1]![0]).toBeLessThan(1)
  })

  it('has a favorite toggle whose pressed state and text both change', async () => {
    const onToggleFavorite = vi.fn()
    const { rerender } = render(<ComparePanel {...props} favorite={false} onToggleFavorite={onToggleFavorite} />)
    const toggle = screen.getByRole('button', { name: '☆ Favorite' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await userEvent.setup().click(toggle)
    expect(onToggleFavorite).toHaveBeenCalledTimes(1)

    rerender(<ComparePanel {...props} favorite onToggleFavorite={onToggleFavorite} />)
    expect(screen.getByRole('button', { name: '★ Favorite' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('falls back to the thumbnail when the large preview can’t load (for example, the original is offline)', () => {
    render(<ComparePanel {...props} member={{ ...member, offline: true }} favorite={false} onToggleFavorite={() => {}} />)
    const image = screen.getByRole('img', { name: /offline/ })
    expect(image.getAttribute('src')).toBe(`nm-media://preview/${member.assetId}`)
    fireEvent.error(image)
    expect(screen.getByRole('img', { name: /offline/ }).getAttribute('src')).toBe(`nm-media://thumb/${member.assetId}`)
  })
})

describe('the favorites draft', () => {
  it('toggles, selects all, and knows when it differs from what is saved', () => {
    const saved = new Set(['a'])
    let draft = toggleFavorite(saved, 'b')
    expect(isDirty(saved, draft)).toBe(true)
    draft = toggleFavorite(draft, 'b')
    expect(isDirty(saved, draft)).toBe(false)
    expect([...favoriteAll(['a', 'b', 'c'])]).toEqual(['a', 'b', 'c'])
  })

  it('keeps picks only for photos still in the set after it changes', () => {
    expect([...keepMembers(new Set(['a', 'gone']), ['a', 'b'])]).toEqual(['a'])
  })
})
