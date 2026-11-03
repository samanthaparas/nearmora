/**
 * Playful Memory Studio layouts (phase S4): photos cut to shapes, tilted on cards or set in a film strip, with
 * original line art and editable captions. Like every template, each is a pure function of the canvas size and
 * spacing, so it works at every sharing and print size. Written from the layout guide's descriptions, not traced
 * from the concept boards.
 */

import type { Rect } from '../layout'
import { art, arch, ART, circle, COLORS, grow, roundedRect, type Decor } from './scene'
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

function postcardGeometry(canvas: Size, spacing: Spacing) {
  const box = inner(canvas, spacing)
  const unit = Math.min(canvas.width, canvas.height)
  const band = 0.11 * unit // room for the caption
  // The size a card takes once padded and turned, for a photo `w` wide (photos are 4 : 3 landscape).
  const extent = (w: number, tilt: number) => {
    const card = { width: w * (1 + 2 * CARD_PAD), height: w * 0.75 + 2 * w * CARD_PAD }
    const o = overhang(card.width, card.height, tilt)
    return { width: card.width + 2 * o.x, height: card.height + 2 * o.y }
  }
  const k = { width: extent(1, POSTCARD_TILT[1]).width, height: extent(1, POSTCARD_TILT[1]).height } // per pixel of photo width
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
    return { a, b, caption: { x: box.x + 0.04 * box.width, y: b.y + card.height + band * 0.55, width: box.width - card.width * 0.2, align: 'start' as const }, unit, box, card }
  }
  const left = box.x + (box.width - (2 * card.width + spacing.gutter)) / 2
  const a = place(left, box.y)
  const b = place(left + card.width + spacing.gutter, box.y + box.height - card.height)
  return { a, b, caption: { x: left + card.width / 2, y: box.y + card.height + band * 0.7, width: card.width, align: 'middle' as const }, unit, box, card }
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
    if (words) over.push({ type: 'text', canvas: 0, text: words, size: 0.065 * unit, maxWidth: caption.width, align: caption.align, color: COLORS.plum, at: { x: caption.x, y: caption.y, rotate: -3, scale: 1 } })
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

export const PLAYFUL_TEMPLATES: readonly TemplateDefinition[] = [postcards, filmNight, windowLight, circleStory]
