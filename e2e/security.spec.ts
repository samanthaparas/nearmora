/**
 * End-to-end security tests that launch the real built app and probe it from inside the window.
 * They prove the protections work in Electron itself, not just in isolated functions.
 */

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './launch'

let app: ElectronApplication
let page: Page

// Launch the app once and share it across tests. Starting Electron is the slow part.
test.beforeAll(async () => {
  ;({ app } = await launchApp())
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('loads the UI from the app:// scheme, not file://', async () => {
  expect(page.url()).toBe('app://nearmora/index.html')
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
})

test('renderer has no Node.js access', async () => {
  const globals = await page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    module: typeof (globalThis as Record<string, unknown>)['module'],
  }))
  expect(globals).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined' })
})

test('renderer is sandboxed with context isolation', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // getLastWebPreferences() works at runtime but is missing from Electron 45's
    // type definitions, so we describe its shape ourselves. If Electron removes
    // it, this test fails loudly rather than passing silently.
    const contents = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
      getLastWebPreferences?: () => { sandbox?: boolean; contextIsolation?: boolean; nodeIntegration?: boolean }
    }
    if (typeof contents.getLastWebPreferences !== 'function') return 'getLastWebPreferences unavailable'
    const p = contents.getLastWebPreferences()
    return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration }
  })
  expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false })
})

test('bridge exposes only the named API, frozen', async () => {
  const shape = await page.evaluate(() => ({
    keys: Object.keys(window.nearmora),
    frozen: Object.isFrozen(window.nearmora),
    ipcRenderer: typeof (window as unknown as Record<string, unknown>)['ipcRenderer'],
  }))
  expect(shape).toEqual({
    keys: [
      'getAppInfo',
      'licences',
      'addSource',
      'listSources',
      'rescanSource',
      'reconnectSource',
      'sourceRemovalImpact',
      'removeSource',
      'pauseScan',
      'cancelScan',
      'queryLibrary',
      'listMoments',
      'updateMoment',
      'listAlbums',
      'createAlbum',
      'renameAlbum',
      'deleteAlbum',
      'addPhotosToAlbum',
      'setFavorites',
      'removePhotoFromAlbum',
      'movePhotoInAlbum',
      'undoAlbumEdit',
      'albumPhotos',
      'listSets',
      'getSet',
      'saveReview',
      'undoReview',
      'removeFromSet',
      'addToSet',
      'ungroupSet',
      'nearbyPhotos',
      'listProjects',
      'getProject',
      'createProject',
      'renameProject',
      'setProjectDesign',
      'deleteProject',
      'listMyTemplates',
      'saveMyTemplate',
      'deleteMyTemplate',
      'createProjectFromMine',
      'startExport',
      'cancelExport',
      'revealExport',
      'storageUsage',
      'clearCache',
      'markUnneeded',
      'listUnneeded',
      'listDuplicates',
      'removePhotos',
      'removalHistory',
      'backupStatus',
      'createBackup',
      'chooseBackup',
      'restoreBackup',
      'undoRestore',
      'onEvent',
    ],
    frozen: true,
    ipcRenderer: 'undefined',
  })
})

test('bridge call round-trips through the validated IPC router', async () => {
  const result = await page.evaluate(() => window.nearmora.getAppInfo())
  expect(result).toEqual({ ok: true, data: { name: 'nearmora', version: '0.0.1' } })
  await expect(page.getByText('Version 0.0.1')).toBeVisible()
})

test('CSP blocks inline scripts', async () => {
  const ran = await page.evaluate(async () => {
    const script = document.createElement('script')
    script.textContent = 'window.__inlineRan = true'
    document.body.append(script)
    await new Promise((resolve) => setTimeout(resolve, 50))
    return (window as unknown as Record<string, unknown>)['__inlineRan'] === true
  })
  expect(ran).toBe(false)
})

test('CSP blocks network requests', async () => {
  // A failed fetch alone proves nothing (it could be CORS or no network),
  // so we wait for the browser's own CSP violation report.
  const violation = await page.evaluate(async () => {
    const reported = new Promise<string>((resolve) => {
      document.addEventListener('securitypolicyviolation', (e) => resolve(e.effectiveDirective), { once: true })
      setTimeout(() => resolve('none'), 2000)
    })
    await fetch('https://example.com/', { mode: 'no-cors' }).catch(() => undefined)
    return reported
  })
  expect(violation).toBe('connect-src')
})

test('new windows are denied', async () => {
  const opened = await page.evaluate(() => window.open('https://example.com/') !== null)
  expect(opened).toBe(false)
  expect(app.windows()).toHaveLength(1)
})

test('navigation away from the app is blocked', async () => {
  await page.evaluate(() => {
    window.location.href = 'https://example.com/'
  })
  await page.waitForTimeout(300)
  expect(page.url()).toBe('app://nearmora/index.html')
})

test('browser permission requests are denied', async () => {
  const permission = await page.evaluate(() => Notification.requestPermission())
  expect(permission).toBe('denied')
})

test('the app protocol refuses path traversal', async () => {
  const status = await page.evaluate(async () => {
    const res = await fetch('app://nearmora/%2e%2e/main/index.js').catch(() => null)
    return res?.status ?? 'blocked'
  })
  expect([404, 'blocked']).toContain(status)
})

test('thumbnails are served only by picture id, never by path', async () => {
  const statuses = await page.evaluate(async () => {
    const status = (url: string) => fetch(url).then((r) => r.status, () => 'blocked')
    return {
      unknownId: await status('nm-media://thumb/3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e'),
      path: await status('nm-media://thumb/%2Fetc%2Fpasswd'),
      original: await status('nm-media://original/3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e'),
    }
  })
  // connect-src 'none' already blocks fetch() from the page; if it didn't, the scheme itself answers 404.
  for (const status of Object.values(statuses)) expect([404, 'blocked']).toContain(status)
})
