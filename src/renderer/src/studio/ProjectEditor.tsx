/**
 * Editing one Memory Studio project (AC6): title, layout, format, cream or white background, the order of photos, and each
 * photo's crop position and zoom, all by buttons or keyboard. Every change is saved at once. The preview is drawn
 * from the same composition (template + format + settings) as the export.
 * Photos that can't be reached are named, so nobody discovers it only at export time.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'
import { clampCrop, DEFAULT_CROP, MAX_ZOOM, type Crop } from '@shared/layout'
import { compose, UnknownTemplateError, type Composition } from '@shared/studio/compose'
import { FORMAT_IDS, FORMATS, formatLabel, type FormatId } from '@shared/studio/formats'
import { BACKGROUNDS, type Params } from '@shared/studio/params'
import { templateName, templatesFor } from '@shared/studio/templates'
import { ExportPanel } from './ExportPanel'
import { StudioCanvas } from './StudioCanvas'
import { TemplateIcon } from './TemplateIcon'

type Project = CommandOutput<'projects:get'>
type Item = Project['items'][number]

const PAN_STEP = 0.05
const ZOOM_STEP = 0.25

const describeCrop = (crop: Crop) =>
  `${Math.round(crop.cx * 100)}% across, ${Math.round(crop.cy * 100)}% down, zoom ${Math.round(crop.zoom * 100)}%`

// "1350 × 1080": the output size of a format, as shown on screen.
const sizeOf = (format: FormatId): string => `${FORMATS[format].width} × ${FORMATS[format].height}`

const composeProject = (p: Project): Composition => compose({ ...p, photoCount: p.items.length })

// "cream", "white", or "custom" for any other colour (free colours arrive in phase S2).
const backgroundName = (params: Params): string =>
  Object.entries(BACKGROUNDS).find(([, colour]) => colour === (params.background ?? BACKGROUNDS.cream))?.[0] ?? 'custom'
export function ProjectEditor({ projectId, onClose, onDeleted }: { projectId: string; onClose: () => void; onDeleted: () => void }) {
  const [project, setProject] = useState<Project | null>(null)
  const [selected, setSelected] = useState(0)
  const [titleDraft, setTitleDraft] = useState('')
  const [status, setStatus] = useState<string>('All changes saved')
  const [confirmDelete, setConfirmDelete] = useState(false)
  // A pinch sends many small zoom steps; the preview follows each one, and only the last is saved.
  const pendingZoom = useRef<{ timer: number; position: number; crop: Crop } | null>(null)

  // State is set in the promise callback, after main replies, never synchronously inside an effect.
  const load = useCallback(
    () =>
      window.nearmora.getProject({ projectId }).then((result) => {
        if (!result.ok) return setStatus('This project couldn’t be opened.')
        setProject(result.data)
        setTitleDraft(result.data.title)
      }),
    [projectId],
  )
  useEffect(() => {
    void load()
  }, [load])
  // Leaving the editor mid-pinch still saves the last zoom.
  useEffect(
    () => () => {
      const pending = pendingZoom.current
      if (!pending) return
      window.clearTimeout(pending.timer)
      void window.nearmora.setProjectCrop({ projectId, position: pending.position, crop: pending.crop })
    },
    [projectId],
  )

  if (!project) return <p>{status === 'All changes saved' ? 'Opening project…' : status}</p>
  let composition: Composition
  try {
    composition = composeProject(project)
  } catch (error: unknown) {
    if (!(error instanceof UnknownTemplateError)) throw error
    return <p role="alert">This project uses a layout this version of Nearmora doesn’t know. It is kept as it is; a newer version can open it.</p>
  }
  const item = project.items[selected] ?? project.items[0]!
  const unavailable = project.items.filter((i) => !i.available)

  // Applies a result from main; anything that failed leaves the project as it was and says so.
  function applied(result: { ok: boolean; data?: Project }, what: string) {
    if (result.ok && result.data) {
      setProject(result.data)
      setStatus(`${what}. All changes saved.`)
    } else setStatus(`That change couldn’t be saved. Nothing was changed.`)
  }

  async function settings(change: { title?: string; templateId?: string; format?: FormatId; params?: Params }, what: string) {
    applied(await window.nearmora.updateProject({ projectId, ...change }), what)
  }

  async function move(from: number, to: number) {
    const ids = project!.items.map((i) => i.assetId)
    const [moved] = ids.splice(from, 1)
    ids.splice(to, 0, moved!)
    applied(await window.nearmora.reorderProject({ projectId, assetIds: ids }), `Moved to position ${to + 1}`)
    setSelected(to)
  }

  // Crops are kept within the photo (clampCrop) before saving, using the same layout math as the preview and export.
  async function setCrop(target: Item, next: Crop) {
    const cell = composition.elements[target.position]!.rect
    const crop = target.width && target.height ? clampCrop({ width: target.width, height: target.height }, cell, next) : next
    setProject((p) => p && { ...p, items: p.items.map((i) => (i.position === target.position ? { ...i, crop } : i)) })
    const result = await window.nearmora.setProjectCrop({ projectId, position: target.position, crop })
    setStatus(result.ok ? `Crop: ${describeCrop(crop)}. All changes saved.` : 'That crop couldn’t be saved. Nothing was changed.')
  }
  // Pinch or wheel over a photo: selects it and zooms it right away, then saves once the gesture pauses.
  function wheelZoom(position: number, factor: number) {
    setSelected(position)
    setProject((p) => {
      if (!p) return p
      const target = p.items.find((i) => i.position === position)
      if (!target) return p
      const cell = composeProject(p).elements[position]!.rect
      const next = { ...target.crop, zoom: Math.min(MAX_ZOOM, Math.max(1, target.crop.zoom * factor)) }
      const crop = target.width && target.height ? clampCrop({ width: target.width, height: target.height }, cell, next) : next
      if (pendingZoom.current) window.clearTimeout(pendingZoom.current.timer)
      const timer = window.setTimeout(() => {
        pendingZoom.current = null
        void window.nearmora.setProjectCrop({ projectId, position, crop }).then((result) => {
          setStatus(result.ok ? `Crop: ${describeCrop(crop)}. All changes saved.` : 'That crop couldn’t be saved. Nothing was changed.')
        })
      }, 300)
      pendingZoom.current = { timer, position, crop }
      return { ...p, items: p.items.map((i) => (i.position === position ? { ...i, crop } : i)) }
    })
  }
  const pan = (dx: number, dy: number) => void setCrop(item, { ...item.crop, cx: item.crop.cx + dx, cy: item.crop.cy + dy })
  const zoom = (delta: number) => void setCrop(item, { ...item.crop, zoom: Math.min(MAX_ZOOM, Math.max(1, item.crop.zoom + delta)) })

  // Arrow keys move the photo inside its frame; + and − zoom. Moving right shows more of the photo's right side.
  function onCropKeys(event: KeyboardEvent) {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-PAN_STEP, 0], ArrowRight: [PAN_STEP, 0], ArrowUp: [0, -PAN_STEP], ArrowDown: [0, PAN_STEP] }
    const step = moves[event.key]
    if (step) {
      event.preventDefault()
      pan(step[0], step[1])
    } else if (event.key === '+' || event.key === '=') zoom(ZOOM_STEP)
    else if (event.key === '-') zoom(-ZOOM_STEP)
  }

  const slides = composition.canvasCount
  const name = templateName(project.templateId, project.templateVersion)
  const preview = (canvasIndex: number, width: number) => (
    <StudioCanvas
      key={canvasIndex}
      composition={composition}
      items={project.items}
      canvasIndex={canvasIndex}
      displayWidth={width}
      highlight={item.position}
      onWheelZoom={wheelZoom}
      label={
        composition.mode === 'carousel'
          ? `Preview of slide ${canvasIndex + 1} of ${slides}`
          : `Preview: ${name.toLowerCase()}, ${FORMATS[project.format].label.toLowerCase()}, ${backgroundName(project.params)} background`
      }
    />
  )

  return (
    <section className="studio" aria-labelledby="project-title">
      <div className="moment-header">
        <button type="button" className="button button--quiet" onClick={onClose}>
          ← All projects
        </button>
        <h2 id="project-title" className="moment-header__title">
          {project.title}
        </h2>
        <p className="review__note">
          {name} · {project.items.length} photos · {sizeOf(project.format)}
          {composition.mode === 'carousel' ? ` · ${slides} slides` : ''}
        </p>
      </div>

      <p className="library__undo" aria-live="polite">
        {status}
      </p>

      {/* Named before export, as AC6 asks: which photos can't be read right now, and where they were. */}
      {unavailable.length > 0 ? (
        <div className="library__confirm" role="status">
          <p className="library__confirm-title">
            {unavailable.length} {unavailable.length === 1 ? 'photo is' : 'photos are'} offline
          </p>
          <p className="review__note">
            {unavailable.map((i) => `${i.fileName ?? 'A photo'}${i.folderName ? ` (in “${i.folderName}”)` : ''}`).join(', ')}. You can keep editing; export needs
            them reconnected.
          </p>
        </div>
      ) : null}

      <div className="studio__layout">
        <div className="studio__previews">
          {composition.mode === 'carousel' ? (
            <div className="studio__slides">{Array.from({ length: slides }, (_, i) => preview(i, 220))}</div>
          ) : (
            preview(0, 480)
          )}
        </div>

        <div className="studio__controls">
          <form
            className="moment-header__form"
            onSubmit={(e) => {
              e.preventDefault()
              void settings({ title: titleDraft }, 'Renamed')
            }}
          >
            <label className="library__field">
              <span>Title</span>
              <input value={titleDraft} maxLength={120} onChange={(e) => setTitleDraft(e.target.value)} />
            </label>
            <button type="submit" className="button button--secondary" disabled={titleDraft.trim() === project.title}>
              Save title
            </button>
          </form>

          {/* Any layout that takes this many photos; photos keep their order and crops. */}
          <section aria-labelledby="layout-title">
            <h3 id="layout-title" className="studio__template-title">
              Layout
            </h3>
            <ul className="studio__template-list">
              {templatesFor(project.items.length).map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    className="studio__template"
                    aria-pressed={template.id === project.templateId}
                    title={template.description}
                    onClick={() => {
                      if (template.id !== project.templateId) void settings({ templateId: template.id }, `Layout changed to ${template.name}`)
                    }}
                  >
                    <TemplateIcon template={template} />
                    <span>{template.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <fieldset className="studio__choice">
            <legend>Shape</legend>
            {FORMAT_IDS.map((value) => (
              <label key={value} className="library__check">
                <input type="radio" name="format" checked={project.format === value} onChange={() => void settings({ format: value }, 'Shape changed')} />
                <span>{formatLabel(value)}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="studio__choice">
            <legend>Background</legend>
            {(['cream', 'white'] as const).map((value) => (
              <label key={value} className="library__check">
                <input
                  type="radio"
                  name="background"
                  checked={backgroundName(project.params) === value}
                  onChange={() => void settings({ params: { ...project.params, background: BACKGROUNDS[value] } }, 'Background changed')}
                />
                <span>{value === 'cream' ? 'Cream' : 'White'}</span>
              </label>
            ))}
          </fieldset>

          {/* Pick the photo to adjust; its frame is outlined in the preview. */}
          <ol className="studio__items" aria-label="Photos in this project, in order">
            {project.items.map((i) => (
              <li key={i.assetId} className="studio__item">
                <button
                  type="button"
                  className="strip__item"
                  aria-pressed={i.position === item.position}
                  aria-label={`Adjust photo ${i.position + 1}${i.available ? '' : ', offline'}`}
                  onClick={() => setSelected(i.position)}
                >
                  <img src={`nm-media://thumb/${i.assetId}`} alt="" />
                  <span className="strip__label" aria-hidden="true">
                    {i.position + 1}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div className="studio__adjust" role="group" aria-label={`Photo ${item.position + 1}: order and crop (arrow keys move it, + and − zoom)`} onKeyDown={onCropKeys}>
            <p className="review__note">
              Photo {item.position + 1} of {project.items.length} · {describeCrop(item.crop)}
            </p>
            <div className="library__source-actions">
              <button type="button" className="button button--quiet" disabled={item.position === 0} onClick={() => void move(item.position, item.position - 1)}>
                Move earlier
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={item.position === project.items.length - 1}
                onClick={() => void move(item.position, item.position + 1)}
              >
                Move later
              </button>
            </div>
            <div className="library__source-actions">
              <button type="button" className="button button--quiet" aria-label="Show more of the left" onClick={() => pan(-PAN_STEP, 0)}>
                ←
              </button>
              <button type="button" className="button button--quiet" aria-label="Show more of the top" onClick={() => pan(0, -PAN_STEP)}>
                ↑
              </button>
              <button type="button" className="button button--quiet" aria-label="Show more of the bottom" onClick={() => pan(0, PAN_STEP)}>
                ↓
              </button>
              <button type="button" className="button button--quiet" aria-label="Show more of the right" onClick={() => pan(PAN_STEP, 0)}>
                →
              </button>
              <button type="button" className="button button--quiet" disabled={item.crop.zoom <= 1} onClick={() => zoom(-ZOOM_STEP)}>
                Zoom out
              </button>
              <button type="button" className="button button--quiet" disabled={item.crop.zoom >= MAX_ZOOM} onClick={() => zoom(ZOOM_STEP)}>
                Zoom in
              </button>
              <button type="button" className="button button--quiet" onClick={() => void setCrop(item, DEFAULT_CROP)}>
                Reset crop
              </button>
            </div>
          </div>

          <ExportPanel
            projectId={projectId}
            blocked={unavailable.length > 0}
            summary={`JPEG, ${sizeOf(project.format)} pixels, ${slides} ${slides === 1 ? 'file' : 'files'}`}
          />

          <button type="button" className="button button--quiet" onClick={() => setConfirmDelete(true)}>
            Delete project…
          </button>
          {confirmDelete ? (
            <div className="library__confirm" role="group" aria-labelledby="delete-project-title">
              <p id="delete-project-title" className="library__confirm-title">
                Delete “{project.title}”?
              </p>
              <p className="review__note">Only the project goes. Its photos stay in your Library and in their folders.</p>
              <div className="library__source-actions">
                <button type="button" className="button button--secondary" autoFocus onClick={() => setConfirmDelete(false)}>
                  Keep project
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => void window.nearmora.deleteProject({ projectId }).then((result) => (result.ok ? onDeleted() : setStatus('The project couldn’t be deleted.')))}
                >
                  Delete project
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
