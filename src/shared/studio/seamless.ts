/**
 * Seamless carousel layouts (phase S5a, ADR-0021): one wide design that is cut into slides, with photos that run
 * across the cuts so the carousel swipes like one picture. Each is a pure function of the whole design's size and
 * spacing, like every template; the cuts themselves come from slices.ts.
 */

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

export const SEAMLESS_TEMPLATES: readonly TemplateDefinition[] = [acrossTheSeam, storyStrip]
