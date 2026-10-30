/**
 * Memory Studio crop math, shared by the on-screen preview (renderer) and the export (main process), so what the
 * person sees is computed exactly the way the exported file is (AC7). Where photos go is decided by the templates in
 * shared/studio; this file decides which part of each photo fills its place. Plain functions, no dependencies.
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
