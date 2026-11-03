/**
 * Turns a project (template, format, settings, number of photos) into its composition: every photo's exact place
 * (with any tilt, mask or card) and every decoration and caption, in canvas pixels. The editor's preview and the export both draw from this one result, which is how the exported
 * file matches what the person approved (AC7).
 */

import type { Rect } from '../layout'
import { FORMATS, type FormatId } from './formats'
import type { Params, ResolvedParams } from './params'
import { BACKGROUNDS } from './params'
import type { Decor } from './scene'
import { findTemplate, formatsFor, type Mode, type TemplateDefinition } from './templates'

/** One photo on one output canvas. `slot` is the project's photo position it shows. */
export interface PhotoElement {
  id: string
  type: 'photo'
  slot: number
  canvas: number
  rect: Rect
  /** Degrees clockwise around the rectangle's centre; 0 for upright photos. */
  rotation: number
  /** The shape the photo is cut to (SVG path in canvas pixels), or null for the whole rectangle. */
  mask: string | null
  /** A card behind the photo, turned with it, or null. */
  frame: { pad: number; color: string } | null
}

export interface Composition {
  width: number
  height: number
  background: string
  mode: Mode
  /** The frame around every photo, in canvas pixels (width 0 means none). */
  border: { width: number; color: string }
  /** How many canvases are drawn: one for a collage or a seamless design, one per slide for a carousel. */
  canvasCount: number
  /** How many files a canvas is cut into: the slides of a seamless carousel, otherwise 1 (see slices.ts). */
  slices: number
  /** Photos, in drawing order. */
  elements: PhotoElement[]
  /** Shapes and art drawn below the photos, and shapes, art and captions drawn above them. */
  under: Decor[]
  over: Decor[]
}

export interface ComposeInput {
  templateId: string
  templateVersion: number
  format: FormatId
  params: Params
  photoCount: number
}

export class UnknownTemplateError extends Error {}

/** The template's defaults with the person's own settings on top, all in reference pixels. */
export function resolveParams(template: TemplateDefinition, params: Params): ResolvedParams {
  return {
    background: params.background ?? template.defaults.background ?? BACKGROUNDS.cream,
    margin: params.margin ?? template.defaults.margin,
    gutter: params.gutter ?? template.defaults.gutter,
    borderWidth: params.borderWidth ?? 0,
    borderColor: params.borderColor ?? '#ffffff',
  }
}

/** Each caption's words: the person's own, or the template's default until they change it. */
export const captionText =
  (template: TemplateDefinition, params: Params) =>
  (id: string): string =>
    params.text?.[id] ?? template.captions?.find((c) => c.id === id)?.default ?? ''

export function compose(input: ComposeInput): Composition {
  const template = findTemplate(input.templateId, input.templateVersion)
  if (!template) throw new UnknownTemplateError(`Unknown template ${input.templateId} v${input.templateVersion}`)
  if (!formatsFor(template).includes(input.format)) throw new UnknownTemplateError(`${template.name} can't be made at ${input.format}`)
  const slide = FORMATS[input.format]
  // A seamless design is as wide as all its slides together; everything else is one canvas the size of the format.
  const slices = template.mode === 'seamless' ? (template.slides ?? 1) : 1
  const width = slide.width * slices
  const height = slide.height
  const resolved = resolveParams(template, input.params)
  // Reference pixels are pixels on a canvas (or slide) whose shorter side is 1080; this scales them to this one.
  const scale = Math.min(slide.width, height) / 1080
  const spacing = { margin: resolved.margin * scale, gutter: resolved.gutter * scale }
  const slots = template.slots({ width, height }, spacing, input.photoCount)
  return {
    width,
    height,
    background: resolved.background,
    mode: template.mode,
    border: { width: resolved.borderWidth * scale, color: resolved.borderColor },
    canvasCount: slots.reduce((most, slot) => Math.max(most, slot.canvas + 1), 0),
    slices,
    elements: slots.slice(0, input.photoCount).map((slot, index) => ({
      id: `photo-${index}`,
      type: 'photo',
      slot: index,
      canvas: slot.canvas,
      rect: slot.rect,
      rotation: slot.rotation ?? 0,
      mask: slot.mask ?? null,
      frame: slot.frame ?? null,
    })),
    ...(template.decor?.({ width, height }, spacing, captionText(template, input.params)) ?? { under: [], over: [] }),
  }
}
