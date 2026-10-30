/**
 * Unit tests for the shared Memory Studio crop math: crops that always cover their cell without going past the
 * photo's edges. Preview and export both depend on these numbers (AC7). Placement is tested in studio-compose.test.ts.
 */

import { describe, expect, it } from 'vitest'
import { clampCrop, DEFAULT_CROP, sourceRect } from '../../src/shared/layout'

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
