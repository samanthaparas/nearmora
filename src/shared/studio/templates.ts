/**
 * Built-in Memory Studio templates. Each one is a small, pure function from a canvas size and settings to photo
 * slots, so one definition serves every format. Definitions never change once shipped: a changed layout gets a
 * new version, and a project keeps opening with the version it was made with.
 */

import type { Rect } from '../layout'
import { PLAYFUL_TEMPLATES } from './playful'
import { PLAYFUL_QUARTETS } from './playful-quartets'
import type { Decor } from './scene'

/** Single: one image. Carousel: one image per photo, in order. (Seamless carousels arrive in phase S5.) */
export type Mode = 'single' | 'carousel'

/** Where one photo goes: which output canvas, and its rectangle there in canvas pixels. */
export interface Slot {
  canvas: number
  rect: Rect
  /** Degrees clockwise, around the rectangle's centre (playful layouts tilt some photos). */
  rotation?: number
  /** A shape the photo is cut to (SVG path in canvas pixels), such as a circle or an arch. */
  mask?: string
  /** A card behind the photo, `pad` pixels wider on every side, turned with it (a printed-photo look). */
  frame?: { pad: number; color: string }
}

/** A caption a template offers; the person can change or clear its text. */
export interface CaptionSlot {
  id: string
  /** What the editor calls it, such as "Caption". */
  label: string
  default: string
}

export interface TemplateDefinition {
  id: string
  version: number
  name: string
  /** One short line for the template picker. */
  description: string
  mode: Mode
  photos: { min: number; max: number }
  /** Margin and gutter in reference pixels (see params.ts); a playful layout may also have its own background. */
  defaults: { margin: number; gutter: number; background?: string }
  /** `margin` and `gutter` here are already scaled to this canvas. */
  slots(canvas: { width: number; height: number }, spacing: { margin: number; gutter: number }, photoCount: number): Slot[]
  /** Playful layouts add shapes, line art and captions; everyday layouts have only photos. */
  style?: 'playful'
  captions?: CaptionSlot[]
  /** Drawn below the photos (`under`) and above them (`over`), in canvas pixels. `text` gives each caption's words. */
  decor?(canvas: { width: number; height: number }, spacing: { margin: number; gutter: number }, text: (id: string) => string): { under: Decor[]; over: Decor[] }
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

type Size = { width: number; height: number }
type Spacing = { margin: number; gutter: number }
const slot = (x: number, y: number, width: number, height: number): Slot => ({ canvas: 0, rect: { x, y, width, height } })

// The area inside the margin.
const inner = (canvas: Size, spacing: Spacing) => ({
  x: spacing.margin,
  y: spacing.margin,
  width: canvas.width - 2 * spacing.margin,
  height: canvas.height - 2 * spacing.margin,
})

// Photos in one row (`across`) or one column, each limited to a shape (width ÷ height) and the group centred.
// Used where the board shows portraits in a row or landscapes in a column, whatever the canvas shape.
function band(canvas: Size, spacing: Spacing, count: number, across: boolean, maxRatio: number, minRatio: number): Slot[] {
  const box = inner(canvas, spacing)
  const along = ((across ? box.width : box.height) - (count - 1) * spacing.gutter) / count
  // Each cell's other side: as long as the box allows, but within the shape limits.
  const cross = across ? Math.min(box.height, along / minRatio) : Math.min(box.width, along * maxRatio)
  const cellWidth = across ? Math.min(along, cross * maxRatio) : cross
  const cellHeight = across ? cross : Math.min(along, cross / minRatio)
  const total = count * (across ? cellWidth : cellHeight) + (count - 1) * spacing.gutter
  const start = (across ? box.x + (box.width - total) / 2 : box.y + (box.height - total) / 2)
  return Array.from({ length: count }, (_, i) =>
    across
      ? slot(start + i * (cellWidth + spacing.gutter), box.y + (box.height - cellHeight) / 2, cellWidth, cellHeight)
      : slot(box.x + (box.width - cellWidth) / 2, start + i * (cellHeight + spacing.gutter), cellWidth, cellHeight),
  )
}

// One large photo beside (`side`) or above (`top`) a run of smaller ones that share the rest of the space.
function leadAnd(canvas: Size, spacing: Spacing, others: number, share: number, placement: 'side' | 'top'): Slot[] {
  const box = inner(canvas, spacing)
  if (placement === 'side') {
    const leadWidth = (box.width - spacing.gutter) * share
    const restWidth = box.width - spacing.gutter - leadWidth
    const restHeight = (box.height - (others - 1) * spacing.gutter) / others
    return [
      slot(box.x, box.y, leadWidth, box.height),
      ...Array.from({ length: others }, (_, i) => slot(box.x + leadWidth + spacing.gutter, box.y + i * (restHeight + spacing.gutter), restWidth, restHeight)),
    ]
  }
  const leadHeight = (box.height - spacing.gutter) * share
  const restHeight = box.height - spacing.gutter - leadHeight
  const restWidth = (box.width - (others - 1) * spacing.gutter) / others
  return [
    slot(box.x, box.y, box.width, leadHeight),
    ...Array.from({ length: others }, (_, i) => slot(box.x + i * (restWidth + spacing.gutter), box.y + leadHeight + spacing.gutter, restWidth, restHeight)),
  ]
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
    id: 'pair-wide-gutter',
    version: 1,
    name: 'Wide gutter',
    description: 'Two photos side by side with generous space between',
    mode: 'single',
    photos: { min: 2, max: 2 },
    defaults: { margin: 72, gutter: 120 },
    slots: (canvas, spacing) => grid(canvas, spacing, 2, 1),
  },
  {
    id: 'pair-quiet-frame',
    version: 1,
    name: 'Quiet frame',
    description: 'Two stacked photos inside a broad mat',
    mode: 'single',
    photos: { min: 2, max: 2 },
    defaults: { margin: 140, gutter: 24 },
    slots: (canvas, spacing) => grid(canvas, spacing, 1, 2),
  },
  {
    id: 'pair-tall-detail',
    version: 1,
    name: 'Tall + detail',
    description: 'One main photo with a smaller companion',
    mode: 'single',
    photos: { min: 2, max: 2 },
    defaults: { margin: 56, gutter: 32 },
    // The main photo takes 60% of the width and the full height; the detail is 60% as tall, centred beside it.
    slots: (canvas, spacing) => {
      const box = inner(canvas, spacing)
      const mainWidth = (box.width - spacing.gutter) * 0.6
      const detailHeight = box.height * 0.6
      return [
        slot(box.x, box.y, mainWidth, box.height),
        slot(box.x + mainWidth + spacing.gutter, box.y + (box.height - detailHeight) / 2, box.width - spacing.gutter - mainWidth, detailHeight),
      ]
    },
  },
  {
    id: 'pair-landscape-pair',
    version: 1,
    name: 'Landscape pair',
    description: 'Two wide scenes, one above the other, with generous spacing',
    mode: 'single',
    photos: { min: 2, max: 2 },
    defaults: { margin: 72, gutter: 64 },
    // Each photo stays at least 3:2 wide; on a tall canvas the pair is centred with space above and below.
    slots: (canvas, spacing) => band(canvas, spacing, 2, false, 3, 1.5),
  },
  {
    id: 'pair-offset',
    version: 1,
    name: 'Offset pair',
    description: 'Two photos set diagonally, without overlapping',
    mode: 'single',
    photos: { min: 2, max: 2 },
    defaults: { margin: 64, gutter: 32 },
    // Each photo is 62% of the width: one at the top left, one at the bottom right.
    slots: (canvas, spacing) => {
      const box = inner(canvas, spacing)
      const width = box.width * 0.62
      const height = (box.height - spacing.gutter) / 2
      return [slot(box.x, box.y, width, height), slot(box.x + box.width - width, box.y + height + spacing.gutter, width, height)]
    },
  },
  {
    id: 'pair-full-bleed',
    version: 1,
    name: 'Full bleed pair',
    description: 'Two halves filling the whole canvas, no border',
    mode: 'single',
    photos: { min: 2, max: 2 },
    defaults: { margin: 0, gutter: 0 },
    slots: (canvas, spacing) => grid(canvas, spacing, 2, 1),
  },
  {
    id: 'quartet-gallery-mat',
    version: 1,
    name: 'Gallery mat',
    description: 'Four photos in a grid with a broad outer mat',
    mode: 'single',
    photos: { min: 4, max: 4 },
    defaults: { margin: 140, gutter: 24 },
    slots: (canvas, spacing) => grid(canvas, spacing, 2, 2),
  },
  {
    id: 'quartet-four-across',
    version: 1,
    name: 'Four across',
    description: 'Four tall photos in one row',
    mode: 'single',
    photos: { min: 4, max: 4 },
    defaults: { margin: 48, gutter: 20 },
    // Portrait-shaped cells (between 2:3 and 4:5), the row centred on the canvas.
    slots: (canvas, spacing) => band(canvas, spacing, 4, true, 0.8, 0.5),
  },
  {
    id: 'quartet-four-stories',
    version: 1,
    name: 'Four stories',
    description: 'Four wide photos in one column',
    mode: 'single',
    photos: { min: 4, max: 4 },
    defaults: { margin: 48, gutter: 20 },
    // Landscape-shaped strips (at least 2:1), the column centred on the canvas.
    slots: (canvas, spacing) => band(canvas, spacing, 4, false, 6, 2),
  },
  {
    id: 'quartet-lead-three',
    version: 1,
    name: 'Lead + three',
    description: 'One large photo on the left, three stacked on the right',
    mode: 'single',
    photos: { min: 4, max: 4 },
    defaults: { margin: 48, gutter: 24 },
    slots: (canvas, spacing) => leadAnd(canvas, spacing, 3, 0.64, 'side'),
  },
  {
    id: 'quartet-top-story',
    version: 1,
    name: 'Top story',
    description: 'One wide photo above three smaller ones',
    mode: 'single',
    photos: { min: 4, max: 4 },
    defaults: { margin: 48, gutter: 24 },
    slots: (canvas, spacing) => leadAnd(canvas, spacing, 3, 0.6, 'top'),
  },
  {
    id: 'quartet-quiet-columns',
    version: 1,
    name: 'Quiet columns',
    description: 'Two columns of two, with a generous gutter',
    mode: 'single',
    photos: { min: 4, max: 4 },
    defaults: { margin: 72, gutter: 32 },
    // The space between the columns is three times the space between rows.
    slots: (canvas, spacing) => {
      const box = inner(canvas, spacing)
      const columnGap = spacing.gutter * 3
      const width = (box.width - columnGap) / 2
      const height = (box.height - spacing.gutter) / 2
      return [0, 1].flatMap((column) => [0, 1].map((row) => slot(box.x + column * (width + columnGap), box.y + row * (height + spacing.gutter), width, height)))
    },
  },
  {
    id: 'quartet-offset-grid',
    version: 1,
    name: 'Offset grid',
    description: 'Four photos in a staggered grid, without overlapping',
    mode: 'single',
    photos: { min: 4, max: 4 },
    defaults: { margin: 56, gutter: 24 },
    // The right column starts lower than the left, by 12% of the height; both columns are the same height.
    slots: (canvas, spacing) => {
      const box = inner(canvas, spacing)
      const drop = box.height * 0.12
      const width = (box.width - spacing.gutter) / 2
      const height = (box.height - drop - spacing.gutter) / 2
      return [0, 1].flatMap((column) =>
        [0, 1].map((row) => slot(box.x + column * (width + spacing.gutter), box.y + column * drop + row * (height + spacing.gutter), width, height)),
      )
    },
  },
  {
    id: 'quartet-wide-tall',
    version: 1,
    name: 'Wide + tall',
    description: 'Two wide photos in one column, two taller ones in the other',
    mode: 'single',
    photos: { min: 4, max: 4 },
    defaults: { margin: 48, gutter: 24 },
    // The left column takes 62% of the width, so its photos are wider than the right column's.
    slots: (canvas, spacing) => {
      const box = inner(canvas, spacing)
      const leftWidth = (box.width - spacing.gutter) * 0.62
      const rightWidth = box.width - spacing.gutter - leftWidth
      const height = (box.height - spacing.gutter) / 2
      return [0, 1].flatMap((column) =>
        [0, 1].map((row) =>
          slot(box.x + column * (leftWidth + spacing.gutter), box.y + row * (height + spacing.gutter), column === 0 ? leftWidth : rightWidth, height),
        ),
      )
    },
  },
  {
    id: 'quartet-edge-to-edge',
    version: 1,
    name: 'Edge to edge',
    description: 'Four photos filling the whole canvas, no border',
    mode: 'single',
    photos: { min: 4, max: 4 },
    defaults: { margin: 0, gutter: 0 },
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
  ...PLAYFUL_TEMPLATES,
  ...PLAYFUL_QUARTETS,
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
