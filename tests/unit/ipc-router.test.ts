/**
 * Unit tests for the IPC router: the checks that stop untrusted or malformed requests from reaching a handler.
 * If any of these fail, the UI's security boundary is broken.
 */

import { describe, expect, it, vi } from 'vitest'
import { createRouter, type Handlers } from '../../src/main/ipc/router'

const TRUSTED = 'app://nearmora/index.html'

// Builds a router with working default handlers. Each test overrides only what it needs.
function makeRouter(overrides: Partial<Handlers> = {}) {
  const handlers: Handlers = {
    'app:getInfo': () => ({ name: 'Nearmora', version: '0.0.1' }),
    'app:licences': () => [],
    'sources:add': () => ({ status: 'cancelled' }),
    'sources:list': () => [],
    'sources:rescan': () => ({ started: false }),
    'sources:reconnect': () => ({ result: 'unavailable' }),
    'sources:removeImpact': () => ({ photoFiles: 0, picturesOnlyHere: 0, favoritesOnlyHere: 0, albumsAffected: 0 }),
    'sources:remove': () => ({ removed: false }),
    'scan:pause': () => ({ paused: false }),
    'scan:cancel': () => ({ cancelled: false }),
    'library:query': () => ({ items: [], total: 0, nextCursor: null }),
    'moments:list': () => [],
    'moments:update': () => ({ updated: true }),
    'albums:list': () => [],
    'albums:create': () => ({ id: '3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e', title: 'A', photoCount: 0, coverAssetId: null }),
    'albums:rename': () => ({ undoId: 1 }),
    'albums:delete': () => ({ undoId: 1 }),
    'albums:addPhotos': () => ({ added: 0, undoId: 1 }),
    'favorites:set': () => ({ changed: [] }),
    'albums:removePhoto': () => ({ undoId: 1 }),
    'albums:move': () => ({ undoId: 1 }),
    'albums:undo': () => ({ albumId: '3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e' }),
    'albums:photos': () => ({ items: [], total: 0, nextAfter: null }),
    'sets:list': () => [],
    'sets:get': () => ({ id: '3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e', reason: 'visual', algorithmVersion: 'v', reviewStatus: 'unreviewed', revision: 0, members: [] }),
    'review:save': () => ({ status: 'saved', revision: 1, undoId: 1 }),
    'review:undo': () => ({ status: 'undone', revision: 2 }),
    'sets:removeMember': () => ({ status: 'done', revision: 1, dissolved: false }),
    'sets:addMember': () => ({ status: 'done', revision: 1 }),
    'sets:ungroup': () => ({ status: 'done', revision: 1 }),
    'sets:nearby': () => [],
    'projects:list': () => [],
    'projects:get': () => {
      throw new Error('not used')
    },
    'projects:create': () => {
      throw new Error('not used')
    },
    'projects:rename': () => {
      throw new Error('not used')
    },
    'projects:setDesign': () => {
      throw new Error('not used')
    },
    'projects:delete': () => ({ deleted: true }),
    'export:start': () => ({ status: 'cancelled' }),
    'export:cancel': () => ({ cancelled: false }),
    'export:reveal': () => ({ shown: false }),
    'settings:storage': () => ({ catalogBytes: 0, thumbnails: { files: 0, bytes: 0 }, previews: { files: 0, bytes: 0 } }),
    'settings:clearCache': () => ({ removed: 0, rescanning: 0 }),
    'cleanup:mark': () => ({ changed: [] }),
    'cleanup:unneeded': () => ({ items: [], total: 0 }),
    'cleanup:duplicates': () => ({ groups: [], total: 0 }),
    'cleanup:remove': () => ({ status: 'cancelled' }),
    'cleanup:history': () => [],
    'myTemplates:list': () => [],
    'myTemplates:save': () => {
      throw new Error('not used')
    },
    'myTemplates:delete': () => ({ deleted: true }),
    'projects:createFromMine': () => {
      throw new Error('not used')
    },
    ...overrides,
  }
  const logError = vi.fn()
  const dispatch = createRouter({
    handlers,
    isTrustedSender: (url) => url === TRUSTED,
    logError,
  })
  return { dispatch, logError }
}

describe('IPC router', () => {
  it('runs a known command from a trusted sender', async () => {
    const { dispatch } = makeRouter()
    await expect(dispatch('app:getInfo', TRUSTED, undefined)).resolves.toEqual({
      ok: true,
      data: { name: 'Nearmora', version: '0.0.1' },
    })
  })

  it('rejects a sender that is not our renderer, before running anything', async () => {
    const handler = vi.fn(() => ({ name: 'x', version: 'y' }))
    const { dispatch } = makeRouter({ 'app:getInfo': handler })

    for (const sender of ['https://evil.example/', 'file:///etc/passwd', undefined]) {
      await expect(dispatch('app:getInfo', sender, undefined)).resolves.toEqual({
        ok: false,
        error: { code: 'UNTRUSTED_SENDER' },
      })
    }
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects unknown commands, including inherited object keys', async () => {
    const { dispatch } = makeRouter()
    for (const command of ['files:delete', 'toString', '__proto__', 'constructor']) {
      await expect(dispatch(command, TRUSTED, undefined)).resolves.toEqual({
        ok: false,
        error: { code: 'UNKNOWN_COMMAND' },
      })
    }
  })

  it('rejects input that does not match the schema', async () => {
    const handler = vi.fn(() => ({ name: 'x', version: 'y' }))
    const { dispatch } = makeRouter({ 'app:getInfo': handler })

    await expect(dispatch('app:getInfo', TRUSTED, { path: '/Users' })).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('only removes photos named by catalogue id, never by path, and never an empty request', async () => {
    const handler = vi.fn(() => ({ status: 'cancelled' as const }))
    const { dispatch } = makeRouter({ 'cleanup:remove': handler })
    const someId = '3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e'

    for (const payload of [
      { pictures: [], copies: [], mode: 'trash' },
      { pictures: ['/Users/someone/Pictures/IMG_0001.jpg'], copies: [], mode: 'trash' },
      { pictures: [someId], copies: [], mode: 'shred' },
      { pictures: [someId], mode: 'forever' },
    ]) {
      await expect(dispatch('cleanup:remove', TRUSTED, payload)).resolves.toEqual({ ok: false, error: { code: 'INVALID_INPUT' } })
    }
    expect(handler).not.toHaveBeenCalled()

    await expect(dispatch('cleanup:remove', TRUSTED, { pictures: [someId], copies: [], mode: 'trash' })).resolves.toEqual({ ok: true, data: { status: 'cancelled' } })
  })

  it('hides handler errors behind a generic code', async () => {
    const { dispatch, logError } = makeRouter({
      'app:getInfo': () => {
        throw new Error('secret path /Users/someone/photos')
      },
    })

    const result = await dispatch('app:getInfo', TRUSTED, undefined)
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL' } })
    expect(JSON.stringify(result)).not.toContain('/Users')
    expect(logError).toHaveBeenCalledWith('app:getInfo', 'INTERNAL', expect.any(Error))
  })

  it('strips fields a handler returns that the contract does not allow', async () => {
    const { dispatch } = makeRouter({
      // Simulates a handler bug that would leak data. The cast is the bug.
      'app:getInfo': () => ({ name: 'Nearmora', version: '0.0.1', homeDir: '/Users/someone' }) as never,
    })

    const result = await dispatch('app:getInfo', TRUSTED, undefined)
    expect(result).toEqual({ ok: true, data: { name: 'Nearmora', version: '0.0.1' } })
  })

  it('fails closed when a handler returns the wrong shape', async () => {
    const { dispatch } = makeRouter({ 'app:getInfo': () => ({ name: 42 }) as never })
    await expect(dispatch('app:getInfo', TRUSTED, undefined)).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL' },
    })
  })
})
