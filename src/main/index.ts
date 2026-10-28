/**
 * Entry point of the main process: the part of Nearmora with full access to the computer.
 * It turns on the security guards, serves the UI and opens the window, in that order.
 * Run with --self-test it instead checks the native libraries and exits (used by CI on packaged builds).
 */

import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc/register'
import { runSelfTest, SELF_TEST_FLAG, SELF_TEST_MARKER } from './self-test'
import { registerAppSchemeAsPrivileged, serveRendererFromAppScheme } from './security/app-protocol'
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

  // Show the window only once it has painted, so the user never sees a blank flash.
  window.once('ready-to-show', () => window.show())
  void window.loadURL(devServerUrl ?? APP_ENTRY_URL)
  return window
}

// Normal startup. The first three calls must happen before Electron is ready.
function startApp(): void {
  // Sandbox every renderer, even ones that forget to ask for it.
  app.enableSandbox()
  registerAppSchemeAsPrivileged()
  hardenAllWebContents(trustedOrigins)

  // Once Electron is ready: install the guards first, then open the window.
  void app.whenReady().then(() => {
    denyAllPermissions()
    if (devServerOrigin) applyDevelopmentCsp(devServerOrigin)
    serveRendererFromAppScheme(join(__dirname, '../renderer'))
    registerIpc((url) => isTrustedRendererUrl(url, trustedOrigins))

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

// Diagnostic mode: check SQLite and sharp, print one line of JSON, and exit without opening a window.
function runSelfTestAndExit(): void {
  app.dock?.hide()
  void runSelfTest().then((report) => {
    process.stdout.write(`${SELF_TEST_MARKER}${JSON.stringify(report)}\n`)
    app.exit(report.ok ? 0 : 1)
  })
}

if (process.argv.includes(SELF_TEST_FLAG)) runSelfTestAndExit()
else startApp()
