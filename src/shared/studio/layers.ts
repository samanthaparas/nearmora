/**
 * The drawing order of one output canvas: shapes and art under the photos, the photos, then shapes, art and
 * captions over them. Captions are already turned into letter outlines here, so the preview and the export receive
 * the same list of paths and photos and only have to draw them (ADR-0017).
 */

import type { Composition, PhotoElement } from './compose'
import type { Transform } from './scene'
import { textOutline } from './text'

export type Layer =
  | { kind: 'shape'; d: string; fill?: string; fillRule?: 'evenodd'; stroke?: { color: string; width: number }; at?: Transform }
  | { kind: 'photo'; element: PhotoElement }

export function layers(composition: Composition, canvas: number): Layer[] {
  const decor = (list: Composition['under']): Layer[] =>
    list
      .filter((d) => d.canvas === canvas)
      .flatMap((d): Layer[] => {
        if (d.type === 'shape') {
          const shape: Layer = { kind: 'shape', d: d.d }
          if (d.fill) shape.fill = d.fill
          if (d.fillRule) shape.fillRule = d.fillRule
          if (d.stroke) shape.stroke = d.stroke
          if (d.at) shape.at = d.at
          return [shape]
        }
        if (!d.text.trim()) return []
        return [{ kind: 'shape', d: textOutline(d.text, d.size, d.maxWidth, d.align).d, fill: d.color, at: d.at }]
      })
  return [
    ...decor(composition.under),
    ...composition.elements.filter((e) => e.canvas === canvas).map((element): Layer => ({ kind: 'photo', element })),
    ...decor(composition.over),
  ]
}

/** The SVG `transform` for a Transform: the same translate, rotate, scale order the canvas uses. */
export const svgTransform = (at: Transform): string => `translate(${at.x} ${at.y}) rotate(${at.rotate}) scale(${at.scale})`
