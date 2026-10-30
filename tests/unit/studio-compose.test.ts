/**
 * Unit tests for Memory Studio compositions: every template's photo slots, at every format, stay inside the canvas,
 * don't overlap and keep the template's spacing; settings scale with the canvas; and stored settings are checked
 * against their schema. Preview and export both draw these numbers (AC7).
 */

import { describe, expect, it } from 'vitest'
import { compose, UnknownTemplateError } from '../../src/shared/studio/compose'
import { FORMAT_IDS, FORMATS } from '../../src/shared/studio/formats'
import { readParams } from '../../src/shared/studio/params'
import { latestTemplates, TEMPLATES, templatesFor } from '../../src/shared/studio/templates'

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width - 1e-9 && b.x < a.x + a.width - 1e-9 && a.y < b.y + b.height - 1e-9 && b.y < a.y + a.height - 1e-9

describe('templates', () => {
  it('each template version is unique, and new projects start from the newest', () => {
    const keys = TEMPLATES.map((t) => `${t.id}@${t.version}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(latestTemplates().map((t) => t.id).sort()).toEqual(['carousel-full', 'pair-equal-split', 'pair-stacked', 'quartet-classic-grid'])
  })

  it('offers only the templates that fit the number of photos selected', () => {
    expect(templatesFor(2).map((t) => t.id).sort()).toEqual(['carousel-full', 'pair-equal-split', 'pair-stacked'])
    expect(templatesFor(4).map((t) => t.id).sort()).toEqual(['carousel-full', 'quartet-classic-grid'])
    expect(templatesFor(1)).toEqual([])
  })

  // The acceptance rule: a two-photo template has exactly two independent slots, a four-photo template four.
  it('every collage has exactly as many separate, non-overlapping slots as photos, inside the canvas, at every format', () => {
    for (const template of latestTemplates().filter((t) => t.mode === 'single')) {
      for (const format of FORMAT_IDS) {
        const photoCount = template.photos.min
        const { elements, width, height, canvasCount } = compose({ templateId: template.id, templateVersion: template.version, format, params: { v: 1 }, photoCount })
        expect(canvasCount).toBe(1)
        expect(elements.map((e) => e.slot)).toEqual(Array.from({ length: photoCount }, (_, i) => i))
        for (const [i, e] of elements.entries()) {
          expect(e.rect.x).toBeGreaterThanOrEqual(0)
          expect(e.rect.y).toBeGreaterThanOrEqual(0)
          expect(e.rect.x + e.rect.width).toBeLessThanOrEqual(width + 1e-9)
          expect(e.rect.y + e.rect.height).toBeLessThanOrEqual(height + 1e-9)
          for (const other of elements.slice(i + 1)) expect(overlaps(e.rect, other.rect)).toBe(false)
        }
      }
    }
  })
})

describe('composing a project', () => {
  it('keeps Studio Lite’s layouts exactly: 48 px margin and 24 px gap on a 1080 square', () => {
    const grid = compose({ templateId: 'quartet-classic-grid', templateVersion: 1, format: 'square', params: { v: 1 }, photoCount: 4 })
    expect(grid.elements.map((e) => e.rect)).toEqual([
      { x: 48, y: 48, width: 480, height: 480 },
      { x: 552, y: 48, width: 480, height: 480 },
      { x: 48, y: 552, width: 480, height: 480 },
      { x: 552, y: 552, width: 480, height: 480 },
    ])
    expect(grid.background).toBe('#f8f0e8') // cream unless the person chose otherwise
  })

  it('stacks two photos one above the other, and scales spacing with the canvas', () => {
    const stacked = compose({ templateId: 'pair-stacked', templateVersion: 1, format: 'portrait', params: { v: 1 }, photoCount: 2 })
    expect(stacked.elements.map((e) => e.rect)).toEqual([
      { x: 48, y: 48, width: 984, height: 615 },
      { x: 48, y: 687, width: 984, height: 615 },
    ])
    // Spacing is set for a 1080 short side, so a person's 60 px margin stays proportionally the same on any canvas.
    const custom = compose({ templateId: 'pair-stacked', templateVersion: 1, format: 'landscape', params: { v: 1, margin: 60, gutter: 0, background: '#ffffff' }, photoCount: 2 })
    expect(custom.elements[0]!.rect).toMatchObject({ x: 60, y: 60, width: FORMATS.landscape.width - 120 })
    expect(custom.elements[1]!.rect.y).toBeCloseTo(custom.elements[0]!.rect.y + custom.elements[0]!.rect.height, 9) // no gutter
    expect(custom.background).toBe('#ffffff')
  })

  it('gives a carousel one full-canvas photo per slide, in order', () => {
    const slides = compose({ templateId: 'carousel-full', templateVersion: 1, format: 'portrait', params: { v: 1 }, photoCount: 3 })
    expect(slides).toMatchObject({ mode: 'carousel', canvasCount: 3 })
    expect(slides.elements.map((e) => [e.slot, e.canvas, e.rect])).toEqual([0, 1, 2].map((i) => [i, i, { x: 0, y: 0, width: 1080, height: 1350 }]))
  })

  it('refuses a template this version doesn’t know, rather than drawing something else', () => {
    expect(() => compose({ templateId: 'from-the-future', templateVersion: 1, format: 'square', params: { v: 1 }, photoCount: 2 })).toThrow(UnknownTemplateError)
    expect(() => compose({ templateId: 'pair-stacked', templateVersion: 99, format: 'square', params: { v: 1 }, photoCount: 2 })).toThrow(UnknownTemplateError)
  })
})

describe('stored settings', () => {
  it('accepts valid settings and refuses anything else: unknown keys, bad colours, out-of-range sizes, other versions', () => {
    expect(readParams({ v: 1, background: '#AABBCC', margin: 0, gutter: 300 })).toEqual({ v: 1, background: '#AABBCC', margin: 0, gutter: 300 })
    for (const bad of [{}, { v: 2 }, { v: 1, background: 'url(x)' }, { v: 1, margin: 301 }, { v: 1, gutter: -1 }, { v: 1, onload: 'x' }, null, 'v1']) {
      expect(() => readParams(bad)).toThrow()
    }
  })
})
