import { app, session, type Session } from 'electron'
import { contentSecurityPolicy, isTrustedRendererUrl } from './policy'

/**
 * App-wide guards that apply to every web page Electron creates, including
 * any we create by mistake later. Based on the Electron security checklist:
 * https://www.electronjs.org/docs/latest/tutorial/security
 */
export function hardenAllWebContents(trustedOrigins: readonly string[]): void {
  app.on('web-contents-created', (_event, contents) => {
    // Nearmora is a single-page app: it never needs to navigate the window.
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedRendererUrl(url, trustedOrigins)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedRendererUrl(url, trustedOrigins)) event.preventDefault()
    })
    // No pop-ups or new windows, and no <webview> tags.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

/** Deny every browser permission request: camera, microphone, location, notifications, etc. */
export function denyAllPermissions(target: Session = session.defaultSession): void {
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  target.setPermissionCheckHandler(() => false)
  target.setDevicePermissionHandler(() => false)
}

/** Development only: add the dev CSP to pages served by the Vite dev server. */
export function applyDevelopmentCsp(devServerOrigin: string, target: Session = session.defaultSession): void {
  const csp = contentSecurityPolicy('development')
  target.webRequest.onHeadersReceived((details, callback) => {
    if (!isTrustedRendererUrl(details.url, [devServerOrigin])) {
      callback({ responseHeaders: details.responseHeaders ?? {} })
      return
    }
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
    })
  })
}
