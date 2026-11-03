/**
 * Snapping for Customize (S6a, ADR-0022): while a photo is dragged or resized, its edges and centre are pulled onto
 * nearby canvas edges and centre lines and onto other photos' edges and centres, and the lines it lands on are
 * returned so the editor can show them. Pure, in canvas pixels, so it is tested without a screen.
 */

import type { Rect } from '../layout'

export interface Guide {
  /** 'x': a vertical line at that x. 'y': a horizontal line at that y. */
  axis: 'x' | 'y'
  at: number
}

// The lines a rectangle can snap to along one axis: the canvas's start, centre and end, and every other photo's.
function lines(size: number, others: readonly Rect[], axis: 'x' | 'y'): number[] {
  const start = (r: Rect) => (axis === 'x' ? r.x : r.y)
  const length = (r: Rect) => (axis === 'x' ? r.width : r.height)
  return [0, size / 2, size, ...others.flatMap((r) => [start(r), start(r) + length(r) / 2, start(r) + length(r)])]
}

// The smallest shift (within `threshold`) that puts one of `points` on one of `targets`, or none.
function nearest(points: number[], targets: number[], threshold: number): { shift: number; at: number } | null {
  let best: { shift: number; at: number } | null = null
  for (const p of points) {
    for (const t of targets) {
      const shift = t - p
      if (Math.abs(shift) <= threshold && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { shift, at: t }
    }
  }
  return best
}

/** Snaps a moved rectangle: its left, centre or right onto a line across, and its top, middle or bottom onto one down. */
export function snapMove(rect: Rect, others: readonly Rect[], canvas: { width: number; height: number }, threshold: number): { rect: Rect; guides: Guide[] } {
  const guides: Guide[] = []
  const x = nearest([rect.x, rect.x + rect.width / 2, rect.x + rect.width], lines(canvas.width, others, 'x'), threshold)
  const y = nearest([rect.y, rect.y + rect.height / 2, rect.y + rect.height], lines(canvas.height, others, 'y'), threshold)
  if (x) guides.push({ axis: 'x', at: x.at })
  if (y) guides.push({ axis: 'y', at: y.at })
  return { rect: { ...rect, x: rect.x + (x?.shift ?? 0), y: rect.y + (y?.shift ?? 0) }, guides }
}

/** Snaps a resized rectangle (dragged by its bottom-right corner): its right and bottom edges onto nearby lines. */
export function snapResize(rect: Rect, others: readonly Rect[], canvas: { width: number; height: number }, threshold: number): { rect: Rect; guides: Guide[] } {
  const guides: Guide[] = []
  const x = nearest([rect.x + rect.width], lines(canvas.width, others, 'x'), threshold)
  const y = nearest([rect.y + rect.height], lines(canvas.height, others, 'y'), threshold)
  if (x) guides.push({ axis: 'x', at: x.at })
  if (y) guides.push({ axis: 'y', at: y.at })
  return { rect: { ...rect, width: rect.width + (x?.shift ?? 0), height: rect.height + (y?.shift ?? 0) }, guides }
}
