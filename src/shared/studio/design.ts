/**
 * A project's design: everything Quick edits can change (layout, shape, settings, and each photo with its crop and fit).
 * The editor's undo, redo and "reset to layout defaults" all work by saving a whole design in one step, so the catalog
 * never holds half of an edit and an undo always returns exactly the earlier state.
 */

import { z } from 'zod'
import { DEFAULT_CROP, MAX_ZOOM, type Crop, type Fit } from '../layout'
import { FORMAT_IDS, type FormatId } from './formats'
import { DEFAULT_PARAMS, ParamsSchema, type Params } from './params'

export interface DesignItem {
  assetId: string
  crop: Crop
  fit: Fit
}

export interface Design {
  templateId: string
  templateVersion: number
  format: FormatId
  params: Params
  items: DesignItem[]
}

// Checked in the IPC contract and again in the repository; a design that fails is never written.
export const DesignSchema = z
  .object({
    templateId: z.string().min(1).max(80),
    templateVersion: z.number().int().positive(),
    format: z.enum(FORMAT_IDS as [FormatId, ...FormatId[]]),
    params: ParamsSchema,
    items: z
      .array(
        z
          .object({
            assetId: z.uuid(),
            crop: z.object({ cx: z.number().min(0).max(1), cy: z.number().min(0).max(1), zoom: z.number().min(1).max(MAX_ZOOM) }).strict(),
            fit: z.enum(['fill', 'fit']),
          })
          .strict(),
      )
      .min(2)
      .max(10),
  })
  .strict()

/** The design part of a project as it was loaded. */
export const designOf = (project: Design): Design => ({
  templateId: project.templateId,
  templateVersion: project.templateVersion,
  format: project.format,
  params: project.params,
  items: project.items.map(({ assetId, crop, fit }) => ({ assetId, crop, fit })),
})

// JSON with object keys sorted, so the order settings were set in doesn't make two equal designs look different.
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  )

/** True when two designs would draw the same; used so an edit that changes nothing isn't added to the undo list. */
export const sameDesign = (a: Design, b: Design): boolean => stable(a) === stable(b)

/** Back to the layout's own look: no custom settings, every photo filled and centred. Photos and their order stay. */
export const resetDesign = (design: Design): Design => ({
  ...design,
  params: DEFAULT_PARAMS,
  items: design.items.map(({ assetId }) => ({ assetId, crop: DEFAULT_CROP, fit: 'fill' })),
})

/** Exchanges two photos' places; each keeps its own crop and fit. */
export function swapItems(design: Design, a: number, b: number): Design {
  const items = [...design.items]
  ;[items[a], items[b]] = [items[b]!, items[a]!]
  return { ...design, items }
}

/** Moves one photo to a new position; the others shift along. */
export function moveItem(design: Design, from: number, to: number): Design {
  const items = [...design.items]
  const [moved] = items.splice(from, 1)
  items.splice(to, 0, moved!)
  return { ...design, items }
}

/** Puts a different photo in one place, centred, keeping that place's fit. */
export function replaceItem(design: Design, position: number, assetId: string): Design {
  return { ...design, items: design.items.map((item, i) => (i === position ? { assetId, crop: DEFAULT_CROP, fit: item.fit } : item)) }
}

/** Changes one photo's crop or fit. */
export function updateItem(design: Design, position: number, change: Partial<Omit<DesignItem, 'assetId'>>): Design {
  return { ...design, items: design.items.map((item, i) => (i === position ? { ...item, ...change } : item)) }
}
