/**
 * The TypeScript description of `window.nearmora`, the only API the UI can call.
 * The preload must implement it exactly, and the UI gets autocomplete and type checking from it.
 */

import type { CommandOutput, IpcResult } from './ipc-contract'

/**
 * The complete API the renderer can see, exposed as `window.nearmora`.
 * Adding a capability means adding a named method here, never a generic
 * `invoke(channel, ...)` escape hatch.
 */
export interface NearmoraApi {
  getAppInfo(): Promise<IpcResult<CommandOutput<'app:getInfo'>>>
}
