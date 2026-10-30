/**
 * Turns a project (template, format, settings, number of photos) into its composition: every element's exact place
 * in canvas pixels. The editor's preview and the export both draw from this one result, which is how the exported
 * file matches what the person approved (AC7).
 */

import type { Rect } from '../layout'
import { FORMATS, type FormatId } from './formats'
import type { Params, ResolvedParams } from './params'
import { BACKGROUNDS } from './params'
import { findTemplate, type Mode, type TemplateDefinition } from './templates'

/** One photo on one output canvas. `slot` is the project's photo position it shows. */
export interface PhotoElement {
  id: string
  type: 'photo'
  slot: number
  canvas: number
  rect: Rect
}

export interface Composition {
  width: number
  height: number
  background: string
  mode: Mode
  /** How many output files: one for a collage, one per slide for a carousel. */
  canvasCount: number
  elements: PhotoElement[]
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
    background: params.background ?? BACKGROUNDS.cream,
    margin: params.margin ?? template.defaults.margin,
    gutter: params.gutter ?? template.defaults.gutter,
  }
}

export function compose(input: ComposeInput): Composition {
  const template = findTemplate(input.templateId, input.templateVersion)
  if (!template) throw new UnknownTemplateError(`Unknown template ${input.templateId} v${input.templateVersion}`)
  const { width, height } = FORMATS[input.format]
  const resolved = resolveParams(template, input.params)
  // Reference pixels are pixels on a canvas whose shorter side is 1080; this scales them to this canvas.
  const scale = Math.min(width, height) / 1080
  const slots = template.slots({ width, height }, { margin: resolved.margin * scale, gutter: resolved.gutter * scale }, input.photoCount)
  return {
    width,
    height,
    background: resolved.background,
    mode: template.mode,
    canvasCount: slots.reduce((most, slot) => Math.max(most, slot.canvas + 1), 0),
    elements: slots.slice(0, input.photoCount).map((slot, index) => ({ id: `photo-${index}`, type: 'photo', slot: index, canvas: slot.canvas, rect: slot.rect })),
  }
}
