/**
 * A small drawing of a template's layout, for the template picker. Drawn from the same composition as the preview
 * and export, so the icon can't drift from what the template really does. Decorative: the button names the template.
 */

import { compose } from '@shared/studio/compose'
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
          {composition.elements
            .filter((e) => e.canvas === canvas)
            .map((e) => (
              <rect key={e.id} x={e.rect.x} y={e.rect.y} width={e.rect.width} height={e.rect.height} className="studio__template-photo" />
            ))}
        </g>
      ))}
    </svg>
  )
}
