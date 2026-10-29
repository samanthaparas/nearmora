/**
 * Memory Studio layout math, shared by the on-screen preview (renderer) and the export (main process), so what
 * the person sees is computed exactly the way the exported file is (AC7). Plain functions, no dependencies.
 */

export type ProjectKind = 'collage_2' | 'collage_4' | 'carousel'
export type Aspect = '1:1' | '4:5'
export type Background = 'cream' | 'white'

/** Bump when any rule below changes, so saved projects record which layout they were made with. */
export const LAYOUT_VERSION = 1

/** Output size in pixels (blueprint: square 1080×1080, portrait 1080×1350). */
export const CANVAS: Record<Aspect, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
}

export const BACKGROUND_COLOR: Record<Background, string> = { cream: '#f8f0e8', white: '#ffffff' }

/** How many photos each kind takes. */
export const PHOTO_COUNT: Record<ProjectKind, { min: number; max: number }> = {
  collage_2: { min: 2, max: 2 },
  collage_4: { min: 4, max: 4 },
  carousel: { min: 2, max: 10 },
}

// Collages leave a margin around the edge and a gap between photos, in output pixels.
const MARGIN = 48
const GAP = 24

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Where each photo goes on one canvas. A carousel slide is one photo filling the whole canvas. */
export function cells(kind: ProjectKind, aspect: Aspect): Rect[] {
  const { width, height } = CANVAS[aspect]
  if (kind === 'carousel') return [{ x: 0, y: 0, width, height }]
  const columns = 2
  const rows = kind === 'collage_4' ? 2 : 1
  const cellWidth = (width - 2 * MARGIN - (columns - 1) * GAP) / columns
  const cellHeight = (height - 2 * MARGIN - (rows - 1) * GAP) / rows
  const result: Rect[] = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      result.push({ x: MARGIN + column * (cellWidth + GAP), y: MARGIN + row * (cellHeight + GAP), width: cellWidth, height: cellHeight })
    }
  }
  return result
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

/** Which canvas (output file) and which cell on it each photo goes to, in order. */
export function placements(kind: ProjectKind, aspect: Aspect, photoCount: number): Array<{ canvas: number; cell: Rect }> {
  const layout = cells(kind, aspect)
  return Array.from({ length: photoCount }, (_, index) =>
    kind === 'carousel' ? { canvas: index, cell: layout[0]! } : { canvas: 0, cell: layout[index % layout.length]! },
  )
}

/** Number of output files: one for a collage, one per photo for a carousel. */
export const canvasCount = (kind: ProjectKind, photoCount: number): number => (kind === 'carousel' ? photoCount : 1)
