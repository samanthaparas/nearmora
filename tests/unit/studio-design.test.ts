/**
 * Unit tests for Studio Quick edits: where a photo and its border are drawn (fill and fit), the design edits (swap,
 * move, replace, reset), the composition's border scaling, and the undo/redo list. Preview and export both rely on
 * placePhoto(), and the editor relies on the history rules, so these pin both down.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_CROP, placePhoto } from '../../src/shared/layout'
import { compose } from '../../src/shared/studio/compose'
import { moveItem, replaceItem, resetDesign, sameDesign, swapItems, updateItem, type Design } from '../../src/shared/studio/design'
import { HISTORY_LIMIT, preview, record, redo, startHistory, undo } from '../../src/renderer/src/studio/design-history'

const cell = { x: 100, y: 100, width: 400, height: 600 }
const landscape = { width: 4000, height: 3000 }

describe('placing a photo', () => {
  it('fill: no border means the photo covers the whole place', () => {
    const place = placePhoto(landscape, cell, DEFAULT_CROP, 'fill', 0)
    expect(place.frame).toBeNull()
    expect(place.dest).toEqual(cell)
    expect(place.src.width / place.src.height).toBeCloseTo(400 / 600, 6) // no stretching
  })

  it('fill with a border: the border lines the place and the photo fills what’s inside', () => {
    const place = placePhoto(landscape, cell, DEFAULT_CROP, 'fill', 20)
    expect(place.frame).toEqual(cell)
    expect(place.dest).toEqual({ x: 120, y: 120, width: 360, height: 560 })
    expect(place.src.width / place.src.height).toBeCloseTo(360 / 560, 6)
  })

  it('fit: the whole photo, centred and unstretched, with the border around the photo', () => {
    const place = placePhoto(landscape, cell, { cx: 0.9, cy: 0.1, zoom: 4 }, 'fit', 20)
    expect(place.src).toEqual({ x: 0, y: 0, width: 4000, height: 3000 }) // the crop is ignored
    expect(place.dest.width).toBeCloseTo(360, 6)
    expect(place.dest.height).toBeCloseTo(270, 6)
    expect(place.dest.y + place.dest.height / 2).toBeCloseTo(400, 6) // centred
    expect(place.frame).toEqual({ x: place.dest.x - 20, y: place.dest.y - 20, width: place.dest.width + 40, height: place.dest.height + 40 })
  })

  it('a border never swallows the photo: at most a quarter of the shorter side', () => {
    const place = placePhoto(landscape, { x: 0, y: 0, width: 100, height: 300 }, DEFAULT_CROP, 'fill', 500)
    expect(place.dest).toEqual({ x: 25, y: 25, width: 50, height: 250 })
  })
})

describe('borders in the composition', () => {
  it('scales the border with the canvas, like margins and gutters', () => {
    const input = { templateId: 'pair-equal-split', templateVersion: 1, params: { v: 1 as const, borderWidth: 10, borderColor: '#2f2b2c' }, photoCount: 2 }
    expect(compose({ ...input, format: 'square' }).border).toEqual({ width: 10, color: '#2f2b2c' })
    expect(compose({ ...input, format: 'landscape' }).border.width).toBe(10) // shorter side is still 1080
    expect(compose({ ...input, params: { v: 1 }, format: 'square' }).border).toEqual({ width: 0, color: '#ffffff' })
  })
})

const ids = ['a', 'b', 'c', 'd'].map((l) => `00000000-0000-4000-8000-00000000000${l}`)
const base: Design = {
  templateId: 'quartet-classic-grid',
  templateVersion: 1,
  format: 'square',
  params: { v: 1 },
  items: ids.map((assetId, i) => ({ assetId, crop: { cx: i / 10, cy: 0.5, zoom: 1 }, fit: i === 3 ? 'fit' : 'fill' })),
}

describe('design edits', () => {
  it('swap exchanges two places; each photo keeps its crop and fit', () => {
    const swapped = swapItems(base, 0, 3)
    expect(swapped.items.map((i) => i.assetId)).toEqual([ids[3], ids[1], ids[2], ids[0]])
    expect(swapped.items[0]).toEqual(base.items[3])
    expect(base.items[0]!.assetId).toBe(ids[0]) // the original isn't changed
  })

  it('move shifts the others along', () => {
    expect(moveItem(base, 0, 2).items.map((i) => i.assetId)).toEqual([ids[1], ids[2], ids[0], ids[3]])
  })

  it('replace starts the new photo centred and keeps the place’s fit', () => {
    const replaced = replaceItem(base, 3, 'new')
    expect(replaced.items[3]).toEqual({ assetId: 'new', crop: DEFAULT_CROP, fit: 'fit' })
  })

  it('reset keeps photos and order, and clears settings, crops and fit', () => {
    const reset = resetDesign({ ...swapItems(base, 0, 1), params: { v: 1, margin: 0, borderWidth: 30 } })
    expect(reset.params).toEqual({ v: 1 })
    expect(reset.items.map((i) => i.assetId)).toEqual([ids[1], ids[0], ids[2], ids[3]])
    expect(reset.items.every((i) => i.fit === 'fill' && i.crop === DEFAULT_CROP)).toBe(true)
  })

  it('treats designs as equal whatever order their settings were set in', () => {
    const a = { ...base, params: { v: 1 as const, margin: 10, background: '#ffffff' } }
    const b = { ...base, params: { v: 1 as const, background: '#ffffff', margin: 10 } }
    expect(sameDesign(a, b)).toBe(true)
    expect(sameDesign(a, updateItem(a, 0, { fit: 'fit' }))).toBe(false)
  })
})

describe('undo and redo', () => {
  const margin = (m: number): Design => ({ ...base, params: { v: 1, margin: m } })

  it('undoes and redoes in order, naming each edit', () => {
    let h = startHistory(base)
    h = record(h, margin(10), 'Margin changed')
    h = record(h, swapItems(margin(10), 0, 1), 'Swapped photos 1 and 2')
    h = undo(h)
    expect(h.present.design).toEqual(margin(10))
    expect(h.future[0]!.label).toBe('Swapped photos 1 and 2')
    h = undo(h)
    expect(h.present.design).toEqual(base)
    expect(undo(h)).toBe(h) // nothing further back
    h = redo(redo(h))
    expect(h.present.design).toEqual(swapItems(margin(10), 0, 1))
    expect(redo(h)).toBe(h)
  })

  it('a new edit after undo clears the redo list', () => {
    let h = record(startHistory(base), margin(10), 'Margin changed')
    h = record(undo(h), margin(20), 'Margin changed')
    expect(h.future).toEqual([])
    expect(h.past.map((e) => e.design)).toEqual([base])
  })

  it('an edit that changes nothing adds nothing', () => {
    const h = startHistory(base)
    expect(record(h, { ...base }, 'Nothing').past).toEqual([])
  })

  it('a whole drag is one step: previews don’t add entries, and the step starts where the drag began', () => {
    let h = startHistory(base)
    const start = h.present
    for (const m of [2, 4, 6, 8]) h = preview(h, margin(m))
    expect(h.past).toEqual([])
    h = record(h, h.present.design, 'Margin changed', start)
    expect(h.past.map((e) => e.design)).toEqual([base])
    expect(undo(h).present.design).toEqual(base)
    // A drag that ends where it started adds nothing.
    const back = record(preview(startHistory(base), base), base, 'Margin changed', startHistory(base).present)
    expect(back.past).toEqual([])
  })

  it('keeps the most recent edits only', () => {
    let h = startHistory(base)
    for (let m = 1; m <= HISTORY_LIMIT + 20; m++) h = record(h, margin(m), 'Margin changed')
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.past[0]!.design).toEqual(margin(20))
  })
})
