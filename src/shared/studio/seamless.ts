/**
 * Seamless carousel layouts (phases S5a and S5b, ADR-0021): one wide design that is cut into slides, with photos that
 * run across the cuts so the carousel swipes like one picture; two everyday and two playful. Each is a pure function
 * of the whole design's size and spacing, like every template; the cuts themselves come from slices.ts.
 */

import { CARD_PAD, filmStrip, overhang } from './playful'
import { CORNERS, keepOutOf, placeArt } from './playful-quartets'
import { art, ART, COLORS, type Decor } from './scene'
import type { Slot, TemplateDefinition } from './templates'

type Size = { width: number; height: number }
type Spacing = { margin: number; gutter: number }

const slot = (x: number, y: number, width: number, height: number): Slot => ({ canvas: 0, rect: { x, y, width, height } })

// ---- Across the seam: two slides; a large photo sits across the cut, with a smaller one on each outer side. ----

function acrossGeometry(canvas: Size, spacing: Spacing): Slot[] {
  const slide = canvas.width / 2
  const { margin, gutter } = spacing
  const height = canvas.height - 2 * margin
  // The middle photo is centred on the cut and takes most of a slide's width; the outer ones share what's left.
  const middle = Math.min(slide * 0.85, canvas.width - 2 * margin - 2 * gutter - 2 * slide * 0.2)
  const outer = (canvas.width - 2 * margin - 2 * gutter - middle) / 2
  // The outer photos are shorter, one up and one down, so the eye travels across the cut.
  const short = height * 0.72
  return [
    slot(margin, margin, outer, short),
    slot(margin + outer + gutter, margin, middle, height),
    slot(canvas.width - margin - outer, canvas.height - margin - short, outer, short),
  ]
}

const acrossTheSeam: TemplateDefinition = {
  id: 'seamless-across-the-seam',
  version: 1,
  name: 'Across the seam',
  description: 'Two slides, a large photo across the cut',
  mode: 'seamless',
  slides: 2,
  formats: ['square', 'portrait'],
  photos: { min: 3, max: 3 },
  defaults: { margin: 70, gutter: 30 },
  slots: (canvas, spacing) => acrossGeometry(canvas, spacing),
}

// ---- Story strip: three slides, five photos in a row; tall and shorter ones alternate, two of them across the cuts. ----

function stripGeometry(canvas: Size, spacing: Spacing): Slot[] {
  const { margin, gutter } = spacing
  const width = (canvas.width - 2 * margin - 4 * gutter) / 5
  const height = canvas.height - 2 * margin
  const short = height * 0.7
  return Array.from({ length: 5 }, (_, i) => {
    const x = margin + i * (width + gutter)
    if (i % 2 === 0) return slot(x, margin, width, height)
    // The shorter photos sit high and low in turn.
    return slot(x, i === 1 ? margin : canvas.height - margin - short, width, short)
  })
}

const storyStrip: TemplateDefinition = {
  id: 'seamless-story-strip',
  version: 1,
  name: 'Story strip',
  description: 'Three slides, five photos in a row',
  mode: 'seamless',
  slides: 3,
  formats: ['square', 'portrait'],
  photos: { min: 5, max: 5 },
  defaults: { margin: 70, gutter: 30 },
  slots: (canvas, spacing) => stripGeometry(canvas, spacing),
}

// ---- Film roll (playful, S5b): one strip of film running across three slides, five frames, two of them on the cuts. ----

function rollGeometry(canvas: Size, spacing: Spacing) {
  const { margin } = spacing
  // In units of the strip's width (its short side): a pad, then each frame (0.525 long) followed by a pad.
  const along = 0.07 + 5 * 0.595
  const across = Math.min(canvas.height - 2 * margin, (canvas.width - 2 * margin) / along)
  const strip = { x: (canvas.width - across * along) / 2, y: (canvas.height - across) / 2, width: across * along, height: across }
  const frames = Array.from({ length: 5 }, (_, i) => slot(strip.x + 0.07 * across + i * 0.595 * across, strip.y + 0.15 * across, 0.525 * across, 0.7 * across))
  return { strip, across, frames }
}

const filmRoll: TemplateDefinition = {
  id: 'seamless-film-roll',
  version: 1,
  name: 'Film roll',
  description: 'Three slides on one strip of film',
  mode: 'seamless',
  style: 'playful',
  slides: 3,
  formats: ['square', 'portrait'],
  photos: { min: 5, max: 5 },
  defaults: { margin: 70, gutter: 0 },
  slots: (canvas, spacing) => rollGeometry(canvas, spacing).frames,
  decor(canvas, spacing) {
    const { strip, across } = rollGeometry(canvas, spacing)
    return { under: [{ type: 'shape', canvas: 0, d: filmStrip(strip, false, across), fill: COLORS.film, fillRule: 'evenodd' }], over: [] }
  },
}

// ---- Scattered postcards (playful, S5b): five tilted cards high and low across three slides, two on the cuts. ----

const SCATTER_TILT = [-5, 4, -3, 5, -4] as const

function scatterGeometry(canvas: Size, spacing: Spacing): Slot[] {
  const { margin } = spacing
  const inner = { width: canvas.width - 2 * margin, height: canvas.height - 2 * margin }
  // The turned card's size per pixel of photo width (photos are 4 : 3 landscape).
  const card = { width: 1 + 2 * CARD_PAD, height: 0.75 + 2 * CARD_PAD }
  const o = overhang(card.width, card.height, 5)
  const k = { width: card.width + 2 * o.x, height: card.height + 2 * o.y }
  // Each card fits its fifth of the width, and is at most two thirds as tall as the design, so they can sit high and low.
  const w = Math.min(((inner.width / 5) * 0.94) / k.width, (inner.height * 0.66) / k.height)
  const h = 0.75 * w
  const extent = { width: k.width * w, height: k.height * w }
  return SCATTER_TILT.map((rotation, i) => {
    const cx = margin + (i + 0.5) * (inner.width / 5)
    // High, low, high…: the top or bottom of the card's turned box meets the margin.
    const cy = i % 2 === 0 ? margin + extent.height / 2 : canvas.height - margin - extent.height / 2
    return { canvas: 0, rect: { x: cx - w / 2, y: cy - h / 2, width: w, height: h }, rotation, frame: { pad: w * CARD_PAD, color: COLORS.card } }
  })
}

const scatteredPostcards: TemplateDefinition = {
  id: 'seamless-scattered-postcards',
  version: 1,
  name: 'Scattered postcards',
  description: 'Three slides of tilted cards, two on the cuts',
  mode: 'seamless',
  style: 'playful',
  slides: 3,
  formats: ['square', 'portrait'],
  photos: { min: 5, max: 5 },
  defaults: { margin: 60, gutter: 0 },
  slots: (canvas, spacing) => scatterGeometry(canvas, spacing),
  decor(canvas, spacing) {
    const unit = Math.min(canvas.height, canvas.width / 3)
    const keepOut = keepOutOf(scatterGeometry(canvas, spacing))
    const over: Decor[] = []
    // A postmark and a sprig in the room the high and low cards leave.
    const mark = placeArt(canvas, keepOut, [[0.2, 0.85], [0.6, 0.85], [0.4, 0.15], ...CORNERS], 0.22 * unit, 0.1 * unit, -8)
    if (mark) over.push(art(0, ART.postmark, mark.x, mark.y, mark.size, COLORS.plum, -8))
    const sprig = placeArt(canvas, keepOut, [[0.8, 0.85], [0.5, 0.15], [0.9, 0.15], ...CORNERS], 0.18 * unit, 0.08 * unit, 15)
    if (sprig) over.push(art(0, ART.sprig, sprig.x, sprig.y, sprig.size, COLORS.plum, 15))
    return { under: [], over }
  },
}

export const SEAMLESS_TEMPLATES: readonly TemplateDefinition[] = [acrossTheSeam, storyStrip, filmRoll, scatteredPostcards]
