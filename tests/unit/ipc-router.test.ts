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
    'sources:add': () => ({ status: 'cancelled' }),
    'sources:list': () => [],
    'sources:rescan': () => ({ started: false }),
    'scan:cancel': () => ({ cancelled: false }),
    'library:query': () => ({ items: [], total: 0 }),
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
