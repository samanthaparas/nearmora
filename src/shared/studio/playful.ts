/**
 * Playful Memory Studio layouts (phase S4): photos cut to shapes, tilted on cards or set in a film strip, with
 * original line art and editable captions. Like every template, each is a pure function of the canvas size and
 * spacing, so it works at every sharing and print size. Written from the layout guide's descriptions, not traced
 * from the concept boards.
 */

import type { Rect } from '../layout'
import { art, arch, ART, circle, COLORS, filledArt, grow, polygon, roundedRect, ticket, torn, type Decor } from './scene'
import type { Slot, TemplateDefinition } from './templates'

type Size = { width: number; height: number }
type Spacing = { margin: number; gutter: number }

const inner = (canvas: Size, spacing: Spacing): Rect => ({
  x: spacing.margin,
  y: spacing.margin,
  width: canvas.width - 2 * spacing.margin,
  height: canvas.height - 2 * spacing.margin,
})

// How far a rectangle sticks out past its own edges, sideways and up/down, once turned by `degrees`.
function overhang(width: number, height: number, degrees: number): { x: number; y: number } {
  const t = (Math.abs(degrees) * Math.PI) / 180
  return {
    x: (width * Math.cos(t) + height * Math.sin(t) - width) / 2,
    y: (width * Math.sin(t) + height * Math.cos(t) - height) / 2,
  }
}

const tall = (canvas: Size) => canvas.height >= canvas.width * 0.9

// ---- Postcards: two tilted prints on white cards, a handwritten caption and a postmark. ----

const POSTCARD_TILT = [-4, 5] as const
const CARD_PAD = 0.04 // of the photo's width

// Two photo cards placed diagonally (stacked on tall canvases, side by side otherwise), with `band` (a share of the
// shorter side) kept free for a caption. Shared by Postcards, Scrapbook and Colorblock.
function postcardGeometry(canvas: Size, spacing: Spacing, band0 = 0.18, tilts: readonly [number, number] = POSTCARD_TILT) {
  const box = inner(canvas, spacing)
  const unit = Math.min(canvas.width, canvas.height)
  const band = band0 * unit // room for a caption (two lines on Postcards)
  // The size a card takes once padded and turned, for a photo `w` wide (photos are 4 : 3 landscape).
  const extent = (w: number, tilt: number) => {
    const card = { width: w * (1 + 2 * CARD_PAD), height: w * 0.75 + 2 * w * CARD_PAD }
    const o = overhang(card.width, card.height, tilt)
    return { width: card.width + 2 * o.x, height: card.height + 2 * o.y }
  }
  const steepest = Math.max(Math.abs(tilts[0]), Math.abs(tilts[1]))
  const k = { width: extent(1, steepest).width, height: extent(1, steepest).height } // per pixel of photo width
  const stacked = tall(canvas)
  // Stacked: two cards and the caption band down the page, each card up to 70% of the width. Side by side otherwise.
  const w = stacked
    ? Math.min((0.7 * box.width) / k.width, (box.height - band - spacing.gutter) / (2 * k.height))
    : Math.min((0.7 * box.height) / k.height, (box.width - spacing.gutter) / (2 * k.width), (box.height - band) / k.height)
  const card = { width: k.width * w, height: k.height * w }
  const h = 0.75 * w
  // Each photo rectangle is centred in the space its turned card takes.
  const place = (left: number, top: number): Rect => ({ x: left + (card.width - w) / 2, y: top + (card.height - h) / 2, width: w, height: h })
  if (stacked) {
    const top = box.y + (box.height - (2 * card.height + spacing.gutter + band)) / 2
    const a = place(box.x, top)
    const b = place(box.x + box.width - card.width, top + card.height + spacing.gutter)
    // The caption's first baseline sits just below the second card.
    return { a, b, caption: { x: box.x + 0.04 * box.width, y: top + 2 * card.height + spacing.gutter + band * 0.42, width: box.width * 0.9, align: 'start' as const }, unit, box, card }
  }
  const left = box.x + (box.width - (2 * card.width + spacing.gutter)) / 2
  const a = place(left, box.y)
  const b = place(left + card.width + spacing.gutter, box.y + box.height - card.height)
  return { a, b, caption: { x: left + card.width / 2, y: box.y + card.height + band * 0.42, width: card.width, align: 'middle' as const }, unit, box, card }
}

const postcards: TemplateDefinition = {
  id: 'pair-postcards',
  version: 1,
  name: 'Postcards',
  description: 'Two tilted prints, a caption and a postmark',
  mode: 'single',
  style: 'playful',
  photos: { min: 2, max: 2 },
  defaults: { margin: 80, gutter: 40 },
  captions: [{ id: 'caption', label: 'Caption', default: 'Good food, happier people' }],
  slots(canvas, spacing) {
    const { a, b } = postcardGeometry(canvas, spacing)
    const frame = { pad: a.width * CARD_PAD, color: COLORS.card }
    return [
      { canvas: 0, rect: a, rotation: POSTCARD_TILT[0], frame },
      { canvas: 0, rect: b, rotation: POSTCARD_TILT[1], frame },
    ]
  },
  decor(canvas, spacing, text) {
    const { a, caption, unit, box } = postcardGeometry(canvas, spacing)
    const over: Decor[] = []
    const words = text('caption')
    if (words) over.push({ type: 'text', canvas: 0, text: words, size: 0.065 * unit, maxWidth: caption.width, maxLines: 2, align: caption.align, color: COLORS.plum, at: { x: caption.x, y: caption.y, rotate: -3, scale: 1 } })
    // The postmark sits in the corner the first card leaves free.
    const size = Math.min(0.2 * unit, box.x + box.width - (a.x + a.width) - 0.02 * unit)
    if (size > 0.08 * unit) over.push(art(0, ART.postmark, box.x + box.width - size * 0.32, a.y + size * 0.3, size, COLORS.plum, -8))
    return { under: [], over }
  },
}

// ---- Film night: two frames on a strip of film with sprocket holes. ----

function filmGeometry(canvas: Size, spacing: Spacing) {
  const box = inner(canvas, spacing)
  const down = tall(canvas)
  // Proportions of the strip's width (its short side): frames 70%, edge bands 12% each, padding 7%.
  const along = 0.14 + 2 * 0.7 * 0.75 + 0.07
  const across = down ? Math.min(box.width, box.height / along) : Math.min(box.height, box.width / along)
  const strip: Rect = down
    ? { x: box.x + (box.width - across) / 2, y: box.y + (box.height - across * along) / 2, width: across, height: across * along }
    : { x: box.x + (box.width - across * along) / 2, y: box.y + (box.height - across) / 2, width: across * along, height: across }
  const frameLong = 0.7 * across
  const frameShort = frameLong * 0.75
  const frames: Rect[] = [0, 1].map((i) => {
    const offset = 0.07 * across + i * (frameShort + 0.07 * across)
    return down
      ? { x: strip.x + (across - frameLong) / 2, y: strip.y + offset, width: frameLong, height: frameShort }
      : { x: strip.x + offset, y: strip.y + (across - frameLong) / 2, width: frameShort, height: frameLong }
  })
  return { strip, frames, down, across }
}

// The strip with its sprocket holes cut out (even-odd fill), so the background shows through whatever its colour.
function filmStrip(strip: Rect, down: boolean, across: number): string {
  const band = 0.12 * across
  const length = down ? strip.height : strip.width
  const pitch = band * 1.05
  const count = Math.floor((length - band * 0.4) / pitch)
  const start = (length - count * pitch) / 2 + (pitch - band * 0.55) / 2
  let d = roundedRect(strip, 0.015 * across)
  for (const edge of [0, 1]) {
    for (let i = 0; i < count; i++) {
      const along = start + i * pitch
      const side = edge === 0 ? (band - band * 0.42) / 2 : across - band + (band - band * 0.42) / 2
      const hole: Rect = down
        ? { x: strip.x + side, y: strip.y + along, width: band * 0.42, height: band * 0.55 }
        : { x: strip.x + along, y: strip.y + side, width: band * 0.55, height: band * 0.42 }
      d += roundedRect(hole, band * 0.1)
    }
  }
  return d
}

const filmNight: TemplateDefinition = {
  id: 'pair-film-night',
  version: 1,
  name: 'Film night',
  description: 'Two frames on a strip of film',
  mode: 'single',
  style: 'playful',
  photos: { min: 2, max: 2 },
  defaults: { margin: 70, gutter: 0 },
  slots(canvas, spacing) {
    return filmGeometry(canvas, spacing).frames.map((rect): Slot => ({ canvas: 0, rect }))
  },
  decor(canvas, spacing) {
    const { strip, down, across } = filmGeometry(canvas, spacing)
    return { under: [{ type: 'shape', canvas: 0, d: filmStrip(strip, down, across), fill: COLORS.film, fillRule: 'evenodd' }], over: [] }
  },
}

// ---- Window light: two arched windows with a fine outline and a sprig. ----

function windowGeometry(canvas: Size, spacing: Spacing) {
  const box = inner(canvas, spacing)
  const width = Math.min((box.width - spacing.gutter) / 2, box.height * 0.6)
  // Arches are 0.6 as wide as tall, or as tall as 0.5 on tall canvases, so they use the height they're given.
  const height = Math.min(box.height, width / 0.5)
  const left = box.x + (box.width - (2 * width + spacing.gutter)) / 2
  const top = box.y + (box.height - height) / 2
  return { box, arches: [0, 1].map((i): Rect => ({ x: left + i * (width + spacing.gutter), y: top, width, height })) }
}

const windowLight: TemplateDefinition = {
  id: 'pair-window-light',
  version: 1,
  name: 'Window light',
  description: 'Two arched windows side by side',
  mode: 'single',
  style: 'playful',
  photos: { min: 2, max: 2 },
  defaults: { margin: 100, gutter: 50 },
  slots(canvas, spacing) {
    return windowGeometry(canvas, spacing).arches.map((rect): Slot => ({ canvas: 0, rect, mask: arch(rect) }))
  },
  decor(canvas, spacing) {
    const { arches, box } = windowGeometry(canvas, spacing)
    const unit = Math.min(canvas.width, canvas.height)
    const outline = (r: Rect): Decor => ({ type: 'shape', canvas: 0, d: arch(grow(r, 0.014 * unit)), stroke: { color: COLORS.plum, width: 0.0025 * unit } })
    const over: Decor[] = []
    // A sprig in the top-right corner, in the space the arches leave above or beside them.
    const room = Math.max(arches[0]!.y, canvas.width - (arches[1]!.x + arches[1]!.width))
    const size = Math.min(0.13 * unit, room * 0.9)
    if (size > 0.05 * unit) over.push(art(0, ART.sprig, canvas.width - room / 2, Math.max(room, size) / 2 + box.y * 0.1, size, COLORS.plum, 10))
    return { under: arches.map(outline), over }
  },
}

// ---- Circle story: one large and one smaller circular photo, with soft dots and a sprig. ----

function circleGeometry(canvas: Size, spacing: Spacing) {
  const box = inner(canvas, spacing)
  const ratio = 0.62
  // The largest pair that keeps a gutter between the circles: big one top-left, small one bottom-right.
  const fits = (d: number) => {
    const small = ratio * d
    const dx = box.width - d / 2 - small / 2
    const dy = box.height - d / 2 - small / 2
    return d <= Math.min(box.width, box.height) && Math.hypot(dx, dy) >= (d + small) / 2 + spacing.gutter
  }
  let low = 0
  let high = Math.min(box.width, box.height)
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2
    if (fits(mid)) low = mid
    else high = mid
  }
  const big = low
  const small = ratio * big
  return {
    box,
    big: { x: box.x, y: box.y, width: big, height: big },
    small: { x: box.x + box.width - small, y: box.y + box.height - small, width: small, height: small },
  }
}

const dot = (cx: number, cy: number, r: number, fill: string): Decor => ({ type: 'shape', canvas: 0, d: circle({ x: cx - r, y: cy - r, width: 2 * r, height: 2 * r }), fill })

const circleStory: TemplateDefinition = {
  id: 'pair-circle-story',
  version: 1,
  name: 'Circle story',
  description: 'One large and one small circular photo',
  mode: 'single',
  style: 'playful',
  photos: { min: 2, max: 2 },
  defaults: { margin: 80, gutter: 50 },
  slots(canvas, spacing) {
    const { big, small } = circleGeometry(canvas, spacing)
    return [big, small].map((rect): Slot => ({ canvas: 0, rect, mask: circle(rect) }))
  },
  decor(canvas, spacing) {
    const { box, big, small } = circleGeometry(canvas, spacing)
    const unit = Math.min(canvas.width, canvas.height)
    // Dots and a sprig in the two corners the circles leave open: top right and bottom left.
    const right = Math.max(big.x + big.width, box.x + box.width - 0.16 * unit)
    // Bottom left, when the big circle leaves room there; otherwise (very wide canvases) between the two circles.
    const low = box.y + box.height - (big.y + big.height) > 0.12 * unit
      ? { x: box.x + 0.05 * unit, y: small.y + small.height - 0.03 * unit }
      : { x: (big.x + big.width + small.x) / 2 - 0.06 * unit, y: box.y + box.height - 0.03 * unit }
    const under = [
      dot(right + (box.x + box.width - right) * 0.6, box.y + 0.06 * unit, 0.035 * unit, COLORS.sage),
      dot(right + (box.x + box.width - right) * 0.2, box.y + 0.15 * unit, 0.022 * unit, COLORS.blush),
      dot(low.x, low.y, 0.028 * unit, COLORS.lilac),
    ]
    const over = [art(0, ART.sprig, low.x + 0.09 * unit, low.y - 0.07 * unit, 0.14 * unit, COLORS.plum, -15)]
    return { under, over }
  },
}

// ---- Torn pages: two photos torn from a page, each on a slightly larger torn white sheet. ----

function tornGeometry(canvas: Size, spacing: Spacing) {
  const box = inner(canvas, spacing)
  const unit = Math.min(canvas.width, canvas.height)
  const paper = 0.024 * unit // how far the white sheet shows around the photo
  const room = { width: box.width - 2 * paper, height: box.height - 2 * paper }
  // 4 : 3 photos, stacked on tall canvases and side by side otherwise, centred.
  const stacked = tall(canvas)
  const w = stacked ? Math.min(room.width, (room.height - spacing.gutter - 2 * paper) / 2 / 0.75) : Math.min((room.width - spacing.gutter - 2 * paper) / 2, room.height / 0.75)
  const h = 0.75 * w
  const total = stacked ? 2 * h + spacing.gutter + 2 * paper : 2 * w + spacing.gutter + 2 * paper
  const start = (stacked ? box.y + (box.height - total) / 2 : box.x + (box.width - total) / 2) + paper
  const photos = [0, 1].map((i): Rect =>
    stacked
      ? { x: box.x + (box.width - w) / 2, y: start + i * (h + spacing.gutter + 2 * paper), width: w, height: h }
      : { x: start + i * (w + spacing.gutter + 2 * paper), y: box.y + (box.height - h) / 2, width: w, height: h },
  )
  return { box, unit, paper, photos }
}

const tornPages: TemplateDefinition = {
  id: 'pair-torn-pages',
  version: 1,
  name: 'Torn pages',
  description: 'Two photos with soft torn-paper edges',
  mode: 'single',
  style: 'playful',
  photos: { min: 2, max: 2 },
  defaults: { margin: 90, gutter: 50, background: COLORS.blush },
  slots(canvas, spacing) {
    const { photos, unit } = tornGeometry(canvas, spacing)
    return photos.map((rect, i): Slot => ({ canvas: 0, rect, mask: torn(rect, 11 + i, 0.012 * unit, 0.022 * unit) }))
  },
  decor(canvas, spacing) {
    const { photos, unit, paper } = tornGeometry(canvas, spacing)
    const under = photos.map((rect, i): Decor => ({ type: 'shape', canvas: 0, d: torn(grow(rect, paper), 41 + i, 0.014 * unit, 0.02 * unit), fill: COLORS.card }))
    // A sprig in the space right of the second sheet (the margin, or more on wide canvases), when there's room.
    const last = photos[1]!
    const right = last.x + last.width + paper
    const room = canvas.width - right
    // The turned sprig is about 0.8 of its size wide; it's left out where it would be cramped.
    const size = Math.min(0.14 * unit, room)
    const over = size > 0.1 * unit ? [art(0, ART.sprig, right + room / 2, last.y + last.height * 0.3, size, COLORS.plum, 20)] : []
    return { under, over }
  },
}

// ---- Love letter: stationery on an envelope, two photos and a handwritten note with a heart. ----

function letterGeometry(canvas: Size, spacing: Spacing) {
  const box = inner(canvas, spacing)
  const unit = Math.min(canvas.width, canvas.height)
  // The sheet leaves the envelope showing at the top right.
  const sheet: Rect = { x: box.x, y: box.y + 0.05 * unit, width: box.width - 0.05 * unit, height: box.height - 0.05 * unit }
  const pad = 0.05 * unit
  // Photos in a column on the right 55% of the sheet; the note fills the left.
  const column = { x: sheet.x + sheet.width * 0.45, width: sheet.width * 0.55 - pad }
  const h = Math.min(column.width * 0.8, (sheet.height - 2 * pad - spacing.gutter) / 2)
  const w = Math.min(column.width, h / 0.8)
  const top = sheet.y + (sheet.height - (2 * h + spacing.gutter)) / 2
  const photos = [0, 1].map((i): Rect => ({ x: column.x + (column.width - w), y: top + i * (h + spacing.gutter), width: w, height: h }))
  return { box, unit, sheet, photos, note: { x: sheet.x + sheet.width * 0.23, y: sheet.y + sheet.height * 0.34, width: sheet.width * 0.36 } }
}

const loveLetter: TemplateDefinition = {
  id: 'pair-love-letter',
  version: 1,
  name: 'Love letter',
  description: 'Stationery, two photos and a handwritten note',
  mode: 'single',
  style: 'playful',
  photos: { min: 2, max: 2 },
  defaults: { margin: 70, gutter: 30, background: COLORS.blush },
  captions: [{ id: 'note', label: 'Note', default: 'Same brunch\nDifferent adventure' }],
  slots(canvas, spacing) {
    return letterGeometry(canvas, spacing).photos.map((rect): Slot => ({ canvas: 0, rect, frame: { pad: 0.012 * Math.min(canvas.width, canvas.height), color: COLORS.card } }))
  },
  decor(canvas, spacing, text) {
    const { box, unit, sheet, note } = letterGeometry(canvas, spacing)
    // The envelope behind the sheet, with its flap drawn as two lines meeting in a point.
    const envelope: Rect = { x: box.x + 0.08 * unit, y: box.y, width: box.width - 0.08 * unit, height: Math.min(box.height * 0.5, 0.5 * unit) }
    const flap = `M${envelope.x} ${envelope.y}L${envelope.x + envelope.width / 2} ${envelope.y + envelope.height * 0.55}L${envelope.x + envelope.width} ${envelope.y}`
    const under: Decor[] = [
      { type: 'shape', canvas: 0, d: roundedRect(envelope, 0.01 * unit), fill: COLORS.envelope },
      { type: 'shape', canvas: 0, d: flap, stroke: { color: COLORS.paper, width: 0.004 * unit } },
      { type: 'shape', canvas: 0, d: roundedRect(sheet, 0.006 * unit), fill: COLORS.paper },
    ]
    const over: Decor[] = []
    const words = text('note')
    if (words) over.push({ type: 'text', canvas: 0, text: words, size: 0.06 * unit, maxWidth: note.width, maxLines: 4, align: 'middle', color: COLORS.plum, at: { x: note.x, y: note.y, rotate: -8, scale: 1 } })
    over.push(filledArt(0, ART.heart, note.x, sheet.y + sheet.height * 0.66, 0.05 * unit, COLORS.blush))
    over.push(art(0, ART.sprig, sheet.x + 0.09 * unit, sheet.y + sheet.height - 0.09 * unit, 0.13 * unit, COLORS.plum, -25))
    return { under, over }
  },
}

// ---- Colorblock: two framed photos over soft lilac and sage blocks. ----

const colorblock: TemplateDefinition = {
  id: 'pair-colorblock',
  version: 1,
  name: 'Colorblock',
  description: 'Two framed photos over lilac and sage blocks',
  mode: 'single',
  style: 'playful',
  photos: { min: 2, max: 2 },
  defaults: { margin: 90, gutter: 40 },
  slots(canvas, spacing) {
    const { a, b } = postcardGeometry(canvas, spacing, 0.04, [0, 0])
    const frame = { pad: a.width * CARD_PAD, color: COLORS.card }
    return [
      { canvas: 0, rect: a, frame },
      { canvas: 0, rect: b, frame },
    ]
  },
  decor(canvas, spacing) {
    const { a, unit, box } = postcardGeometry(canvas, spacing, 0.04, [0, 0])
    const [W, H] = [canvas.width, canvas.height]
    const under: Decor[] = [
      { type: 'shape', canvas: 0, d: polygon([[0, 0], [W * 0.66, 0], [W * 0.4, H * 0.52], [0, H * 0.7]]), fill: COLORS.lilac, opacity: 0.55 },
      { type: 'shape', canvas: 0, d: polygon([[W, H * 0.32], [W, H], [W * 0.28, H], [W * 0.58, H * 0.58]]), fill: COLORS.sage, opacity: 0.6 },
    ]
    const size = Math.min(0.15 * unit, box.x + box.width - (a.x + a.width) - 0.03 * unit)
    const over = size > 0.06 * unit ? [art(0, ART.sprig, box.x + box.width - size * 0.45, a.y + size * 0.5, size, COLORS.plum, 15)] : []
    return { under, over }
  },
}

// ---- Scrapbook: two tilted prints held on with strips of tape, a sprig and a small heart. ----

const SCRAPBOOK_TILT = [-3, 4] as const

const scrapbook: TemplateDefinition = {
  id: 'pair-scrapbook',
  version: 1,
  name: 'Scrapbook',
  description: 'Two taped prints with a sprig and a heart',
  mode: 'single',
  style: 'playful',
  photos: { min: 2, max: 2 },
  defaults: { margin: 90, gutter: 70 },
  slots(canvas, spacing) {
    const { a, b } = postcardGeometry(canvas, spacing, 0.08, SCRAPBOOK_TILT)
    const frame = { pad: a.width * CARD_PAD, color: COLORS.card }
    return [
      { canvas: 0, rect: a, rotation: SCRAPBOOK_TILT[0], frame },
      { canvas: 0, rect: b, rotation: SCRAPBOOK_TILT[1], frame },
    ]
  },
  decor(canvas, spacing) {
    const { a, b, unit, box } = postcardGeometry(canvas, spacing, 0.08, SCRAPBOOK_TILT)
    const pad = a.width * CARD_PAD
    // A strip of tape across the middle of each card's top edge, turned with the card plus a little more.
    const tape = (photo: Rect, tilt: number, color: string, extra: number): Decor => {
      const t = (tilt * Math.PI) / 180
      const reach = photo.height / 2 + pad
      const length = photo.width * 0.3
      const depth = photo.width * 0.075
      return {
        type: 'shape',
        canvas: 0,
        d: `M${-length / 2} ${-depth / 2}H${length / 2}V${depth / 2}H${-length / 2}Z`,
        fill: color,
        opacity: 0.85,
        at: { x: photo.x + photo.width / 2 + reach * Math.sin(t), y: photo.y + photo.height / 2 - reach * Math.cos(t), rotate: tilt + extra, scale: 1 },
      }
    }
    const over: Decor[] = [tape(a, SCRAPBOOK_TILT[0], COLORS.blush, -6), tape(b, SCRAPBOOK_TILT[1], COLORS.sage, 5)]
    over.push(filledArt(0, ART.heart, box.x + box.width - 0.05 * unit, box.y + 0.05 * unit, 0.045 * unit, COLORS.blush))
    over.push(art(0, ART.sprig, box.x + 0.07 * unit, box.y + box.height - 0.09 * unit, 0.15 * unit, COLORS.plum, -10))
    return { under: [], over }
  },
}

// ---- Then + now: two photos side by side, each with a short handwritten label, a heart between them. ----

function thenNowGeometry(canvas: Size, spacing: Spacing) {
  const box = inner(canvas, spacing)
  const unit = Math.min(canvas.width, canvas.height)
  const band = 0.15 * unit // the labels' row
  // Portrait photos (2 : 3 at most) side by side above the labels, the whole group centred.
  const w = Math.min((box.width - spacing.gutter) / 2, (box.height - band) / 1.2)
  const h = Math.min(box.height - band, w * 1.5)
  const left = box.x + (box.width - (2 * w + spacing.gutter)) / 2
  const top = box.y + (box.height - (h + band)) / 2
  const photos = [0, 1].map((i): Rect => ({ x: left + i * (w + spacing.gutter), y: top, width: w, height: h }))
  return { unit, photos, labels: top + h + band * 0.62 }
}

const thenAndNow: TemplateDefinition = {
  id: 'pair-then-now',
  version: 1,
  name: 'Then + now',
  description: 'Two photos side by side with their own labels',
  mode: 'single',
  style: 'playful',
  photos: { min: 2, max: 2 },
  defaults: { margin: 80, gutter: 30 },
  captions: [
    { id: 'then', label: 'First label', default: 'then' },
    { id: 'now', label: 'Second label', default: 'now' },
  ],
  slots(canvas, spacing) {
    return thenNowGeometry(canvas, spacing).photos.map((rect): Slot => ({ canvas: 0, rect }))
  },
  decor(canvas, spacing, text) {
    const { unit, photos, labels } = thenNowGeometry(canvas, spacing)
    const over: Decor[] = []
    for (const [i, id] of (['then', 'now'] as const).entries()) {
      const words = text(id)
      const photo = photos[i]!
      if (words) over.push({ type: 'text', canvas: 0, text: words, size: 0.07 * unit, maxWidth: photo.width * 0.8, maxLines: 1, align: 'middle', color: COLORS.plum, at: { x: photo.x + photo.width / 2, y: labels, rotate: 0, scale: 1 } })
    }
    // A small heart between the labels, with a short line either side.
    const mid = (photos[0]!.x + photos[0]!.width + photos[1]!.x) / 2
    const y = labels - 0.02 * unit
    const line = (from: number, to: number): Decor => ({ type: 'shape', canvas: 0, d: `M${from} ${y}H${to}`, stroke: { color: COLORS.plum, width: 0.0025 * unit } })
    over.push(filledArt(0, ART.heart, mid, y, 0.04 * unit, COLORS.plum), line(mid - 0.09 * unit, mid - 0.035 * unit), line(mid + 0.035 * unit, mid + 0.09 * unit))
    return { under: [], over }
  },
}

// ---- Gallery ticket: two photos inside a notched ticket, with a title above and a note below. ----

function ticketGeometry(canvas: Size, spacing: Spacing) {
  const box = inner(canvas, spacing)
  const unit = Math.min(canvas.width, canvas.height)
  const pad = 0.06 * unit
  const head = 0.13 * unit // the title's row
  const foot = 0.12 * unit // the note's row
  // Portrait photos side by side between the title and the note; the ticket is cut to fit around them.
  const room = { width: box.width - 2 * pad, height: box.height - head - foot }
  const w = Math.min((room.width - spacing.gutter) / 2, room.height / 1.3)
  const h = Math.min(room.height, w * 1.4)
  const ticketWidth = 2 * w + spacing.gutter + 2 * pad
  const ticketHeight = h + head + foot
  const outline: Rect = { x: box.x + (box.width - ticketWidth) / 2, y: box.y + (box.height - ticketHeight) / 2, width: ticketWidth, height: ticketHeight }
  const photos = [0, 1].map((i): Rect => ({ x: outline.x + pad + i * (w + spacing.gutter), y: outline.y + head, width: w, height: h }))
  return { unit, outline, photos, title: outline.y + head * 0.62, note: outline.y + head + h + foot * 0.6 }
}

const galleryTicket: TemplateDefinition = {
  id: 'pair-gallery-ticket',
  version: 1,
  name: 'Gallery ticket',
  description: 'Two photos inside a ticket, with a title and a note',
  mode: 'single',
  style: 'playful',
  photos: { min: 2, max: 2 },
  defaults: { margin: 70, gutter: 30, background: COLORS.sage },
  captions: [
    { id: 'title', label: 'Title', default: 'A day to keep' },
    { id: 'note', label: 'Note', default: 'Good company, brighter places' },
  ],
  slots(canvas, spacing) {
    return ticketGeometry(canvas, spacing).photos.map((rect): Slot => ({ canvas: 0, rect }))
  },
  decor(canvas, spacing, text) {
    const { unit, outline, photos, title, note } = ticketGeometry(canvas, spacing)
    const notch = 0.05 * unit
    const under: Decor[] = [
      { type: 'shape', canvas: 0, d: ticket(outline, notch), fill: COLORS.paper },
      { type: 'shape', canvas: 0, d: ticket(grow(outline, -0.02 * unit), notch), stroke: { color: COLORS.plum, width: 0.0025 * unit } },
    ]
    const centre = outline.x + outline.width / 2
    const width = photos[1]!.x + photos[1]!.width - photos[0]!.x
    const over: Decor[] = []
    const heading = text('title')
    if (heading) over.push({ type: 'text', canvas: 0, text: heading, size: 0.06 * unit, maxWidth: width, maxLines: 1, align: 'middle', color: COLORS.plum, at: { x: centre, y: title, rotate: 0, scale: 1 } })
    const words = text('note')
    if (words) over.push({ type: 'text', canvas: 0, text: words, size: 0.045 * unit, maxWidth: width, maxLines: 1, align: 'middle', color: COLORS.plum, at: { x: centre, y: note, rotate: 0, scale: 1 } })
    return { under, over }
  },
}

// In the order of the concept board.
export const PLAYFUL_TEMPLATES: readonly TemplateDefinition[] = [
  postcards,
  filmNight,
  tornPages,
  windowLight,
  loveLetter,
  colorblock,
  scrapbook,
  thenAndNow,
  circleStory,
  galleryTicket,
]
