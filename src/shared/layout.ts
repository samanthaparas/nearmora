/**
 * Memory Studio crop math, shared by the on-screen preview (renderer) and the export (main process), so what the
 * person sees is computed exactly the way the exported file is (AC7). Where photos go is decided by the templates in
 * shared/studio; this file decides which part of each photo fills its place, and where its border goes. Plain functions, no dependencies.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** How a photo sits in its cell: the point of the photo at the cell's centre (0–1 across and down) and a zoom (1 = just fills). */
export interface Crop {
  cx: number
  cy: number
  zoom: number
}

/** Fill covers the photo's place (cropping the photo); fit shows the whole photo inside it. */
export type Fit = 'fill' | 'fit'

export const DEFAULT_CROP: Crop = { cx: 0.5, cy: 0.5, zoom: 1 }
export const MAX_ZOOM = 4

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * The part of the photo (in the photo's own pixels) that fills the cell. The photo always covers the cell
 * completely: zoom 1 is the smallest scale that leaves no gaps, and the visible area never goes past an edge.
 */
export function sourceRect(image: { width: number; height: number }, cell: { width: number; height: number }, crop: Crop): Rect {
  const scale = Math.max(cell.width / image.width, cell.height / image.height) * clamp(crop.zoom, 1, MAX_ZOOM)
  const width = Math.min(image.width, cell.width / scale)
  const height = Math.min(image.height, cell.height / scale)
  const centerX = clamp(crop.cx * image.width, width / 2, image.width - width / 2)
  const centerY = clamp(crop.cy * image.height, height / 2, image.height - height / 2)
  return { x: centerX - width / 2, y: centerY - height / 2, width, height }
}

/**
 * The same crop, moved to where it actually ends up: a centre that would push the visible area past an edge is
 * pulled back. The editor stores this, so arrow-key moves never "build up" invisibly beyond the edge.
 */
export function clampCrop(image: { width: number; height: number }, cell: { width: number; height: number }, crop: Crop): Crop {
  const rect = sourceRect(image, cell, crop)
  return {
    cx: (rect.x + rect.width / 2) / image.width,
    cy: (rect.y + rect.height / 2) / image.height,
    zoom: clamp(crop.zoom, 1, MAX_ZOOM),
  }
}

/** Where one photo is drawn: its border (if any), the part of the photo used, and where that part goes on the canvas. */
export interface Placement {
  frame: Rect | null
  src: Rect
  dest: Rect
}

const inset = (rect: Rect, by: number): Rect => ({ x: rect.x + by, y: rect.y + by, width: rect.width - 2 * by, height: rect.height - 2 * by })

// A border can never swallow the photo: at most a quarter of the cell's shorter side.
const borderFor = (cell: Rect, borderWidth: number) => clamp(borderWidth, 0, Math.min(cell.width, cell.height) / 4)

/**
 * Places a photo in its cell. With fill, the border lines the cell and the photo fills what's inside it (using the
 * crop). With fit, the whole photo is centred inside the cell and the border hugs the photo, so it frames the picture
 * rather than empty space. The preview and the export both call this, so they agree on every edge.
 */
export function placePhoto(image: { width: number; height: number }, cell: Rect, crop: Crop, fit: Fit, borderWidth: number): Placement {
  const border = borderFor(cell, borderWidth)
  const inner = inset(cell, border)
  if (fit === 'fill') return { frame: border > 0 ? cell : null, src: sourceRect(image, inner, crop), dest: inner }
  const scale = Math.min(inner.width / image.width, inner.height / image.height)
  const width = image.width * scale
  const height = image.height * scale
  const dest = { x: inner.x + (inner.width - width) / 2, y: inner.y + (inner.height - height) / 2, width, height }
  return { frame: border > 0 ? inset(dest, -border) : null, src: { x: 0, y: 0, width: image.width, height: image.height }, dest }
}

/** The area a filled photo's crop is measured against: the cell inside its border. The editor clamps crops with it. */
export function photoArea(cell: Rect, borderWidth: number): Rect {
  return inset(cell, borderFor(cell, borderWidth))
}
