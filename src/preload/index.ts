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
  reconnectSource: (input) => ipcRenderer.invoke(channelFor('sources:reconnect'), input),
  sourceRemovalImpact: (input) => ipcRenderer.invoke(channelFor('sources:removeImpact'), input),
  removeSource: (input) => ipcRenderer.invoke(channelFor('sources:remove'), input),
  pauseScan: (input) => ipcRenderer.invoke(channelFor('scan:pause'), input),
  cancelScan: (input) => ipcRenderer.invoke(channelFor('scan:cancel'), input),
  queryLibrary: (input) => ipcRenderer.invoke(channelFor('library:query'), input),
  listMoments: () => ipcRenderer.invoke(channelFor('moments:list')),
  updateMoment: (input) => ipcRenderer.invoke(channelFor('moments:update'), input),
  listAlbums: () => ipcRenderer.invoke(channelFor('albums:list')),
  createAlbum: (input) => ipcRenderer.invoke(channelFor('albums:create'), input),
  renameAlbum: (input) => ipcRenderer.invoke(channelFor('albums:rename'), input),
  deleteAlbum: (input) => ipcRenderer.invoke(channelFor('albums:delete'), input),
  addPhotosToAlbum: (input) => ipcRenderer.invoke(channelFor('albums:addPhotos'), input),
  removePhotoFromAlbum: (input) => ipcRenderer.invoke(channelFor('albums:removePhoto'), input),
  movePhotoInAlbum: (input) => ipcRenderer.invoke(channelFor('albums:move'), input),
  undoAlbumEdit: (input) => ipcRenderer.invoke(channelFor('albums:undo'), input),
  albumPhotos: (input) => ipcRenderer.invoke(channelFor('albums:photos'), input),
  listSets: () => ipcRenderer.invoke(channelFor('sets:list')),
  getSet: (input) => ipcRenderer.invoke(channelFor('sets:get'), input),
  saveReview: (input) => ipcRenderer.invoke(channelFor('review:save'), input),
  undoReview: (input) => ipcRenderer.invoke(channelFor('review:undo'), input),
  removeFromSet: (input) => ipcRenderer.invoke(channelFor('sets:removeMember'), input),
  addToSet: (input) => ipcRenderer.invoke(channelFor('sets:addMember'), input),
  ungroupSet: (input) => ipcRenderer.invoke(channelFor('sets:ungroup'), input),
  nearbyPhotos: (input) => ipcRenderer.invoke(channelFor('sets:nearby'), input),
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
