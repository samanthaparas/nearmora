/**
 * Draws one output canvas (a collage, or one carousel slide) with the shared layout math, so the preview is
 * computed exactly as the export will be (AC7). Uses the large preview image, or the thumbnail when that's
 * not available.
 */

import { useEffect, useRef } from 'react'
import { BACKGROUND_COLOR, CANVAS, placements, sourceRect, type Aspect, type Background, type Crop, type ProjectKind } from '@shared/layout'

export interface CanvasItem {
  assetId: string
  crop: Crop
}

// One image element per photo, shared by every canvas on the screen; falls back to the thumbnail if needed.
const images = new Map<string, Promise<HTMLImageElement>>()
function loadImage(assetId: string): Promise<HTMLImageElement> {
  let pending = images.get(assetId)
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => {
        image.onerror = () => reject(new Error('image unavailable'))
        image.src = `nm-media://thumb/${assetId}`
      }
      image.src = `nm-media://preview/${assetId}`
    })
    images.set(assetId, pending)
  }
  return pending
}

export function StudioCanvas({ kind, aspect, background, items, canvasIndex, displayWidth, highlight, label }: {
  kind: ProjectKind
  aspect: Aspect
  background: Background
  items: readonly CanvasItem[]
  canvasIndex: number
  displayWidth: number
  /** Position of the photo being edited, outlined so it's clear what the controls change. */
  highlight: number | null
  label: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const size = CANVAS[aspect]
  const scale = displayWidth / size.width
  const displayHeight = size.height * scale

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let cancelled = false
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(displayWidth * ratio)
    canvas.height = Math.round(displayHeight * ratio)
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0) // draw in output pixels; the transform scales to the screen
    context.fillStyle = BACKGROUND_COLOR[background]
    context.fillRect(0, 0, size.width, size.height)

    const mine = placements(kind, aspect, items.length)
      .map((placement, position) => ({ ...placement, position, item: items[position]! }))
      .filter((p) => p.canvas === canvasIndex)
    void Promise.allSettled(mine.map((p) => loadImage(p.item.assetId))).then((loaded) => {
      if (cancelled) return
      mine.forEach((p, i) => {
        const result = loaded[i]
        if (result?.status !== 'fulfilled') return
        const image = result.value
        // The crop is in proportions of the photo, so it means the same on the preview image and the original.
        const src = sourceRect({ width: image.naturalWidth, height: image.naturalHeight }, p.cell, p.item.crop)
        context.drawImage(image, src.x, src.y, src.width, src.height, p.cell.x, p.cell.y, p.cell.width, p.cell.height)
      })
      const selected = mine.find((p) => p.position === highlight)
      if (selected) {
        context.strokeStyle = '#5b414b'
        context.lineWidth = 8 / scale
        context.strokeRect(selected.cell.x, selected.cell.y, selected.cell.width, selected.cell.height)
      }
    })
    return () => {
      cancelled = true
    }
  }, [kind, aspect, background, items, canvasIndex, displayWidth, displayHeight, scale, size, highlight])

  return <canvas ref={ref} className="studio__canvas" role="img" aria-label={label} style={{ width: displayWidth, height: displayHeight }} />
}
