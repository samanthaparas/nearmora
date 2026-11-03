/**
 * The ten playful four-photo layouts (phase S4c), the quartet versions of the playful pairs: tilted postcards, film,
 * torn paper, arches, stationery, colour blocks, tape, labels, circles and a ticket. Like every template, each is a
 * pure function of the canvas size and spacing, so it works at every sharing and print size. Written from the layout
 * guide's descriptions, not traced from the concept board.
 */

import type { Rect } from '../layout'
import { CARD_PAD, filmStrip, inner, overhang, tape, type Size, type Spacing } from './playful'
import { art, arch, ART, circle, COLORS, filledArt, grow, roundedRect, ticket, torn, type Decor } from './scene'
import type { Slot, TemplateDefinition } from './templates'

const unitOf = (canvas: Size) => Math.min(canvas.width, canvas.height)

/**
 * Four photos of one shape (`aspect` = width / height), as large as they fit in `room`: two by two, or in one row
 * or one column when the canvas is long enough for that to give clearly bigger photos (25% or more). `below` is room kept under each photo
 * (for a label). Returned in reading order; the group is centred.
 */
export function quad(room: Rect, gap: number, aspect: number, below = 0): Rect[] {
  const options = ([[2, 2], [4, 1], [1, 4]] as const).map(([cols, rows]) => {
    const width = Math.max(0, Math.min((room.width - (cols - 1) * gap) / cols, ((room.height - (rows - 1) * gap) / rows - below) * aspect))
    return { cols, rows, width }
  })
  const { cols, rows, width } = options.reduce((best, o) => (o.width > best.width * 1.25 ? o : best))
  const height = width / aspect
  const left = room.x + (room.width - (cols * width + (cols - 1) * gap)) / 2
  const top = room.y + (room.height - (rows * (height + below) + (rows - 1) * gap)) / 2
  return Array.from({ length: 4 }, (_, i) => ({
    x: left + (i % cols) * (width + gap),
    y: top + Math.floor(i / cols) * (height + below + gap),
    width,
    height,
  }))
}

/** Something decorations must stay clear of: a photo's footprint (round for circle photos), or a caption's box. */
export interface KeepOut {
  rect: Rect
  round?: boolean
}

// The upright box a photo takes on the canvas once its card is added and it's turned.
function footprint(slot: Slot): Rect {
  const card = slot.frame ? grow(slot.rect, slot.frame.pad) : slot.rect
  const o = overhang(card.width, card.height, slot.rotation ?? 0)
  return { x: card.x - o.x, y: card.y - o.y, width: card.width + 2 * o.x, height: card.height + 2 * o.y }
}

export const keepOutOf = (slots: readonly Slot[]): KeepOut[] => slots.map((slot) => ({ rect: footprint(slot), round: slot.mask === circle(slot.rect) }))

function clearOf(box: Rect, keepOut: readonly KeepOut[], gap: number): boolean {
  return keepOut.every(({ rect, round }) => {
    const r = grow(rect, gap)
    if (round) {
      // The point of the box nearest the circle's centre must be outside the circle.
      const [cx, cy, radius] = [r.x + r.width / 2, r.y + r.height / 2, r.width / 2]
      const nx = Math.max(box.x, Math.min(cx, box.x + box.width))
      const ny = Math.max(box.y, Math.min(cy, box.y + box.height))
      return Math.hypot(nx - cx, ny - cy) >= radius
    }
    return box.x + box.width <= r.x || r.x + r.width <= box.x || box.y + box.height <= r.y || r.y + r.height <= box.y
  })
}

/**
 * Finds a place for a piece of line art that touches no photo, caption or earlier art: tries each preferred spot
 * (as fractions of the canvas) at the largest size first, shrinking down to `min`. Art that can't fit is left out,
 * so decorations never cover a photo at any size. A placed piece is added to `keepOut` so the next one avoids it.
 */
export function placeArt(canvas: Size, keepOut: KeepOut[], spots: ReadonlyArray<readonly [number, number]>, max: number, min: number, rotate: number) {
  const t = (rotate * Math.PI) / 180
  const turn = Math.abs(Math.cos(t)) + Math.abs(Math.sin(t)) // art is drawn in a square box; this is its turned extent
  const gap = 0.01 * unitOf(canvas)
  const edge = 0.025 * unitOf(canvas) // art never touches the canvas edge
  for (let size = max; size >= min - 1e-9; size *= 0.85) {
    const half = (size / 2) * turn
    if (2 * (half + edge) > Math.min(canvas.width, canvas.height)) continue
    for (const [fx, fy] of spots) {
      const x = Math.min(Math.max(fx * canvas.width, half + edge), canvas.width - half - edge)
      const y = Math.min(Math.max(fy * canvas.height, half + edge), canvas.height - half - edge)
      const box = { x: x - half, y: y - half, width: 2 * half, height: 2 * half }
      if (clearOf(box, keepOut, gap)) {
        keepOut.push({ rect: box })
        return { x, y, size }
      }
    }
  }
  return null
}

// Spots to try for art, in order: the four corners, then the middle of each side.
export const CORNERS = [[1, 0], [0, 1], [1, 1], [0, 0], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]] as const

// The box a caption can take: up to `maxLines` lines below its first baseline, `maxWidth` wide around its anchor.
function captionBox(x: number, y: number, size: number, maxWidth: number, maxLines: number, align: 'start' | 'middle'): Rect {
  return { x: align === 'middle' ? x - maxWidth / 2 : x, y: y - size, width: maxWidth, height: size * (1.25 + 1.2 * (maxLines - 1)) }
}

const caption = (text: string, size: number, maxWidth: number, maxLines: number, x: number, y: number, rotate = 0): Decor => ({
  type: 'text',
  canvas: 0,
  text,
  size,
  maxWidth,
  maxLines,
  align: 'middle',
  color: COLORS.plum,
  at: { x, y, rotate, scale: 1 },
})

// ---- Postcard stack: four tilted prints on white cards, and a postmark. ----

const STACK_TILT = [-5, 4, 3, -4] as const

// Four 4 : 3 photos on cards, each centred in the box its turned card takes. Shared with Travel scrapbook.
function cardGeometry(room: Rect, gap: number, tilts: readonly number[]): Slot[] {
  const steepest = Math.max(...tilts.map(Math.abs))
  const card = { width: 1 + 2 * CARD_PAD, height: 0.75 + 2 * CARD_PAD }
  const o = overhang(card.width, card.height, steepest)
  const k = { width: card.width + 2 * o.x, height: card.height + 2 * o.y } // per pixel of photo width
  return quad(room, gap, k.width / k.height).map((cell, i): Slot => {
    const w = cell.width / k.width
    const h = 0.75 * w
    return { canvas: 0, rect: { x: cell.x + (cell.width - w) / 2, y: cell.y + (cell.height - h) / 2, width: w, height: h }, rotation: tilts[i]!, frame: { pad: w * CARD_PAD, color: COLORS.card } }
  })
}

const postcardStack: TemplateDefinition = {
  id: 'quartet-postcard-stack',
  version: 1,
  name: 'Postcard stack',
  description: 'Four tilted prints and a postmark',
  mode: 'single',
  style: 'playful',
  photos: { min: 4, max: 4 },
  defaults: { margin: 80, gutter: 30 },
  slots: (canvas, spacing) => cardGeometry(inner(canvas, spacing), spacing.gutter, STACK_TILT),
  decor(canvas, spacing) {
    const unit = unitOf(canvas)
    const keepOut = keepOutOf(cardGeometry(inner(canvas, spacing), spacing.gutter, STACK_TILT))
    const over: Decor[] = []
    const mark = placeArt(canvas, keepOut, CORNERS, 0.2 * unit, 0.1 * unit, -8)
    if (mark) over.push(art(0, ART.postmark, mark.x, mark.y, mark.size, COLORS.plum, -8))
    return { under: [], over }
  },
}

// ---- Film weekend: four frames on film, as two strips side by side or one long strip, with sprocket holes. ----

function filmGeometry(canvas: Size, spacing: Spacing) {
  const box = inner(canvas, spacing)
  const gap = spacing.gutter
  // Lengths in units of the strip's width: a pad, then each frame (0.525 long) followed by a pad.
  const along = (frames: number) => 0.07 + frames * 0.595
  // Two strips of two (upright or lying), or one strip of four: whichever gives the biggest frames.
  const options = [
    { strips: 2, down: true, across: Math.min((box.width - gap) / 2, box.height / along(2)) },
    { strips: 2, down: false, across: Math.min(box.width / along(2), (box.height - gap) / 2) },
    { strips: 1, down: false, across: Math.min(box.height, box.width / along(4)) },
    { strips: 1, down: true, across: Math.min(box.width, box.height / along(4)) },
  ]
  const { strips, down, across } = options.reduce((best, o) => (o.across > best.across ? o : best))
  const perStrip = 4 / strips
  const length = across * along(perStrip)
  const total = { width: down ? strips * across + (strips - 1) * gap : length, height: down ? length : strips * across + (strips - 1) * gap }
  const origin = { x: box.x + (box.width - total.width) / 2, y: box.y + (box.height - total.height) / 2 }
  const stripRects = Array.from({ length: strips }, (_, s): Rect =>
    down
      ? { x: origin.x + s * (across + gap), y: origin.y, width: across, height: length }
      : { x: origin.x, y: origin.y + s * (across + gap), width: length, height: across },
  )
  const frameLong = 0.7 * across
  const frameShort = frameLong * 0.75
  const frames = stripRects.flatMap((strip) =>
    Array.from({ length: perStrip }, (_, i): Rect => {
      const offset = 0.07 * across + i * (frameShort + 0.07 * across)
      return down
        ? { x: strip.x + (across - frameLong) / 2, y: strip.y + offset, width: frameLong, height: frameShort }
        : { x: strip.x + offset, y: strip.y + (across - frameLong) / 2, width: frameShort, height: frameLong }
    }),
  )
  // Reading order: across the top first when the strips stand side by side.
  const ordered = down && strips === 2 ? [frames[0]!, frames[2]!, frames[1]!, frames[3]!] : frames
  return { stripRects, frames: ordered, down, across }
}

const filmWeekend: TemplateDefinition = {
  id: 'quartet-film-weekend',
  version: 1,
  name: 'Film weekend',
  description: 'Four frames on film with sprocket holes',
  mode: 'single',
  style: 'playful',
  photos: { min: 4, max: 4 },
  defaults: { margin: 70, gutter: 40 },
  slots: (canvas, spacing) => filmGeometry(canvas, spacing).frames.map((rect): Slot => ({ canvas: 0, rect })),
  decor(canvas, spacing) {
    const { stripRects, down, across } = filmGeometry(canvas, spacing)
    return { under: stripRects.map((strip): Decor => ({ type: 'shape', canvas: 0, d: filmStrip(strip, down, across), fill: COLORS.film, fillRule: 'evenodd' })), over: [] }
  },
}

// ---- Torn journal: four photos torn from a page, each on a torn white sheet, with a handwritten note. ----

function journalGeometry(canvas: Size, spacing: Spacing) {
  const box = inner(canvas, spacing)
  const unit = unitOf(canvas)
  const paper = 0.022 * unit
  const band = 0.17 * unit // the note's row, below the photos
  const room = { x: box.x + paper, y: box.y + paper, width: box.width - 2 * paper, height: box.height - 2 * paper - band }
  const photos = quad(room, spacing.gutter + 2 * paper, 1)
  const bottom = Math.max(...photos.map((p) => p.y + p.height)) + paper
  return { unit, paper, photos, note: { x: box.x + box.width / 2, y: bottom + 0.075 * unit, width: Math.min(box.width * 0.8, 0.8 * unit) } }
}

const tornJournal: TemplateDefinition = {
  id: 'quartet-torn-journal',
  version: 1,
  name: 'Torn journal',
  description: 'Four torn-edge prints and a handwritten note',
  mode: 'single',
  style: 'playful',
  photos: { min: 4, max: 4 },
  defaults: { margin: 70, gutter: 20 },
  captions: [{ id: 'note', label: 'Note', default: 'Good people,\nbrighter days' }],
  slots(canvas, spacing) {
    const { photos, unit } = journalGeometry(canvas, spacing)
    return photos.map((rect, i): Slot => ({ canvas: 0, rect, mask: torn(rect, 21 + i, 0.012 * unit, 0.022 * unit) }))
  },
  decor(canvas, spacing, text) {
    const { photos, unit, paper, note } = journalGeometry(canvas, spacing)
    const under = photos.map((rect, i): Decor => ({ type: 'shape', canvas: 0, d: torn(grow(rect, paper), 51 + i, 0.014 * unit, 0.02 * unit), fill: COLORS.card }))
    const size = 0.055 * unit
    const keepOut: KeepOut[] = [...photos.map((rect) => ({ rect: grow(rect, paper) })), { rect: captionBox(note.x, note.y, size, note.width, 2, 'middle') }]
    const over: Decor[] = []
    const words = text('note')
    if (words) over.push(caption(words, size, note.width, 2, note.x, note.y))
    const sprig = placeArt(canvas, keepOut, [[1, 1], [0, 1], [1, 0], [0, 0]], 0.14 * unit, 0.08 * unit, 15)
    if (sprig) over.push(art(0, ART.sprig, sprig.x, sprig.y, sprig.size, COLORS.plum, 15))
    return { under, over }
  },
}

// ---- Garden windows: four arched windows with fine outlines and climbing sprigs. ----

function gardenGeometry(canvas: Size, spacing: Spacing) {
  return quad(inner(canvas, spacing), spacing.gutter, 0.62)
}

const gardenWindows: TemplateDefinition = {
  id: 'quartet-garden-windows',
  version: 1,
  name: 'Garden windows',
  description: 'Four arched windows with climbing sprigs',
  mode: 'single',
  style: 'playful',
  photos: { min: 4, max: 4 },
  defaults: { margin: 100, gutter: 40 },
  slots: (canvas, spacing) => gardenGeometry(canvas, spacing).map((rect): Slot => ({ canvas: 0, rect, mask: arch(rect) })),
  decor(canvas, spacing) {
    const arches = gardenGeometry(canvas, spacing)
    const unit = unitOf(canvas)
    const ring = 0.012 * unit
    const under = arches.map((r): Decor => ({ type: 'shape', canvas: 0, d: arch(grow(r, ring)), stroke: { color: COLORS.plum, width: 0.0025 * unit } }))
    const keepOut = arches.map((rect) => ({ rect: grow(rect, ring) }))
    const over: Decor[] = []
    // Sprigs climb up the sides, where the arches leave room.
    for (const [spots, rotate] of [[[[0, 0.55], [0, 0.85], [0.5, 1]], -10], [[[1, 0.3], [1, 0.1], [0.5, 0]], 170]] as const) {
      const sprig = placeArt(canvas, keepOut, spots, 0.15 * unit, 0.07 * unit, rotate)
      if (sprig) over.push(art(0, ART.sprig, sprig.x, sprig.y, sprig.size, COLORS.plum, rotate))
    }
    return { under, over }
  },
}

// ---- Love notes: four small prints on stationery, an envelope behind, a handwritten note and a wax seal. ----

const NOTE_TILT = [-3, 2, 2, -3] as const

function notesGeometry(canvas: Size, spacing: Spacing) {
  const box = inner(canvas, spacing)
  const unit = unitOf(canvas)
  const sheet: Rect = { x: box.x, y: box.y + 0.05 * unit, width: box.width - 0.05 * unit, height: box.height - 0.05 * unit }
  const pad = 0.05 * unit
  const inside = grow(sheet, -pad)
  // The note sits beside the prints, or below them on tall canvases.
  const below = canvas.height > canvas.width * 1.15
  const share = below ? 0.22 : 0.3
  const noteArea: Rect = below
    ? { x: inside.x, y: inside.y + inside.height * (1 - share), width: inside.width, height: inside.height * share }
    : { x: inside.x, y: inside.y, width: inside.width * share, height: inside.height }
  const room: Rect = below
    ? { x: inside.x, y: inside.y, width: inside.width, height: inside.height * (1 - share) - pad / 2 }
    : { x: inside.x + inside.width * share + pad / 2, y: inside.y, width: inside.width * (1 - share) - pad / 2, height: inside.height }
  // Prints are tilted a little, so each is shrunk to keep its turned card inside its own cell.
  const framePad = 0.012 * unit
  const photos = quad(room, spacing.gutter, 0.85).map((cell) => grow(cell, -(framePad + 0.025 * cell.width)))
  return { box, unit, sheet, noteArea, photos, framePad }
}

// A wax seal: a filled disc with a heart pressed into it, drawn in the 100-unit art box.
const SEAL = circle({ x: -45, y: -45, width: 90, height: 90 })

const loveNotes: TemplateDefinition = {
  id: 'quartet-love-notes',
  version: 1,
  name: 'Love notes',
  description: 'Four prints on stationery, a note and a seal',
  mode: 'single',
  style: 'playful',
  photos: { min: 4, max: 4 },
  defaults: { margin: 60, gutter: 20, background: COLORS.blush },
  captions: [{ id: 'note', label: 'Note', default: 'Same places,\nbrighter people' }],
  slots(canvas, spacing) {
    const { photos, framePad } = notesGeometry(canvas, spacing)
    return photos.map((rect, i): Slot => ({ canvas: 0, rect, rotation: NOTE_TILT[i]!, frame: { pad: framePad, color: COLORS.card } }))
  },
  decor(canvas, spacing, text) {
    const { box, unit, sheet, noteArea, photos, framePad } = notesGeometry(canvas, spacing)
    const envelope: Rect = { x: box.x + 0.08 * unit, y: box.y, width: box.width - 0.08 * unit, height: Math.min(box.height * 0.5, 0.5 * unit) }
    const flap = `M${envelope.x} ${envelope.y}L${envelope.x + envelope.width / 2} ${envelope.y + envelope.height * 0.55}L${envelope.x + envelope.width} ${envelope.y}`
    const under: Decor[] = [
      { type: 'shape', canvas: 0, d: roundedRect(envelope, 0.01 * unit), fill: COLORS.envelope },
      { type: 'shape', canvas: 0, d: flap, stroke: { color: COLORS.paper, width: 0.004 * unit } },
      { type: 'shape', canvas: 0, d: roundedRect(sheet, 0.006 * unit), fill: COLORS.paper },
    ]
    const size = Math.min(0.06 * unit, noteArea.height / 3.5)
    const width = noteArea.width * 0.85
    const at = { x: noteArea.x + noteArea.width / 2, y: noteArea.y + Math.min(noteArea.height * 0.3, noteArea.height / 2 - size * 1.2) + size }
    const keepOut: KeepOut[] = [
      ...keepOutOf(photos.map((rect, i): Slot => ({ canvas: 0, rect, rotation: NOTE_TILT[i]!, frame: { pad: framePad, color: COLORS.card } }))),
      { rect: grow(captionBox(at.x, at.y, size, width, 3, 'middle'), 0.02 * unit) },
    ]
    const over: Decor[] = []
    const words = text('note')
    if (words) over.push(caption(words, size, width, 3, at.x, at.y, -5))
    const seal = placeArt(canvas, keepOut, [[0.25, 0.9], [0.1, 0.9], [1, 1], [0, 1]], 0.11 * unit, 0.06 * unit, 0)
    if (seal) over.push(filledArt(0, SEAL, seal.x, seal.y, seal.size, COLORS.plum), filledArt(0, ART.heart, seal.x, seal.y + seal.size * 0.04, seal.size * 0.45, COLORS.blush))
    const heart = placeArt(canvas, keepOut, [[1, 0], [0.9, 0.08], [0, 0]], 0.05 * unit, 0.03 * unit, 0)
    if (heart) over.push(filledArt(0, ART.heart, heart.x, heart.y, heart.size, COLORS.plum))
    return { under, over }
  },
}

// ---- Color play: four framed photos, each on its own soft colour block. ----

const BLOCKS = [COLORS.blush, COLORS.lilac, COLORS.sage, COLORS.envelope] as const

function colorGeometry(canvas: Size, spacing: Spacing) {
  const unit = unitOf(canvas)
  const blocks = quad(inner(canvas, spacing), spacing.gutter, 0.85)
  return { unit, blocks, photos: blocks.map((b) => grow(b, -0.11 * Math.min(b.width, b.height))), framePad: 0.01 * unit }
}

const colorPlay: TemplateDefinition = {
  id: 'quartet-color-play',
  version: 1,
  name: 'Color play',
  description: 'Four framed photos on soft colour blocks',
  mode: 'single',
  style: 'playful',
  photos: { min: 4, max: 4 },
  defaults: { margin: 70, gutter: 0 },
  slots(canvas, spacing) {
    const { photos, framePad } = colorGeometry(canvas, spacing)
    return photos.map((rect): Slot => ({ canvas: 0, rect, frame: { pad: framePad, color: COLORS.card } }))
  },
  decor(canvas, spacing) {
    const { unit, blocks, photos, framePad } = colorGeometry(canvas, spacing)
    const under = blocks.map((rect, i): Decor => ({ type: 'shape', canvas: 0, d: roundedRect(rect, 0.008 * unit), fill: BLOCKS[i]!, opacity: 0.75 }))
    // Sprigs may sit on the colour blocks, never on a photo.
    const keepOut = photos.map((rect) => ({ rect: grow(rect, framePad) }))
    const over: Decor[] = []
    for (const [spots, rotate] of [[[[1, 0.5], [0.5, 1], [1, 1]], 20], [[[0, 0.5], [0.5, 0], [0, 0]], -160]] as const) {
      const sprig = placeArt(canvas, keepOut, spots, 0.13 * unit, 0.06 * unit, rotate)
      if (sprig) over.push(art(0, ART.sprig, sprig.x, sprig.y, sprig.size, COLORS.plum, rotate))
    }
    return { under, over }
  },
}

// ---- Travel scrapbook: four tilted prints held on with tape, a note, sprigs and a heart. ----

const SCRAP_TILT = [-3, 3, 4, -2] as const
const TAPES = [[COLORS.blush, -6], [COLORS.sage, 5], [COLORS.lilac, -4], [COLORS.envelope, 6]] as const

function travelGeometry(canvas: Size, spacing: Spacing) {
  const box = inner(canvas, spacing)
  const unit = unitOf(canvas)
  const band = 0.15 * unit // the note's row, below the prints
  // Room above each card for its tape, which reaches past the card's top edge.
  const top = 0.03 * unit
  const slots = cardGeometry({ x: box.x, y: box.y + top, width: box.width, height: box.height - band - top }, spacing.gutter + top, SCRAP_TILT)
  const bottom = Math.max(...slots.map((s) => footprint(s).y + footprint(s).height))
  return { unit, box, slots, note: { x: box.x + box.width / 2, y: bottom + 0.075 * unit, width: Math.min(box.width * 0.7, 0.7 * unit) } }
}

const travelScrapbook: TemplateDefinition = {
  id: 'quartet-travel-scrapbook',
  version: 1,
  name: 'Travel scrapbook',
  description: 'Four taped prints with a note and sprigs',
  mode: 'single',
  style: 'playful',
  photos: { min: 4, max: 4 },
  defaults: { margin: 70, gutter: 40 },
  captions: [{ id: 'note', label: 'Note', default: 'Collect kinder days' }],
  slots: (canvas, spacing) => travelGeometry(canvas, spacing).slots,
  decor(canvas, spacing, text) {
    const { unit, slots, note } = travelGeometry(canvas, spacing)
    const size = 0.055 * unit
    const keepOut: KeepOut[] = [...keepOutOf(slots), { rect: captionBox(note.x, note.y, size, note.width, 1, 'middle') }]
    const over: Decor[] = slots.map((slot, i) => tape(slot.rect, slot.frame!.pad, slot.rotation!, TAPES[i]![0], TAPES[i]![1]))
    const words = text('note')
    if (words) over.push(caption(words, size, note.width, 1, note.x, note.y, -2))
    const sprig = placeArt(canvas, keepOut, [[0, 1], [1, 1], [0, 0.5], [1, 0.5]], 0.15 * unit, 0.07 * unit, -10)
    if (sprig) over.push(art(0, ART.sprig, sprig.x, sprig.y, sprig.size, COLORS.plum, -10))
    const heart = placeArt(canvas, keepOut, [[1, 0], [0, 0], [1, 1]], 0.05 * unit, 0.03 * unit, 0)
    if (heart) over.push(filledArt(0, ART.heart, heart.x, heart.y, heart.size, COLORS.blush))
    return { under: [], over }
  },
}

// ---- Four seasons: four photos, each with a label on a strip of coloured paper below it. ----

const SEASONS = [
  { id: 'first', label: 'First label', default: 'spring', color: COLORS.blush },
  { id: 'second', label: 'Second label', default: 'summer', color: COLORS.sage },
  { id: 'third', label: 'Third label', default: 'autumn', color: COLORS.envelope },
  { id: 'fourth', label: 'Fourth label', default: 'winter', color: COLORS.lilac },
] as const

function seasonsGeometry(canvas: Size, spacing: Spacing) {
  const unit = unitOf(canvas)
  const below = 0.11 * unit
  return { unit, photos: quad(inner(canvas, spacing), spacing.gutter, 0.9, below), below }
}

const fourSeasons: TemplateDefinition = {
  id: 'quartet-four-seasons',
  version: 1,
  name: 'Four seasons',
  description: 'Four photos, each with its own label',
  mode: 'single',
  style: 'playful',
  photos: { min: 4, max: 4 },
  defaults: { margin: 70, gutter: 30 },
  captions: SEASONS.map(({ id, label, default: words }) => ({ id, label, default: words })),
  slots: (canvas, spacing) => seasonsGeometry(canvas, spacing).photos.map((rect): Slot => ({ canvas: 0, rect })),
  decor(canvas, spacing, text) {
    const { unit, photos, below } = seasonsGeometry(canvas, spacing)
    const over: Decor[] = []
    for (const [i, season] of SEASONS.entries()) {
      const photo = photos[i]!
      const centre = { x: photo.x + photo.width / 2, y: photo.y + photo.height + below * 0.5 }
      const strip = Math.min(photo.width * 0.7, 0.32 * unit)
      const depth = Math.min(below * 0.6, 0.07 * unit)
      over.push({ type: 'shape', canvas: 0, d: roundedRect({ x: centre.x - strip / 2, y: centre.y - depth / 2, width: strip, height: depth }, 0.004 * unit), fill: season.color, opacity: 0.8 })
      const words = text(season.id)
      if (words) over.push(caption(words, Math.min(0.05 * unit, depth * 0.8), strip * 0.92, 1, centre.x, centre.y + depth * 0.22))
    }
    return { under: [], over }
  },
}

// ---- Circle collection: four circular photos with sprigs in the spaces between them. ----

function circlesGeometry(canvas: Size, spacing: Spacing) {
  return quad(inner(canvas, spacing), spacing.gutter, 1)
}

const circleCollection: TemplateDefinition = {
  id: 'quartet-circle-collection',
  version: 1,
  name: 'Circle collection',
  description: 'Four circular photos with sprigs between',
  mode: 'single',
  style: 'playful',
  photos: { min: 4, max: 4 },
  defaults: { margin: 70, gutter: 30 },
  slots: (canvas, spacing) => circlesGeometry(canvas, spacing).map((rect): Slot => ({ canvas: 0, rect, mask: circle(rect) })),
  decor(canvas, spacing) {
    const circles = circlesGeometry(canvas, spacing)
    const unit = unitOf(canvas)
    const keepOut = circles.map((rect) => ({ rect, round: true }))
    const over: Decor[] = []
    // The heart of the grid first (the space the four circles leave in the middle), then the corners.
    for (const [spots, rotate] of [[[[0.5, 0.5]], 0], [[[1, 0], [0, 1]], -30], [[[0, 1], [1, 1], [1, 0]], 150]] as const) {
      const sprig = placeArt(canvas, keepOut, spots, 0.14 * unit, 0.06 * unit, rotate)
      if (sprig) over.push(art(0, ART.sprig, sprig.x, sprig.y, sprig.size, COLORS.plum, rotate))
    }
    return { under: [], over }
  },
}

// ---- Keepsake ticket: four photos inside a notched ticket, with a title above and a note below. ----

function keepsakeGeometry(canvas: Size, spacing: Spacing) {
  const box = inner(canvas, spacing)
  const unit = unitOf(canvas)
  const pad = 0.05 * unit
  const head = 0.12 * unit
  const foot = 0.1 * unit
  const photos = quad({ x: box.x + pad, y: box.y + head, width: box.width - 2 * pad, height: box.height - head - foot }, spacing.gutter, 0.85)
  const left = Math.min(...photos.map((p) => p.x))
  const right = Math.max(...photos.map((p) => p.x + p.width))
  const top = Math.min(...photos.map((p) => p.y))
  const bottom = Math.max(...photos.map((p) => p.y + p.height))
  const outline: Rect = { x: left - pad, y: top - head, width: right - left + 2 * pad, height: bottom - top + head + foot }
  return { unit, outline, photos, width: right - left, title: top - head * 0.38, note: bottom + foot * 0.6 }
}

const keepsakeTicket: TemplateDefinition = {
  id: 'quartet-keepsake-ticket',
  version: 1,
  name: 'Keepsake ticket',
  description: 'Four photos inside a ticket, with a title and a note',
  mode: 'single',
  style: 'playful',
  photos: { min: 4, max: 4 },
  defaults: { margin: 60, gutter: 20, background: COLORS.blush },
  captions: [
    { id: 'title', label: 'Title', default: 'Our little escape' },
    { id: 'note', label: 'Note', default: 'Good people, brighter days' },
  ],
  slots: (canvas, spacing) => keepsakeGeometry(canvas, spacing).photos.map((rect): Slot => ({ canvas: 0, rect })),
  decor(canvas, spacing, text) {
    const { unit, outline, width, title, note } = keepsakeGeometry(canvas, spacing)
    const notch = 0.05 * unit
    const under: Decor[] = [
      { type: 'shape', canvas: 0, d: ticket(outline, notch), fill: COLORS.paper },
      { type: 'shape', canvas: 0, d: ticket(grow(outline, -0.02 * unit), notch), stroke: { color: COLORS.plum, width: 0.0025 * unit } },
    ]
    const centre = outline.x + outline.width / 2
    const over: Decor[] = []
    const heading = text('title')
    if (heading) over.push(caption(heading, 0.055 * unit, width, 1, centre, title))
    const words = text('note')
    if (words) over.push(caption(words, 0.04 * unit, width, 1, centre, note))
    return { under, over }
  },
}

// In the order of the concept board.
export const PLAYFUL_QUARTETS: readonly TemplateDefinition[] = [
  postcardStack,
  filmWeekend,
  tornJournal,
  gardenWindows,
  loveNotes,
  colorPlay,
  travelScrapbook,
  fourSeasons,
  circleCollection,
  keepsakeTicket,
]
