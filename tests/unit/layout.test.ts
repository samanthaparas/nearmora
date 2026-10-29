/**
 * Unit tests for the shared Memory Studio layout math: canvas sizes, cell placement, and crops that always cover
 * their cell without going past the photo's edges. Preview and export both depend on these numbers (AC7).
 */

import { describe, expect, it } from 'vitest'
import { CANVAS, canvasCount, cells, clampCrop, DEFAULT_CROP, placements, sourceRect } from '../../src/shared/layout'

describe('canvases and cells', () => {
  it('uses the blueprint sizes: 1080×1080 square and 1080×1350 portrait', () => {
    expect(CANVAS['1:1']).toEqual({ width: 1080, height: 1080 })
    expect(CANVAS['4:5']).toEqual({ width: 1080, height: 1350 })
  })

  it('lays out two and four photos with even margins and gaps, inside the canvas', () => {
    for (const aspect of ['1:1', '4:5'] as const) {
      for (const kind of ['collage_2', 'collage_4'] as const) {
        const rects = cells(kind, aspect)
        expect(rects).toHaveLength(kind === 'collage_2' ? 2 : 4)
        const { width, height } = CANVAS[aspect]
        // A 48 px margin on every side...
        expect(Math.min(...rects.map((r) => r.x))).toBeCloseTo(48, 6)
        expect(Math.min(...rects.map((r) => r.y))).toBeCloseTo(48, 6)
        expect(Math.max(...rects.map((r) => r.x + r.width))).toBeCloseTo(width - 48, 6)
        expect(Math.max(...rects.map((r) => r.y + r.height))).toBeCloseTo(height - 48, 6)
        // ...and a 24 px gap between neighbouring photos.
        const [first, second] = rects
        expect(second!.x - (first!.x + first!.width)).toBeCloseTo(24, 6)
        // All cells are the same size.
        expect(new Set(rects.map((r) => `${r.width}x${r.height}`)).size).toBe(1)
      }
    }
  })

  it('gives a carousel one full-canvas photo per slide', () => {
    expect(cells('carousel', '4:5')).toEqual([{ x: 0, y: 0, width: 1080, height: 1350 }])
    expect(placements('carousel', '4:5', 3).map((p) => p.canvas)).toEqual([0, 1, 2])
    expect(canvasCount('carousel', 7)).toBe(7)
    expect(canvasCount('collage_4', 4)).toBe(1)
  })
})

describe('crops', () => {
  const landscape = { width: 4000, height: 3000 }
  const tallCell = { width: 468, height: 984 }

  it('at zoom 1 the photo just covers the cell, centred, keeping its proportions', () => {
    const rect = sourceRect(landscape, tallCell, DEFAULT_CROP)
    expect(rect.height).toBeCloseTo(3000, 6) // the full height is used
    expect(rect.width / rect.height).toBeCloseTo(468 / 984, 6) // same shape as the cell: no stretching
    expect(rect.x + rect.width / 2).toBeCloseTo(2000, 6)
  })

  it('never shows past an edge, however far the centre is pushed', () => {
    for (const crop of [
      { cx: -5, cy: 0.5, zoom: 1 },
      { cx: 5, cy: 5, zoom: 2 },
      { cx: 0, cy: 0, zoom: 4 },
    ]) {
      const rect = sourceRect(landscape, tallCell, crop)
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(4000 + 1e-9)
      expect(rect.y + rect.height).toBeLessThanOrEqual(3000 + 1e-9)
    }
  })

  it('zooming in shows a smaller part of the photo, and zoom is limited to 1–4', () => {
    const one = sourceRect(landscape, tallCell, { ...DEFAULT_CROP, zoom: 1 })
    const two = sourceRect(landscape, tallCell, { ...DEFAULT_CROP, zoom: 2 })
    expect(two.width).toBeCloseTo(one.width / 2, 6)
    expect(sourceRect(landscape, tallCell, { ...DEFAULT_CROP, zoom: 9 })).toEqual(sourceRect(landscape, tallCell, { ...DEFAULT_CROP, zoom: 4 }))
    expect(sourceRect(landscape, tallCell, { ...DEFAULT_CROP, zoom: 0.2 })).toEqual(one)
  })

  it('clampCrop returns the centre that is actually shown, so stored crops never drift past an edge', () => {
    const clamped = clampCrop(landscape, tallCell, { cx: 1, cy: 0.5, zoom: 1 })
    const rect = sourceRect(landscape, tallCell, clamped)
    expect(rect.x + rect.width).toBeCloseTo(4000, 6)
    expect(clampCrop(landscape, tallCell, clamped)).toEqual(clamped) // already clamped: unchanged
  })
})
