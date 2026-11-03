/**
 * Changes to one photo's place in Customize (S6a, ADR-0022): move, resize, tilt, round, flip, lock, hide, layer
 * order, and emptying or filling a place. Each is a pure function from one design to the next, so the editor's undo,
 * redo and saving work for them exactly as for every other Quick edit.
 */

import type { Rect } from '../layout'
import type { Composition } from './compose'
import type { Design } from './design'
import type { SlotEdit } from './params'

/** Sets (or, with `undefined`, clears) parts of one photo's edit. An edit left with nothing in it is removed. */
export function setEdit(design: Design, slot: number, patch: { [K in keyof SlotEdit]?: SlotEdit[K] | undefined }): Design {
  const merged = { ...design.params.edits?.[String(slot)], ...patch }
  const edit: SlotEdit = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined))
  const edits = Object.fromEntries(Object.entries({ ...design.params.edits, [String(slot)]: edit }).filter(([, e]) => Object.keys(e).length > 0))
  // Settings without the edits key, so a design with no edits left is stored exactly as one that never had any.
  const params = Object.fromEntries(Object.entries(design.params).filter(([key]) => key !== 'edits')) as Design['params']
  return { ...design, params: Object.keys(edits).length === 0 ? params : { ...params, edits } }
}

/** A place in canvas pixels, stored as fractions of the canvas so it keeps its proportions if the size changes. */
export const placeEdit = (composition: Pick<Composition, 'width' | 'height'>, rect: Rect): NonNullable<SlotEdit['rect']> => ({
  x: rect.x / composition.width,
  y: rect.y / composition.height,
  width: rect.width / composition.width,
  height: rect.height / composition.height,
})

/** Moves a photo one step towards the front (`+1`) or the back (`-1`) of the drawing order. */
export function moveInOrder(design: Design, composition: Composition, slot: number, step: 1 | -1): Design {
  const order = composition.elements.map((e) => e.slot)
  const at = order.indexOf(slot)
  const to = at + step
  if (at < 0 || to < 0 || to >= order.length) return design
  ;[order[at], order[to]] = [order[to]!, order[at]!]
  return { ...design, params: { ...design.params, order } }
}

/** Takes the photo out of its place: the place stays, empty, ready to be filled again (its crop and fit are kept). */
export const emptyPlace = (design: Design, slot: number): Design => ({
  ...design,
  items: design.items.map((item, i) => (i === slot ? { ...item, assetId: null } : item)),
})
