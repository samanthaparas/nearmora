/**
 * The list of everything the UI is allowed to ask the main process to do, with the exact shape of each request and reply.
 * It's the single source of truth for the security boundary between the UI and the rest of the computer.
 */

import { z } from 'zod'
import { FORMAT_IDS, type FormatId } from './studio/formats'
import { DesignSchema } from './studio/design'
import { ParamsSchema } from './studio/params'

const id = z.uuid()
const count = z.number().int().nonnegative()

/** What a scan found, by outcome. Shown to explain why some files aren't in the Library (AC2). */
export const ScanCounts = z.object({
  found: count,
  indexed: count,
  unchanged: count,
  unsupported: count,
  corrupt: count,
  tooLarge: count,
  unreadable: count,
})
export type ScanCounts = z.infer<typeof ScanCounts>

// Sources are described by name and status; the UI never receives or sends a file path.
const SourceSummary = z.object({
  id,
  displayName: z.string(),
  status: z.enum(['active', 'disconnected', 'permission_denied', 'removed']),
  lastScanAt: z.number().int().nullable(),
  lastScan: ScanCounts.nullable(),
  /** How the last scan ended. 'paused' (including a scan interrupted by quitting) can be resumed. */
  lastScanState: z.enum(['done', 'paused', 'cancelled', 'failed']).nullable(),
  /** Distinct pictures available in this folder; identical copies count once. */
  pictureCount: count,
  /** Files that are byte-identical copies of a picture already counted. */
  duplicateCount: count,
  scanning: z.boolean(),
})
export type SourceSummary = z.infer<typeof SourceSummary>

const AlbumSummary = z.object({ id, title: z.string(), photoCount: count, coverAssetId: id.nullable() })
const albumTitle = z.string().trim().min(1).max(120)
const LibraryItem = z.object({
  id,
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  capturedAt: z.number().int().nullable(),
  /** Only reachable through a disconnected folder: the cached thumbnail shows, the original can't be opened. */
  offline: z.boolean(),
  favorite: z.boolean(),
})
const reviewStatus = z.enum(['unreviewed', 'deferred', 'reviewed'])
const revision = z.number().int().nonnegative()
/** The set changed since the screen loaded it (for example, a scan regrouped it). Nothing was written. */
const Stale = z.object({ status: z.literal('stale') })

const format = z.enum(FORMAT_IDS as [FormatId, ...FormatId[]])
const templateId = z.string().min(1).max(80)
const crop = z.object({ cx: z.number().min(0).max(1), cy: z.number().min(0).max(1), zoom: z.number().min(1).max(4) })
const ProjectSummary = z.object({
  id,
  title: z.string(),
  templateId,
  templateVersion: z.number().int().positive(),
  format,
  photoCount: count,
  coverAssetId: id.nullable(),
  updatedAt: z.number().int(),
})
const ProjectDetail = z.object({
  id,
  title: z.string(),
  templateId,
  templateVersion: z.number().int().positive(),
  format,
  params: ParamsSchema,
  updatedAt: z.number().int(),
  items: z.array(
    z.object({
      position: count,
      // Null for a place emptied in the editor (S6a).
      assetId: id.nullable(),
      crop,
      fit: z.enum(['fill', 'fit']),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
      available: z.boolean(),
      fileName: z.string().nullable(),
      folderName: z.string().nullable(),
    }),
  ),
})

// Clean up (ADR-0019). Pictures and copies are named by catalogue id only; the UI never sends a path.
const removeMode = z.enum(['trash', 'forever'])
const fileName = z.string()
/** Why a file was left alone: its folder is offline, it's gone or changed since the scan, it isn't an ordinary file
 * inside the folder, it's the picture's last copy, or the Trash or delete step itself failed. */
const RefusalReason = z.enum(['offline', 'missing', 'changed', 'not_a_file', 'outside_folder', 'last_copy', 'failed'])

// My templates (S6b): a customised layout saved under the person's own name; no photos are stored in it.
const MyTemplate = z.object({
  id,
  name: z.string(),
  templateId,
  templateVersion: z.number().int().positive(),
  format,
  params: ParamsSchema,
  places: count,
  photos: count,
})

/** Album edits return an undo id: passing it to albums:undo puts the album back as it was before that edit. */
const UndoResult = z.object({ undoId: z.number().int().positive() })

/**
 * Every command the renderer may send to the main process.
 *
 * TypeScript types vanish at runtime, so each command also carries Zod schemas.
 * Main validates input before running a handler, and validates output before
 * replying, so a bug in a handler can't leak extra fields to the renderer.
 *
 * Only the main process imports this file as a value. The renderer and preload
 * use `import type`, which keeps Zod out of their bundles.
 */
export const commands = {
  'app:getInfo': {
    input: z.undefined(),
    output: z.object({
      name: z.string(),
      version: z.string(),
    }),
  },
  // Main opens the folder picker itself, so the UI never supplies a path (roadmap §6.5).
  'sources:add': {
    input: z.undefined(),
    output: z.discriminatedUnion('status', [
      z.object({ status: z.literal('added'), source: SourceSummary }),
      z.object({ status: z.literal('cancelled') }),
      z.object({ status: z.literal('refused'), reason: z.enum(['unavailable', 'overlap', 'app_data']) }),
    ]),
  },
  'sources:list': {
    input: z.undefined(),
    output: z.array(SourceSummary),
  },
  // Also resumes a paused scan: unchanged files are skipped, so it carries on where it stopped.
  'sources:rescan': {
    input: z.object({ sourceId: id }),
    output: z.object({ started: z.boolean() }),
  },
  // For a folder that went offline: checks it's the same folder before using it again.
  'sources:reconnect': {
    input: z.object({ sourceId: id }),
    output: z.object({ result: z.enum(['reconnected', 'unavailable', 'permission_denied', 'different_folder']) }),
  },
  'sources:removeImpact': {
    input: z.object({ sourceId: id }),
    output: z.object({ photoFiles: count, picturesOnlyHere: count, favoritesOnlyHere: count, albumsAffected: count }),
  },
  // Removes the folder from the catalog only. Files on disk are never touched.
  'sources:remove': {
    input: z.object({ sourceId: id }),
    output: z.object({ removed: z.boolean() }),
  },
  'scan:pause': {
    input: z.object({ sourceId: id }),
    output: z.object({ paused: z.boolean() }),
  },
  'scan:cancel': {
    input: z.object({ sourceId: id }),
    output: z.object({ cancelled: z.boolean() }),
  },
  'library:query': {
    input: z.object({
      limit: z.number().int().min(1).max(500),
      // Continue after this photo (keyset paging); omit for the first page.
      cursor: z.object({ capturedAt: z.number().int().nullable(), id }).nullable().optional(),
      filters: z
        .object({
          search: z.string().max(200).optional(),
          from: z.number().int().optional(),
          to: z.number().int().optional(),
          sourceId: id.optional(),
          favoritesOnly: z.boolean().optional(),
          momentId: id.optional(),
        })
        .optional(),
    }),
    output: z.object({
      items: z.array(LibraryItem),
      total: count,
      nextCursor: z.object({ capturedAt: z.number().int().nullable(), id }).nullable(),
    }),
  },
  'moments:list': {
    input: z.undefined(),
    output: z.array(
      z.object({
        id,
        // The person's title, or null to show the date-based one.
        title: z.string().nullable(),
        autoTitle: z.string(),
        startsAt: z.number().int(),
        endsAt: z.number().int(),
        photoCount: count,
        coverAssetId: id.nullable(),
      }),
    ),
  },
  'moments:update': {
    input: z.object({
      momentId: id,
      title: z.string().trim().min(1).max(120).nullable().optional(),
      coverAssetId: id.nullable().optional(),
    }),
    output: z.object({ updated: z.literal(true) }),
  },
  // Albums (AC12): references to pictures only. No album command touches a photo file.
  'albums:list': {
    input: z.undefined(),
    output: z.array(AlbumSummary),
  },
  'albums:create': {
    input: z.object({ title: albumTitle }),
    output: AlbumSummary,
  },
  'albums:rename': {
    input: z.object({ albumId: id, title: albumTitle }),
    output: UndoResult,
  },
  'albums:delete': {
    input: z.object({ albumId: id }),
    output: UndoResult,
  },
  'albums:addPhotos': {
    input: z.object({ albumId: id, assetIds: z.array(id).min(1).max(500) }),
    output: z.object({ added: count, undoId: z.number().int().positive() }),
  },
  // Favorite or unfavorite photos chosen in the Library; returns only the ones whose state changed (for Undo).
  'favorites:set': {
    input: z.object({ assetIds: z.array(id).min(1).max(500), favorite: z.boolean() }),
    output: z.object({ changed: z.array(id) }),
  },
  'albums:removePhoto': {
    input: z.object({ albumId: id, assetId: id }),
    output: UndoResult,
  },
  'albums:move': {
    input: z.object({ albumId: id, assetId: id, toIndex: z.number().int().nonnegative() }),
    output: UndoResult,
  },
  'albums:undo': {
    input: UndoResult,
    output: z.object({ albumId: id }),
  },
  // Best Moments (AC3, AC4, AC13). Every change names the revision the screen showed, so stale screens can't overwrite.
  'sets:list': {
    input: z.undefined(),
    output: z.array(
      z.object({
        id,
        reason: z.enum(['exact', 'visual', 'manual']),
        reviewStatus,
        revision,
        photoCount: count,
        favoriteCount: count,
        coverAssetId: id,
        firstCapturedAt: z.number().int().nullable(),
      }),
    ),
  },
  'sets:get': {
    input: z.object({ setId: id }),
    output: z.object({
      id,
      reason: z.enum(['exact', 'visual', 'manual']),
      algorithmVersion: z.string(),
      reviewStatus,
      revision,
      members: z.array(
        z.object({
          assetId: id,
          favorite: z.boolean(),
          width: z.number().int().nullable(),
          height: z.number().int().nullable(),
          capturedAt: z.number().int().nullable(),
          offline: z.boolean(),
          addedByYou: z.boolean(),
        }),
      ),
    }),
  },
  // Saves favorites and status together. Zero, one or several favorites are all valid.
  'review:save': {
    input: z.object({ setId: id, favorites: z.array(id).max(500), status: reviewStatus, expectedRevision: revision }),
    output: z.discriminatedUnion('status', [z.object({ status: z.literal('saved'), revision, undoId: z.number().int().positive() }), Stale]),
  },
  'review:undo': {
    input: z.object({ undoId: z.number().int().positive() }),
    output: z.discriminatedUnion('status', [z.object({ status: z.literal('undone'), revision }), Stale]),
  },
  'sets:removeMember': {
    input: z.object({ setId: id, assetId: id, expectedRevision: revision }),
    output: z.discriminatedUnion('status', [z.object({ status: z.literal('done'), revision, dissolved: z.boolean() }), Stale]),
  },
  'sets:addMember': {
    input: z.object({ setId: id, assetId: id, expectedRevision: revision }),
    output: z.discriminatedUnion('status', [z.object({ status: z.literal('done'), revision }), Stale]),
  },
  'sets:ungroup': {
    input: z.object({ setId: id, expectedRevision: revision }),
    output: z.discriminatedUnion('status', [z.object({ status: z.literal('done'), revision }), Stale]),
  },
  'sets:nearby': {
    input: z.object({ setId: id }),
    output: z.array(z.object({ assetId: id, capturedAt: z.number().int().nullable(), offline: z.boolean() })),
  },
  // Memory Studio (AC6). Every edit is saved at once; projects reference pictures only.
  'projects:list': { input: z.undefined(), output: z.array(ProjectSummary) },
  'projects:get': { input: z.object({ projectId: id }), output: ProjectDetail },
  'projects:create': {
    input: z.object({ templateId, format, assetIds: z.array(id).min(2).max(10) }),
    output: ProjectDetail,
  },
  'projects:rename': { input: z.object({ projectId: id, title: z.string().trim().min(1).max(120) }), output: ProjectDetail },
  // Every Quick edit, undo, redo and reset saves the project's whole design in one step.
  'projects:setDesign': { input: z.object({ projectId: id, design: DesignSchema }), output: ProjectDetail },
  'projects:delete': { input: z.object({ projectId: id }), output: z.object({ deleted: z.literal(true) }) },
  'myTemplates:list': { input: z.undefined(), output: z.array(MyTemplate) },
  'myTemplates:save': { input: z.object({ projectId: id, name: z.string().trim().min(1).max(80) }), output: MyTemplate },
  'myTemplates:delete': { input: z.object({ id }), output: z.object({ deleted: z.literal(true) }) },
  // The chosen photos fill the template's places in order; removed places stay removed.
  'projects:createFromMine': { input: z.object({ myTemplateId: id, assetIds: z.array(id).min(1).max(10) }), output: ProjectDetail },
  // Export (AC7, AC8). Main opens the destination picker; nothing is written until every check passes.
  'export:start': {
    // `wholeDesign`: a seamless carousel also saves its whole design as one wide file, next to the slides.
    input: z.object({ projectId: id, wholeDesign: z.boolean().optional() }),
    output: z.discriminatedUnion('status', [
      z.object({ status: z.literal('started'), jobId: id, fileCount: count }),
      z.object({ status: z.literal('cancelled') }),
      z.object({
        status: z.literal('refused'),
        reason: z.enum(['unavailable', 'changed', 'inside_source', 'app_data', 'unwritable']),
        files: z.array(z.string()).optional(),
      }),
    ]),
  },
  'export:cancel': { input: z.object({ jobId: id }), output: z.object({ cancelled: z.boolean() }) },
  // Opens Finder at a finished export's folder. Only folders this app just exported can be shown.
  'export:reveal': { input: z.object({ jobId: id }), output: z.object({ shown: z.boolean() }) },
  // Settings (AC9): what's stored, and clearing the caches that can be rebuilt.
  'settings:storage': {
    input: z.undefined(),
    output: z.object({
      catalogBytes: count,
      thumbnails: z.object({ files: count, bytes: count }),
      previews: z.object({ files: count, bytes: count }),
    }),
  },
  'settings:clearCache': {
    input: z.object({ cache: z.enum(['previews', 'thumbnails']) }),
    output: z.object({ removed: count, rescanning: count }),
  },
  'albums:photos': {
    input: z.object({ albumId: id, afterPosition: z.number().int().nullable().optional(), limit: z.number().int().min(1).max(500) }),
    output: z.object({ items: z.array(LibraryItem), total: count, nextAfter: z.number().int().nullable() }),
  },
  // Clean up (ADR-0019): "Don't need" marks are notes only; nothing is removed until cleanup:remove is confirmed.
  'cleanup:mark': {
    input: z.object({ assetIds: z.array(id).min(1).max(500), unneeded: z.boolean() }),
    output: z.object({ changed: z.array(id) }),
  },
  'cleanup:unneeded': {
    input: z.undefined(),
    output: z.object({
      items: z.array(
        z.object({
          assetId: id,
          width: z.number().int().nullable(),
          height: z.number().int().nullable(),
          capturedAt: z.number().int().nullable(),
          fileName,
          folderName: z.string(),
          files: count,
          bytes: count,
          offline: z.boolean(),
          /** Titles of Studio projects using this picture; while there are any, it can't be removed. */
          usedIn: z.array(z.string()),
        }),
      ),
      total: count,
    }),
  },
  'cleanup:duplicates': {
    input: z.undefined(),
    output: z.object({
      groups: z.array(
        z.object({
          assetId: id,
          copies: z.array(z.object({ locationId: id, fileName, folderName: z.string(), subfolder: z.string(), bytes: count, offline: z.boolean() })),
        }),
      ),
      total: count,
    }),
  },
  // Main re-checks every file before removing it. "forever" also asks in a native macOS dialog the UI can't skip.
  'cleanup:remove': {
    input: z
      .object({ pictures: z.array(id).max(1000), copies: z.array(id).max(1000), mode: removeMode })
      .refine((v) => v.pictures.length + v.copies.length > 0, 'nothing to remove'),
    output: z.discriminatedUnion('status', [
      z.object({ status: z.literal('cancelled') }),
      /** A scan or another removal is running; nothing was touched. */
      z.object({ status: z.literal('busy') }),
      z.object({
        status: z.literal('done'),
        mode: removeMode,
        removed: count,
        bytes: count,
        refused: z.array(z.object({ fileName, folderName: z.string(), reason: RefusalReason })),
        blocked: z.array(z.object({ fileName, projects: z.array(z.string()) })),
      }),
    ]),
  },
  'cleanup:history': {
    input: z.undefined(),
    output: z.array(z.object({ removedAt: z.number().int(), mode: removeMode, fileName, folderName: z.string(), sizeBytes: count })),
  },
} as const

export type Commands = typeof commands
export type CommandName = keyof Commands
export type CommandInput<C extends CommandName> = z.input<Commands[C]['input']>
export type CommandOutput<C extends CommandName> = z.output<Commands[C]['output']>

/** Error codes are deliberately coarse: no messages, paths or stack traces cross the bridge. */
export type IpcErrorCode = 'UNTRUSTED_SENDER' | 'UNKNOWN_COMMAND' | 'INVALID_INPUT' | 'INTERNAL'

/** Messages main pushes to the UI on one channel: scan progress and export progress. */
export type MainEvent =
  | {
      type: 'scan'
      sourceId: string
      state: 'running' | 'done' | 'paused' | 'cancelled' | 'failed'
      counts: ScanCounts
    }
  | {
      type: 'export'
      jobId: string
      projectId: string
      state: 'running' | 'done' | 'cancelled' | 'failed'
      done: number
      total: number
      /** The finished folder's name (not its path), when done. */
      folderName?: string
      reason?: 'disk_full' | 'unreadable' | 'failed' | 'verify_failed'
    }

/** A discriminated union: check `ok` and TypeScript narrows to `data` or `error`. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: IpcErrorCode } }
