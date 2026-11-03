/**
 * The non-photo parts of a Memory Studio design, and how photos can be shaped: vector shapes, line art, captions,
 * photo masks (circle, arch), tilted photos and postcard-style cards. Everything is vector path data in canvas pixels,
 * which the preview (browser canvas) and the export (SVG rendered by sharp) both draw the same way (ADR-0017).
 * All artwork here is original, drawn as code for Nearmora.
 */

import type { Rect } from '../layout'
import type { Align } from './text'

/** Move to (x, y), then turn by `rotate` degrees, then scale: the same order on the canvas and in SVG. */
export interface Transform {
  x: number
  y: number
  rotate: number
  scale: number
}

export type Decor =
  /** `fillRule: 'evenodd'` lets a shape have holes cut in it, such as a film strip's sprocket holes. */
  | { type: 'shape'; canvas: number; d: string; fill?: string; fillRule?: 'evenodd'; stroke?: { color: string; width: number }; at?: Transform }
  /** One line of caption text, drawn as letter outlines; `at` places its baseline anchor. */
  | { type: 'text'; canvas: number; text: string; size: number; maxWidth: number; align: Align; color: string; at: Transform }

export const COLORS = { cream: '#f8f0e8', plum: '#5b414b', blush: '#e8b7b0', lilac: '#b9a4c8', sage: '#b8bda6', film: '#3a2a30', card: '#ffffff' } as const

const n = (v: number) => Math.round(v * 100) / 100

/** A rectangle with rounded corners. */
export function roundedRect(r: Rect, radius: number): string {
  const k = Math.min(radius, r.width / 2, r.height / 2)
  const [x, y, w, h] = [r.x, r.y, r.width, r.height].map(n) as [number, number, number, number]
  const c = n(k)
  return `M${n(x + c)} ${y}H${n(x + w - c)}A${c} ${c} 0 0 1 ${n(x + w)} ${n(y + c)}V${n(y + h - c)}A${c} ${c} 0 0 1 ${n(x + w - c)} ${n(y + h)}H${n(x + c)}A${c} ${c} 0 0 1 ${x} ${n(y + h - c)}V${n(y + c)}A${c} ${c} 0 0 1 ${n(x + c)} ${y}Z`
}

/** A window arch: a rectangle whose top is a half circle as wide as the rectangle. */
export function arch(r: Rect): string {
  const radius = r.width / 2
  return `M${n(r.x)} ${n(r.y + r.height)}V${n(r.y + radius)}A${n(radius)} ${n(radius)} 0 0 1 ${n(r.x + r.width)} ${n(r.y + radius)}V${n(r.y + r.height)}Z`
}

/** The largest circle centred in a rectangle. */
export function circle(r: Rect): string {
  const radius = Math.min(r.width, r.height) / 2
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  return `M${n(cx - radius)} ${n(cy)}A${n(radius)} ${n(radius)} 0 1 0 ${n(cx + radius)} ${n(cy)}A${n(radius)} ${n(radius)} 0 1 0 ${n(cx - radius)} ${n(cy)}Z`
}

/** A rectangle grown (or shrunk, if `by` is negative) on every side. */
export const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by })

/**
 * Line art, drawn in a 100 × 100 box around (0, 0) and placed with a Transform. Strokes are 2.4 units wide before
 * scaling. These shapes were drawn for Nearmora; none is copied from the concept boards.
 */
export const ART = {
  /** A small botanical sprig: one curved stem and three leaves. */
  sprig: 'M-30 45C-15 10 5-15 35-38M-12 18C-26 12-31-1-29-14C-17-7-11 5-12 18M2 0C16-4 27-13 31-27C17-25 6-14 2 0M14-12C5-24 3-36 6-47C15-38 18-26 14-12',
  /** A filled heart. */
  heart: 'M0 30C-28 10-40-4-40-18C-40-32-28-40-18-40C-9-40-3-34 0-27C3-34 9-40 18-40C28-40 40-32 40-18C40-4 28 10 0 30Z',
  /** A round postmark with wavy cancellation lines to its left. */
  postmark:
    'M30 0A20 20 0 1 0 -10 0A20 20 0 1 0 30 0M24 0A14 14 0 1 0 -4 0A14 14 0 1 0 24 0M-50-12C-44-16-38-8-32-12C-26-16-20-8-14-12M-50 0C-44-4-38 4-32 0C-26-4-20 4-14 0M-50 12C-44 8-38 16-32 12C-26 8-20 16-14 12',
} as const

/** Line art at a centre point and size (the width of its 100-unit box, in canvas pixels). */
export function art(canvas: number, d: string, cx: number, cy: number, size: number, color: string, rotate = 0): Decor {
  return { type: 'shape', canvas, d, stroke: { color, width: 2.4 }, at: { x: cx, y: cy, rotate, scale: size / 100 } }
}

/** A filled piece of art (such as a heart) at a centre point and size. */
export function filledArt(canvas: number, d: string, cx: number, cy: number, size: number, color: string, rotate = 0): Decor {
  return { type: 'shape', canvas, d, fill: color, at: { x: cx, y: cy, rotate, scale: size / 100 } }
}
