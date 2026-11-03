/**
 * How a seamless carousel's one wide design is cut into slides (phase S5, ADR-0021), and where a photo meets a cut.
 * The export cuts with these widths and the editor draws its cut guides from the same numbers, so what the person
 * sees divided on screen is exactly how the files divide.
 */

import type { Composition } from './compose'

/**
 * Whole-pixel slice widths that always add up to `width`: each slice is `floor(width / count)` wide, and the first
 * `width % count` slices get one pixel more. Cutting each slice by rounding its own share could leave a pixel over or
 * missing between slides, which is what shows as a thin line when the slides are swiped.
 */
export function sliceWidths(width: number, count: number): number[] {
  if (!Number.isInteger(width) || !Number.isInteger(count) || width < count || count < 1) throw new Error(`Can't cut ${width} px into ${count} slices`)
  const base = Math.floor(width / count)
  const extra = width % count
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0))
}

/** The x position of each cut between slides, left to right (one fewer than the slices). */
export function cutPositions(width: number, count: number): number[] {
  const widths = sliceWidths(width, count)
  return widths.slice(0, -1).map((_, i) => widths.slice(0, i + 1).reduce((sum, w) => sum + w, 0))
}

/** Closer than this to a cut (in reference pixels on a 1080 slide), an edge may show as a sliver on the next slide. */
export const NEAR_CUT = 12

export interface SeamNote {
  slot: number
  /** 'crosses': the photo runs over the cut. 'near': one of its edges sits just beside it. */
  kind: 'crosses' | 'near'
  /** Which cut, counting from 1 between slides 1 and 2. */
  cut: number
}

/**
 * Photos that meet a cut. Apps show slides with a small gap between them, so a photo running across a cut may not
 * line up perfectly, and an edge just beside one can leave a sliver on the neighbouring slide. Facts, not judgements:
 * crossing a cut is what a seamless carousel is for.
 */
export function seamNotes(composition: Composition): SeamNote[] {
  if (composition.slices < 2) return []
  // Reference pixels scale with the slide's shorter side, as every other spacing does.
  const near = (NEAR_CUT * Math.min(composition.height, composition.width / composition.slices)) / 1080
  const notes: SeamNote[] = []
  cutPositions(Math.round(composition.width), composition.slices).forEach((x, i) => {
    for (const e of composition.elements) {
      const left = e.rect.x
      const right = e.rect.x + e.rect.width
      if (left < x - near && right > x + near) notes.push({ slot: e.slot, kind: 'crosses', cut: i + 1 })
      else if (Math.abs(left - x) <= near || Math.abs(right - x) <= near) notes.push({ slot: e.slot, kind: 'near', cut: i + 1 })
    }
  })
  return notes
}
