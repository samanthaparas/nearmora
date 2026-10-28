/**
 * Runs before the UI loads and builds `window.nearmora`, the bridge between the UI and the main process.
 * It's the only place the UI's capabilities are granted, so it stays small and explicit.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { NearmoraApi } from '@shared/bridge-api'
import { channelFor } from '@shared/ipc-channels'

// Each method sends one specific command. We never expose `ipcRenderer` itself,
// which would let the page send any message it liked.
const api: NearmoraApi = {
  getAppInfo: () => ipcRenderer.invoke(channelFor('app:getInfo')),
}

// Frozen so page scripts can't add or replace methods on the bridge.
contextBridge.exposeInMainWorld('nearmora', Object.freeze(api))
