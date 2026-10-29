/**
 * Entry point of the main process: the part of Nearmora with full access to the computer.
 * It turns on the security guards, opens the catalog, serves the UI and opens the window, in that order.
 * Run with --self-test it instead checks the native libraries and exits (used by CI on packaged builds).
 */

import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { EVENT_CHANNEL } from '@shared/ipc-channels'
import { replaceCatalogFile } from './catalog/backup'
import { openCatalog, type Catalog } from './catalog/database'
import { CatalogError, MigrationError } from './catalog/errors'
import { createHandlers, registerIpc } from './ipc/register'
import { createLibraryService } from './library/library-service'
import { markInterruptedScansPaused } from './library/scan'
import { recoverInterruptedExports } from './studio/export'
import { createExportService } from './studio/export-service'
import { createPreviewResolver } from './library/previews'
import { thumbnailPathForAsset } from './library/thumbnails'
import { MediaWorker } from './media/worker-client'
import { runSelfTest, SELF_TEST_FLAG, SELF_TEST_MARKER } from './self-test'
import { registerPrivilegedSchemes, serveRendererFromAppScheme } from './security/app-protocol'
import { serveMedia } from './security/media-protocol'
import { applyDevelopmentCsp, denyAllPermissions, hardenAllWebContents } from './security/harden'
import { APP_ENTRY_URL, APP_ORIGIN, isTrustedRendererUrl } from './security/policy'

// electron-vite sets this only for `npm run dev`. A built app always uses app://.
const devServerUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
const devServerOrigin = devServerUrl ? new URL(devServerUrl).origin : undefined
const trustedOrigins = devServerOrigin ? [APP_ORIGIN, devServerOrigin] : [APP_ORIGIN]

// Creates the app window with every security option written out explicitly.
function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'Nearmora',
    backgroundColor: '#F8F0E8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // These are Electron's defaults today. Writing them out makes the
      // security posture visible in code review and protects against a
      // future default changing.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  })

  // A page with unsaved work (Best Moments picks) blocks unloading; ask before quitting or closing anyway.
  // "Keep reviewing" is the default and the Escape choice, so nothing is lost by habit.
  window.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question',
      message: 'Quit without saving your choices?',
      detail: 'You picked favorites in Best Moments but haven’t saved them.',
      buttons: ['Keep reviewing', 'Quit without saving'],
      defaultId: 0,
      cancelId: 0,
    })
    if (choice === 1) event.preventDefault() // preventDefault here means "ignore the page's objection and close"
  })

  // Show the window only once it has painted, so the user never sees a blank flash.
  window.once('ready-to-show', () => window.show())
  void window.loadURL(devServerUrl ?? APP_ENTRY_URL)
  return window
}

// Where Nearmora keeps its own data: the catalog, its backups and the thumbnail cache. Never inside a photo folder.
function appDataPaths() {
  const appDataDir = app.getPath('userData')
  // The catalog describes someone's photo collection, so only their user account may read it.
  mkdirSync(appDataDir, { recursive: true, mode: 0o700 })
  chmodSync(appDataDir, 0o700)
  const thumbnailsDir = join(appDataDir, 'thumbnails')
  mkdirSync(thumbnailsDir, { recursive: true })
  return { appDataDir, thumbnailsDir, catalogFile: join(appDataDir, 'catalog.sqlite'), backupDir: join(appDataDir, 'backups') }
}

// Opens the catalog, or explains why it can't and returns undefined so the app quits without touching anything.
async function openCatalogOrExplain(paths: ReturnType<typeof appDataPaths>): Promise<Catalog | undefined> {
  try {
    return await openCatalog(paths.catalogFile, { backupDir: paths.backupDir })
  } catch (error: unknown) {
    if (error instanceof MigrationError && error.backupPath) {
      const { response } = await dialog.showMessageBox({
        type: 'error',
        message: 'Nearmora couldn’t update its catalog.',
        detail:
          'The update was undone, so your catalog should be as it was. Your photos were never touched. ' +
          'A copy from before the update was also saved. Restore it only if Nearmora still won’t open.',
        buttons: ['Quit', 'Restore saved copy and quit'],
        defaultId: 0,
        cancelId: 0,
      })
      if (response === 1) replaceCatalogFile(error.backupPath, paths.catalogFile)
    } else if (error instanceof CatalogError && error.code === 'CATALOG_TOO_NEW') {
      dialog.showErrorBox('This catalog needs a newer Nearmora', 'It was last used by a newer version of Nearmora. Nothing has been changed.')
    } else {
      console.error('[catalog] could not open', error)
      dialog.showErrorBox('Nearmora couldn’t open its catalog', 'Your photos were not touched. Please try again.')
    }
    return undefined
  }
}

// Normal startup. The calls before whenReady() must happen before Electron is ready.
function startApp(): void {
  // Tests point the app at a throwaway profile. Only honoured in unpackaged builds, so a shipped app can't be redirected.
  const testProfile = !app.isPackaged ? process.env['NEARMORA_USER_DATA_DIR'] : undefined
  if (testProfile) app.setPath('userData', testProfile)

  // Sandbox every renderer, even ones that forget to ask for it.
  app.enableSandbox()
  registerPrivilegedSchemes()
  hardenAllWebContents(trustedOrigins)

  // Once Electron is ready: install the guards first, then open the catalog, then the window.
  void app.whenReady().then(async () => {
    denyAllPermissions()
    if (devServerOrigin) applyDevelopmentCsp(devServerOrigin)

    const paths = appDataPaths()
    const db = await openCatalogOrExplain(paths)
    if (!db) {
      app.quit()
      return
    }

    // A scan cut short by quitting or a crash is offered for resuming, never shown as finished; an export cut short
    // has its half-made staging folder removed, so nothing unfinished looks finished.
    markInterruptedScansPaused(db)
    recoverInterruptedExports(db)

    const worker = new MediaWorker()
    const library = createLibraryService({
      db,
      appDataDir: paths.appDataDir,
      thumbnailsDir: paths.thumbnailsDir,
      processImage: (request) => worker.process(request),
      emit: (event) => {
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send(EVENT_CHANNEL, event)
      },
    })
    const exports = createExportService({
      db,
      appDataDir: paths.appDataDir,
      render: (request) => worker.render(request),
      emit: (event) => {
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send(EVENT_CHANNEL, event)
      },
    })
    // Pause scans and stop the worker on quit. The catalog is left to close with the process; WAL keeps it consistent.
    app.on('before-quit', () => {
      library.pauseAll()
      exports.cancelAll()
      worker.stop()
    })

    const previewsDir = join(paths.appDataDir, 'previews')
    serveRendererFromAppScheme(join(__dirname, '../renderer'))
    serveMedia({
      thumbnail: (assetId) => thumbnailPathForAsset(db, paths.thumbnailsDir, assetId),
      preview: createPreviewResolver({ db, previewsDir, makePreview: (request) => worker.preview(request) }),
    })
    registerIpc(createHandlers({ db, library, exports, paths: { catalogFile: paths.catalogFile, thumbnailsDir: paths.thumbnailsDir, previewsDir } }), (url) => isTrustedRendererUrl(url, trustedOrigins))

    createMainWindow()

    // macOS: clicking the Dock icon with no windows open should reopen one.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  // Windows and Linux quit when the last window closes; macOS apps conventionally stay open.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

// Diagnostic mode: check the native libraries, catalog and media worker, print one line of JSON, and exit without opening a window.
function runSelfTestAndExit(): void {
  app.dock?.hide()
  // The media worker is an Electron utility process, which can only start once the app is ready.
  void app.whenReady().then(runSelfTest).then((report) => {
    process.stdout.write(`${SELF_TEST_MARKER}${JSON.stringify(report)}\n`)
    app.exit(report.ok ? 0 : 1)
  })
}

if (process.argv.includes(SELF_TEST_FLAG)) runSelfTestAndExit()
else startApp()
