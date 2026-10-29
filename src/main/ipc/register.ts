/**
 * Connects the router to Electron's IPC system and holds the handler for each command.
 * When a new capability is added, its handler goes here.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { commands, type CommandName } from '@shared/ipc-contract'
import { channelFor } from '@shared/ipc-channels'
import type { Catalog } from '../catalog/database'
import { queryLibrary } from '../catalog/repositories/library'
import { listMoments, updateMoment } from '../catalog/repositories/moments'
import type { LibraryService } from '../library/library-service'
import { createRouter, type Handlers } from './router'

export interface HandlerContext {
  db: Catalog
  library: LibraryService
}

// One handler per command in ipc-contract.ts. The Handlers type makes a missing one a compile error.
export function createHandlers({ db, library }: HandlerContext): Handlers {
  return {
    'app:getInfo': () => ({ name: app.getName(), version: app.getVersion() }),

    // The folder picker runs here in main, so the path never passes through the UI.
    'sources:add': async () => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options: Electron.OpenDialogOptions = { title: 'Choose a photo folder', properties: ['openDirectory'], buttonLabel: 'Add folder' }
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      const path = picked.filePaths[0]
      if (picked.canceled || !path) return { status: 'cancelled' as const }

      const result = library.addFolder(path)
      return result.ok ? { status: 'added' as const, source: library.summarize(result.source) } : { status: 'refused' as const, reason: result.reason }
    },
    'sources:list': () => library.listSources(),
    'sources:rescan': ({ sourceId }) => ({ started: library.startScan(sourceId) }),
    'sources:reconnect': async ({ sourceId }) => ({ result: await library.reconnect(sourceId) }),
    'sources:removeImpact': ({ sourceId }) => library.removalImpact(sourceId),
    'sources:remove': ({ sourceId }) => ({ removed: library.remove(sourceId) }),
    'scan:pause': ({ sourceId }) => ({ paused: library.pauseScan(sourceId) }),
    'scan:cancel': ({ sourceId }) => ({ cancelled: library.cancelScan(sourceId) }),
    // Zod has already checked the shape; optional fields that are absent are simply left out.
    'library:query': ({ limit, cursor, filters }) => queryLibrary(db, { limit, cursor: cursor ?? null, filters: withoutUndefined(filters ?? {}) }),
    'moments:list': () => listMoments(db),
    'moments:update': (edit) => {
      updateMoment(db, withoutUndefined(edit))
      return { updated: true as const }
    },
  }
}

// exactOptionalPropertyTypes: an optional field must be absent, not present-but-undefined.
function withoutUndefined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> }
}

// Wires each command to an IPC channel. Every call goes through the router's checks first.
export function registerIpc(handlers: Handlers, isTrustedSender: (url: string | undefined) => boolean): void {
  const dispatch = createRouter({
    handlers,
    isTrustedSender,
    logError: (command, code, cause) => console.warn(`[ipc] ${command} rejected: ${code}`, code === 'INTERNAL' ? cause : ''),
  })

  for (const command of Object.keys(commands) as CommandName[]) {
    // senderFrame is the frame that sent the message; it can be null if that
    // frame has already navigated away or been destroyed.
    ipcMain.handle(channelFor(command), (event, payload: unknown) =>
      dispatch(command, event.senderFrame?.url, payload),
    )
  }
}
