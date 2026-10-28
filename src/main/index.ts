import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc/register'
import { registerAppSchemeAsPrivileged, serveRendererFromAppScheme } from './security/app-protocol'
import { applyDevelopmentCsp, denyAllPermissions, hardenAllWebContents } from './security/harden'
import { APP_ENTRY_URL, APP_ORIGIN, isTrustedRendererUrl } from './security/policy'

// electron-vite sets this only for `npm run dev`. A built app always uses app://.
const devServerUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
const devServerOrigin = devServerUrl ? new URL(devServerUrl).origin : undefined
const trustedOrigins = devServerOrigin ? [APP_ORIGIN, devServerOrigin] : [APP_ORIGIN]

// Sandbox every renderer, even ones that forget to ask for it.
app.enableSandbox()
registerAppSchemeAsPrivileged()
hardenAllWebContents(trustedOrigins)

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

  window.once('ready-to-show', () => window.show())
  void window.loadURL(devServerUrl ?? APP_ENTRY_URL)
  return window
}

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
