/**
 * Integration tests for storage reporting and cache clearing (AC9): sizes add up, and clearing removes only files
 * named like Nearmora's cache files (a SHA-256 plus .webp), never anything else that happens to be there.
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clearCacheFolder, storageUsage } from '../../src/main/library/storage'
import { tempDir } from './helpers'

const sha = (n: number) => n.toString(16).padStart(64, '0')

describe('storage and cache clearing', () => {
  it('reports sizes and removes only Nearmora cache files', () => {
    const dir = tempDir()
    const thumbs = join(dir, 'thumbnails')
    mkdirSync(thumbs)
    writeFileSync(join(thumbs, `${sha(1)}.webp`), Buffer.alloc(1000))
    writeFileSync(join(thumbs, `${sha(2)}.webp`), Buffer.alloc(500))
    writeFileSync(join(thumbs, 'holiday.jpg'), 'not ours') // must survive
    writeFileSync(join(thumbs, `${sha(3)}.webp.partial`), 'in progress') // must survive
    writeFileSync(join(dir, 'catalog.sqlite'), Buffer.alloc(4096))

    expect(storageUsage({ catalogFile: join(dir, 'catalog.sqlite'), thumbnailsDir: thumbs, previewsDir: join(dir, 'previews') })).toEqual({
      catalogBytes: 4096,
      thumbnails: { files: 2, bytes: 1500 },
      previews: { files: 0, bytes: 0 },
    })
    expect(clearCacheFolder(thumbs)).toBe(2)
    expect(readdirSync(thumbs).sort()).toEqual([`${sha(3)}.webp.partial`, 'holiday.jpg'])
    expect(clearCacheFolder(join(dir, 'missing'))).toBe(0)
  })
})
