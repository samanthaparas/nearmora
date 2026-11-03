/**
 * A small drawing of a template's layout, for the template picker. Drawn from the same composition and drawing order
 * as the preview and export (layers.ts), so the icon can't drift from what the template really does: playful
 * layouts show their shapes, tilt, masks and caption. Decorative: the button names the template.
 */

import { compose } from '@shared/studio/compose'
import { layers, svgTransform } from '@shared/studio/layers'
import type { TemplateDefinition } from '@shared/studio/templates'

export function TemplateIcon({ template }: { template: TemplateDefinition }) {
  // Carousels are drawn as two slides side by side; collages as their single square canvas.
  const composition = compose({ templateId: template.id, templateVersion: template.version, format: 'square', params: { v: 1 }, photoCount: template.photos.min })
  const slides = Math.min(composition.canvasCount, 2)
  const gap = 60
  return (
    <svg className="studio__template-icon" viewBox={`0 0 ${slides * 1080 + (slides - 1) * gap} 1080`} aria-hidden="true" focusable="false">
      {Array.from({ length: slides }, (_, canvas) => (
        <g key={canvas} transform={`translate(${canvas * (1080 + gap)} 0)`}>
          <rect width="1080" height="1080" className="studio__template-canvas" />
          {layers(composition, canvas).map((layer, i) => {
            if (layer.kind === 'shape') {
              return (
                <path
                  key={i}
                  d={layer.d}
                  fill={layer.fill ?? 'none'}
                  fillRule={layer.fillRule}
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
        </g>
      ))}
    </svg>
  )
}
