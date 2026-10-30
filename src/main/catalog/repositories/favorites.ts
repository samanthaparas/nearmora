/**
 * Favoriting photos straight from the Library, outside Best Moments. Favorites belong to the picture (decision D3),
 * so this only adds or removes rows in the favorite table; no photo file is touched.
 */

import type { Catalog } from '../database'

/**
 * Marks the given pictures as favorites (or not). Returns the ids whose state actually changed, so the UI can undo
 * exactly those and leave the ones that were already that way alone. Unknown ids are ignored.
 */
export function setFavorites(db: Catalog, input: { assetIds: readonly string[]; favorite: boolean }): { changed: string[] } {
  return db.transaction(() => {
    const changed: string[] = []
    const add = db.prepare('INSERT INTO favorite (asset_id, updated_at) SELECT id, ? FROM asset WHERE id = ? ON CONFLICT (asset_id) DO NOTHING')
    const remove = db.prepare('DELETE FROM favorite WHERE asset_id = ?')
    const now = Date.now()
    for (const assetId of new Set(input.assetIds)) {
      const result = input.favorite ? add.run(now, assetId) : remove.run(assetId)
      if (result.changes > 0) changed.push(assetId)
    }
    return { changed }
  })()
}
