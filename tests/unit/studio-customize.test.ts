/**
 * Unit tests for Customize (S6a, ADR-0022): stored edits and their checks, how a composition applies them (place,
 * angle, corners, flip, hide, lock, layer order), shaped photos that keep their shape when moved, snapping, and the
 * design changes the editor makes.
 */

import { describe, expect, it } from 'vitest'
import { emptyPlace, moveInOrder, placeEdit, setEdit } from '../../src/shared/studio/arrange'
import { compose, layerOrder } from '../../src/shared/studio/compose'
import { DesignSchema, type Design } from '../../src/shared/studio/design'
import { layers } from '../../src/shared/studio/layers'
import { ParamsSchema } from '../../src/shared/studio/params'
import { circle, roundedRect, transformPath } from '../../src/shared/studio/scene'
import { snapMove, snapResize } from '../../src/shared/studio/snap'

const A = '3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e'
const B = '4f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e'
const C = '5f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e'
const D = '6f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e'
const item = (assetId: string | null) => ({ assetId, crop: { cx: 0.5, cy: 0.5, zoom: 1 }, fit: 'fill' as const })
const quartet = (params: Design['params'] = { v: 1 }, templateId = 'quartet-classic-grid', format: Design['format'] = 'square'): Design => ({
  templateId,
  templateVersion: 1,
  format,
  params,
  items: [item(A), item(B), item(C), item(D)],
})
const composed = (design: Design) => compose({ ...design, photoCount: design.items.length })

describe('stored edits', () => {
  it('accept a place, angle, corners, flip, lock and hide per position, and a layer order; refuse anything else', () => {
    const ok = { v: 1, edits: { '0': { rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.4 }, rotation: -12, rounding: 40, flip: true, locked: true, hidden: true } }, order: [3, 0, 1, 2] }
    expect(ParamsSchema.safeParse(ok).success).toBe(true)
    for (const bad of [
      { v: 1, edits: { photo: {} } }, // positions are numbers
      { v: 1, edits: { '0': { rect: { x: 0, y: 0, width: 0, height: 1 } } } }, // no zero-size places
      { v: 1, edits: { '0': { rotation: 270 } } },
      { v: 1, edits: { '0': { rounding: -1 } } },
      { v: 1, edits: { '0': { flip: false } } }, // off is stored as absent, so there's one way to say it
      { v: 1, edits: { '0': { colour: 'red' } } },
      { v: 1, order: [0, 25] },
    ]) {
      expect(ParamsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('let a place be empty, but only as null, never as a made-up id', () => {
    expect(DesignSchema.safeParse({ ...quartet(), items: [item(null), item(B), item(C), item(D)] }).success).toBe(true)
    expect(DesignSchema.safeParse({ ...quartet(), items: [item('not-a-photo'), item(B), item(C), item(D)] }).success).toBe(false)
  })

  it('setEdit merges and clears, and leaves no empty edit behind', () => {
    let design = setEdit(quartet(), 1, { rotation: 10, flip: true })
    expect(design.params.edits).toEqual({ '1': { rotation: 10, flip: true } })
    design = setEdit(design, 1, { flip: undefined })
    expect(design.params.edits).toEqual({ '1': { rotation: 10 } })
    design = setEdit(design, 1, { rotation: undefined })
    expect(design.params).toEqual({ v: 1 }) // exactly as a design that was never edited
  })
})

describe('composing with edits', () => {
  it('puts a photo where the person moved it, as fractions of the canvas, so it keeps its proportions at another size', () => {
    const square = composed(setEdit(quartet(), 0, { rect: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 } }))
    expect(square.elements.find((e) => e.slot === 0)!.rect).toEqual({ x: 270, y: 540, width: 540, height: 270 })
    const portrait = composed({ ...setEdit(quartet(), 0, { rect: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 } }), format: 'portrait' })
    expect(portrait.elements.find((e) => e.slot === 0)!.rect).toEqual({ x: 270, y: 675, width: 540, height: 337.5 })
    // The others stay in the layout's places.
    expect(square.elements.find((e) => e.slot === 1)!.rect).toEqual(composed(quartet()).elements.find((e) => e.slot === 1)!.rect)
  })

  it('applies angle, rounded corners, flip, lock and hide; hidden photos are drawn nowhere', () => {
    let design = setEdit(quartet(), 2, { rotation: -15, rounding: 60, flip: true, locked: true })
    design = setEdit(design, 3, { hidden: true })
    const c = composed(design)
    const third = c.elements.find((e) => e.slot === 2)!
    expect([third.rotation, third.flip, third.locked, third.hidden]).toEqual([-15, true, true, false])
    expect(third.mask).toBe(roundedRect(third.rect, 60))
    expect(c.elements.find((e) => e.slot === 3)!.hidden).toBe(true)
    // The preview and the export both draw from `layers`, which leaves the hidden photo out.
    expect(layers(c, 0).flatMap((l) => (l.kind === 'photo' ? [l.element.slot] : []))).toEqual([0, 1, 2])
  })

  it('moves and scales a shaped photo’s outline with it, so a circle stays a circle', () => {
    const before = composed(quartet({ v: 1 }, 'quartet-circle-collection'))
    const moved = { x: 100, y: 200, width: 300, height: 300 }
    const after = composed(setEdit(quartet({ v: 1 }, 'quartet-circle-collection'), 0, { rect: placeEdit(before, moved) })).elements.find((e) => e.slot === 0)!
    const numbers = (d: string) => d.match(/-?\d*\.?\d+/g)!.map(Number)
    numbers(after.mask!).forEach((v, i) => expect(v).toBeCloseTo(numbers(circle(moved))[i]!, 1))
  })

  it('draws photos in the person’s layer order, ignoring unknown or repeated positions', () => {
    const c = composed(quartet({ v: 1, order: [3, 1] }))
    expect(c.elements.map((e) => e.slot)).toEqual([3, 1, 0, 2])
    const all = composed(quartet()).elements
    expect(layerOrder(all, [2, 2, 9, 0]).map((e) => e.slot)).toEqual([2, 0, 1, 3])
  })
})

describe('the editor’s changes', () => {
  it('bring forward and send back swap a photo with its neighbour in the drawing order', () => {
    const design = quartet()
    const forward = moveInOrder(design, composed(design), 0, 1)
    expect(composed(forward).elements.map((e) => e.slot)).toEqual([1, 0, 2, 3])
    expect(moveInOrder(forward, composed(forward), 0, -1).params.order).toEqual([0, 1, 2, 3])
    // Already at the front: nothing changes.
    expect(moveInOrder(design, composed(design), 3, 1)).toBe(design)
  })

  it('taking a photo out empties its place and keeps the layout and the other photos', () => {
    const emptied = emptyPlace(quartet(), 1)
    expect(emptied.items.map((i) => i.assetId)).toEqual([A, null, C, D])
    expect(composed(emptied).elements).toEqual(composed(quartet()).elements)
  })
})

describe('moving shapes', () => {
  it('transforms every point of a path, and scales arcs with the axes', () => {
    expect(transformPath('M0 0L10 0H20V5C1 2 3 4 5 6Q1 1 2 2Z', 2, 3, 10, 20)).toBe('M10 20L30 20H50V35C12 26 16 32 20 38Q12 23 14 26Z')
    expect(transformPath('M0 0A5 5 0 0 1 10 0', 2, 1, 0, 0)).toBe('M0 0A10 5 0 0 1 20 0')
  })
})

describe('snapping', () => {
  const canvas = { width: 1000, height: 800 }
  it('pulls a dragged photo’s edge or centre onto the nearest canvas or photo line within reach, and says which', () => {
    // Left edge 6 px from the canvas edge: snaps to it.
    expect(snapMove({ x: 6, y: 333, width: 200, height: 100 }, [], canvas, 10)).toEqual({ rect: { x: 0, y: 333, width: 200, height: 100 }, guides: [{ axis: 'x', at: 0 }] })
    // Centre 4 px off the canvas centre, and top 3 px below another photo's bottom.
    expect(snapMove({ x: 404, y: 253, width: 200, height: 100 }, [{ x: 0, y: 0, width: 100, height: 250 }], canvas, 10)).toEqual({
      rect: { x: 400, y: 250, width: 200, height: 100 },
      guides: [
        { axis: 'x', at: 500 },
        { axis: 'y', at: 250 },
      ],
    })
    // Out of reach, or snapping turned off: left as it is.
    expect(snapMove({ x: 37, y: 333, width: 200, height: 100 }, [], canvas, 10).guides).toEqual([])
    expect(snapMove({ x: 6, y: 333, width: 200, height: 100 }, [], canvas, 0).rect.x).toBe(6)
  })

  it('pulls a resized photo’s right and bottom edges onto nearby lines', () => {
    expect(snapResize({ x: 100, y: 100, width: 395, height: 695 }, [], canvas, 10)).toEqual({
      rect: { x: 100, y: 100, width: 400, height: 700 },
      guides: [
        { axis: 'x', at: 500 },
        { axis: 'y', at: 800 },
      ],
    })
  })
})
