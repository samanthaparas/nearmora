/**
 * Built-in Memory Studio templates. Each one is a small, pure function from a canvas size and settings to photo
 * slots, so one definition serves every format. Definitions never change once shipped: a changed layout gets a
 * new version, and a project keeps opening with the version it was made with.
 */

import type { Rect } from '../layout'

/** Single: one image. Carousel: one image per photo, in order. (Seamless carousels arrive in phase S5.) */
export type Mode = 'single' | 'carousel'

/** Where one photo goes: which output canvas, and its rectangle there in canvas pixels. */
export interface Slot {
  canvas: number
  rect: Rect
}

export interface TemplateDefinition {
  id: string
  version: number
  name: string
  /** One short line for the template picker. */
  description: string
  mode: Mode
  photos: { min: number; max: number }
  /** Margin and gutter in reference pixels (see params.ts). */
  defaults: { margin: number; gutter: number }
  /** `margin` and `gutter` here are already scaled to this canvas. */
  slots(canvas: { width: number; height: number }, spacing: { margin: number; gutter: number }, photoCount: number): Slot[]
}

// Equal cells in rows and columns, inside the margin and separated by the gutter. Left to right, then top to bottom.
function grid(canvas: { width: number; height: number }, spacing: { margin: number; gutter: number }, columns: number, rows: number): Slot[] {
  const width = (canvas.width - 2 * spacing.margin - (columns - 1) * spacing.gutter) / columns
  const height = (canvas.height - 2 * spacing.margin - (rows - 1) * spacing.gutter) / rows
  const slots: Slot[] = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      slots.push({
        canvas: 0,
        rect: { x: spacing.margin + column * (width + spacing.gutter), y: spacing.margin + row * (height + spacing.gutter), width, height },
      })
    }
  }
  return slots
}

// The first versions of Equal split, Classic grid and Carousel reproduce Studio Lite's layouts exactly
// (48 px margin, 24 px gutter), so projects made before templates existed look the same after the upgrade.
export const TEMPLATES: readonly TemplateDefinition[] = [
  {
    id: 'pair-equal-split',
    version: 1,
    name: 'Equal split',
    description: 'Two photos side by side, the same size',
    mode: 'single',
    photos: { min: 2, max: 2 },
    defaults: { margin: 48, gutter: 24 },
    slots: (canvas, spacing) => grid(canvas, spacing, 2, 1),
  },
  {
    id: 'pair-stacked',
    version: 1,
    name: 'Stacked',
    description: 'Two photos, one above the other',
    mode: 'single',
    photos: { min: 2, max: 2 },
    defaults: { margin: 48, gutter: 24 },
    slots: (canvas, spacing) => grid(canvas, spacing, 1, 2),
  },
  {
    id: 'quartet-classic-grid',
    version: 1,
    name: 'Classic grid',
    description: 'Four photos in two rows of two',
    mode: 'single',
    photos: { min: 4, max: 4 },
    defaults: { margin: 48, gutter: 24 },
    slots: (canvas, spacing) => grid(canvas, spacing, 2, 2),
  },
  {
    id: 'carousel-full',
    version: 1,
    name: 'Carousel',
    description: 'One photo per slide, filling it',
    mode: 'carousel',
    photos: { min: 2, max: 10 },
    defaults: { margin: 0, gutter: 0 },
    slots: (canvas, _spacing, photoCount) =>
      Array.from({ length: photoCount }, (_, index) => ({ canvas: index, rect: { x: 0, y: 0, width: canvas.width, height: canvas.height } })),
  },
]

/** A template by id and version, or undefined if this version of the app doesn't know it. */
export const findTemplate = (id: string, version: number): TemplateDefinition | undefined =>
  TEMPLATES.find((t) => t.id === id && t.version === version)

/** A template's name for display, even when this version of the app doesn't know it. */
export const templateName = (id: string, version: number): string => findTemplate(id, version)?.name ?? 'Unknown layout'

/** The newest version of each template, for starting new projects. */
export function latestTemplates(): TemplateDefinition[] {
  const newest = new Map<string, TemplateDefinition>()
  for (const t of TEMPLATES) if ((newest.get(t.id)?.version ?? 0) < t.version) newest.set(t.id, t)
  return [...newest.values()]
}

/** Templates a new project can start from with this many photos. */
export const templatesFor = (photoCount: number): TemplateDefinition[] =>
  latestTemplates().filter((t) => photoCount >= t.photos.min && photoCount <= t.photos.max)
