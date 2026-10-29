/**
 * Runs before the UI loads and builds `window.nearmora`, the bridge between the UI and the main process.
 * It's the only place the UI's capabilities are granted, so it stays small and explicit.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { NearmoraApi } from '@shared/bridge-api'
import type { MainEvent } from '@shared/ipc-contract'
import { channelFor, EVENT_CHANNEL } from '@shared/ipc-channels'

// Each method sends one specific command. We never expose `ipcRenderer` itself,
// which would let the page send any message it liked.
const api: NearmoraApi = {
  getAppInfo: () => ipcRenderer.invoke(channelFor('app:getInfo')),
  addSource: () => ipcRenderer.invoke(channelFor('sources:add')),
  listSources: () => ipcRenderer.invoke(channelFor('sources:list')),
  rescanSource: (input) => ipcRenderer.invoke(channelFor('sources:rescan'), input),
  cancelScan: (input) => ipcRenderer.invoke(channelFor('scan:cancel'), input),
  queryLibrary: (input) => ipcRenderer.invoke(channelFor('library:query'), input),
  // The listener gets only the event data, never Electron's event object (which carries `sender`).
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: MainEvent) => listener(payload)
    ipcRenderer.on(EVENT_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNEL, handler)
    }
  },
}

// Frozen so page scripts can't add or replace methods on the bridge.
contextBridge.exposeInMainWorld('nearmora', Object.freeze(api))
