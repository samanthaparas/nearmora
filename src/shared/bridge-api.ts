/**
 * The TypeScript description of `window.nearmora`, the only API the UI can call.
 * The preload must implement it exactly, and the UI gets autocomplete and type checking from it.
 */

import type { CommandInput, CommandOutput, IpcResult, MainEvent } from './ipc-contract'

/**
 * The complete API the renderer can see, exposed as `window.nearmora`.
 * Adding a capability means adding a named method here, never a generic
 * `invoke(channel, ...)` escape hatch.
 */
export interface NearmoraApi {
  getAppInfo(): Promise<IpcResult<CommandOutput<'app:getInfo'>>>
  /** Opens the macOS folder picker; the chosen folder is added and scanned. */
  addSource(): Promise<IpcResult<CommandOutput<'sources:add'>>>
  listSources(): Promise<IpcResult<CommandOutput<'sources:list'>>>
  rescanSource(input: CommandInput<'sources:rescan'>): Promise<IpcResult<CommandOutput<'sources:rescan'>>>
  reconnectSource(input: CommandInput<'sources:reconnect'>): Promise<IpcResult<CommandOutput<'sources:reconnect'>>>
  sourceRemovalImpact(input: CommandInput<'sources:removeImpact'>): Promise<IpcResult<CommandOutput<'sources:removeImpact'>>>
  removeSource(input: CommandInput<'sources:remove'>): Promise<IpcResult<CommandOutput<'sources:remove'>>>
  pauseScan(input: CommandInput<'scan:pause'>): Promise<IpcResult<CommandOutput<'scan:pause'>>>
  cancelScan(input: CommandInput<'scan:cancel'>): Promise<IpcResult<CommandOutput<'scan:cancel'>>>
  queryLibrary(input: CommandInput<'library:query'>): Promise<IpcResult<CommandOutput<'library:query'>>>
  listMoments(): Promise<IpcResult<CommandOutput<'moments:list'>>>
  updateMoment(input: CommandInput<'moments:update'>): Promise<IpcResult<CommandOutput<'moments:update'>>>
  listAlbums(): Promise<IpcResult<CommandOutput<'albums:list'>>>
  createAlbum(input: CommandInput<'albums:create'>): Promise<IpcResult<CommandOutput<'albums:create'>>>
  renameAlbum(input: CommandInput<'albums:rename'>): Promise<IpcResult<CommandOutput<'albums:rename'>>>
  deleteAlbum(input: CommandInput<'albums:delete'>): Promise<IpcResult<CommandOutput<'albums:delete'>>>
  addPhotosToAlbum(input: CommandInput<'albums:addPhotos'>): Promise<IpcResult<CommandOutput<'albums:addPhotos'>>>
  removePhotoFromAlbum(input: CommandInput<'albums:removePhoto'>): Promise<IpcResult<CommandOutput<'albums:removePhoto'>>>
  movePhotoInAlbum(input: CommandInput<'albums:move'>): Promise<IpcResult<CommandOutput<'albums:move'>>>
  undoAlbumEdit(input: CommandInput<'albums:undo'>): Promise<IpcResult<CommandOutput<'albums:undo'>>>
  albumPhotos(input: CommandInput<'albums:photos'>): Promise<IpcResult<CommandOutput<'albums:photos'>>>
  listSets(): Promise<IpcResult<CommandOutput<'sets:list'>>>
  getSet(input: CommandInput<'sets:get'>): Promise<IpcResult<CommandOutput<'sets:get'>>>
  saveReview(input: CommandInput<'review:save'>): Promise<IpcResult<CommandOutput<'review:save'>>>
  undoReview(input: CommandInput<'review:undo'>): Promise<IpcResult<CommandOutput<'review:undo'>>>
  removeFromSet(input: CommandInput<'sets:removeMember'>): Promise<IpcResult<CommandOutput<'sets:removeMember'>>>
  addToSet(input: CommandInput<'sets:addMember'>): Promise<IpcResult<CommandOutput<'sets:addMember'>>>
  ungroupSet(input: CommandInput<'sets:ungroup'>): Promise<IpcResult<CommandOutput<'sets:ungroup'>>>
  nearbyPhotos(input: CommandInput<'sets:nearby'>): Promise<IpcResult<CommandOutput<'sets:nearby'>>>
  listProjects(): Promise<IpcResult<CommandOutput<'projects:list'>>>
  getProject(input: CommandInput<'projects:get'>): Promise<IpcResult<CommandOutput<'projects:get'>>>
  createProject(input: CommandInput<'projects:create'>): Promise<IpcResult<CommandOutput<'projects:create'>>>
  updateProject(input: CommandInput<'projects:update'>): Promise<IpcResult<CommandOutput<'projects:update'>>>
  reorderProject(input: CommandInput<'projects:reorder'>): Promise<IpcResult<CommandOutput<'projects:reorder'>>>
  setProjectCrop(input: CommandInput<'projects:setCrop'>): Promise<IpcResult<CommandOutput<'projects:setCrop'>>>
  deleteProject(input: CommandInput<'projects:delete'>): Promise<IpcResult<CommandOutput<'projects:delete'>>>
  startExport(input: CommandInput<'export:start'>): Promise<IpcResult<CommandOutput<'export:start'>>>
  cancelExport(input: CommandInput<'export:cancel'>): Promise<IpcResult<CommandOutput<'export:cancel'>>>
  revealExport(input: CommandInput<'export:reveal'>): Promise<IpcResult<CommandOutput<'export:reveal'>>>
  /** Subscribes to events from main. Returns a function that unsubscribes. */
  onEvent(listener: (event: MainEvent) => void): () => void
}
