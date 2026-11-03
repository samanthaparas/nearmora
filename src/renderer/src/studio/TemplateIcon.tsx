/**
 * A small drawing of a template's layout, for the template picker. Drawn from the same composition and drawing order
 * as the preview and export (layers.ts), so the icon can't drift from what the template really does: playful
 * layouts show their shapes, tilt, masks and caption, and seamless carousels their whole design with the cuts marked.
 * Decorative: the button names the template.
 */

import { compose } from '@shared/studio/compose'
import type { FormatId } from '@shared/studio/formats'
import { layers, svgTransform } from '@shared/studio/layers'
import { cutPositions } from '@shared/studio/slices'
import { formatFor, type TemplateDefinition } from '@shared/studio/templates'

export function TemplateIcon({ template, format = 'square' }: { template: TemplateDefinition; format?: FormatId }) {
  // Carousels are drawn as two slides side by side; collages as their single canvas, at the chosen size's shape (or the
  // nearest one the layout allows); seamless carousels as their whole wide design.
  const composition = compose({ templateId: template.id, templateVersion: template.version, format: formatFor(template, format), params: { v: 1 }, photoCount: template.photos.min })
  const { width, height } = composition
  const slides = Math.min(composition.canvasCount, 2)
  const gap = Math.min(width, height) / 18
  return (
    <svg
      className={`studio__template-icon${slides > 1 || composition.slices > 1 ? ' studio__template-icon--slides' : ''}`}
      viewBox={`0 0 ${slides * width + (slides - 1) * gap} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: slides }, (_, canvas) => (
        <g key={canvas} transform={`translate(${canvas * (width + gap)} 0)`}>
          <rect width={width} height={height} className="studio__template-canvas" />
          {layers(composition, canvas).map((layer, i) => {
            if (layer.kind === 'shape') {
              return (
                <path
                  key={i}
                  d={layer.d}
                  fill={layer.fill ?? 'none'}
                  fillRule={layer.fillRule}
                  opacity={layer.opacity}
                  stroke={layer.stroke?.color}
                  strokeWidth={layer.stroke?.width}
                  strokeLinecap="round"
                  transform={layer.at ? svgTransform(layer.at) : undefined}
                />
              )
            }
            const { rect, rotation, mask, frame } = layer.element
            const turn = rotation ? `rotate(${rotation} ${rect.x + rect.width / 2} ${rect.y + rect.height / 2})` : undefined
            return (
              <g key={i} transform={turn}>
                {frame ? <rect x={rect.x - frame.pad} y={rect.y - frame.pad} width={rect.width + 2 * frame.pad} height={rect.height + 2 * frame.pad} fill={frame.color} /> : null}
                {mask ? <path d={mask} className="studio__template-photo" /> : <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} className="studio__template-photo" />}
              </g>
            )
          })}
          {cutPositions(width, composition.slices).map((x) => (
            <path key={x} d={`M${x} 0V${height}`} className="studio__template-cut" />
          ))}
        </g>
      ))}
    </svg>
  )
}
