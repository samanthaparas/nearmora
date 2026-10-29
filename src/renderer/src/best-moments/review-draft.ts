/**
 * The favorites a person is choosing in one set before they save: plain functions, so they're easy to test.
 * "Dirty" means the draft differs from what's saved, which is what the unsaved-changes guard checks.
 */

export type Favorites = ReadonlySet<string>

export function toggleFavorite(draft: Favorites, assetId: string): Favorites {
  const next = new Set(draft)
  if (next.has(assetId)) next.delete(assetId)
  else next.add(assetId)
  return next
}

export const favoriteAll = (memberIds: readonly string[]): Favorites => new Set(memberIds)

export function isDirty(saved: Favorites, draft: Favorites): boolean {
  if (saved.size !== draft.size) return true
  for (const id of draft) if (!saved.has(id)) return true
  return false
}

/** After the set changes under the person (regrouping), keep only draft choices for photos still in it. */
export const keepMembers = (draft: Favorites, memberIds: readonly string[]): Favorites => new Set(memberIds.filter((id) => draft.has(id)))
