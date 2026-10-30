/**
 * Editing one Memory Studio project (AC6): title, square, portrait or landscape, cream or white background, the order of
 * photos, and each photo's crop position and zoom, all by buttons or keyboard. Every change is saved at once.
 * Photos that can't be reached are named, so nobody discovers it only at export time.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'
import { ASPECT_LABEL, CANVAS, canvasCount, clampCrop, DEFAULT_CROP, MAX_ZOOM, placements, type Aspect, type Background, type Crop } from '@shared/layout'
import { ExportPanel } from './ExportPanel'
import { StudioCanvas } from './StudioCanvas'

type Project = CommandOutput<'projects:get'>
type Item = Project['items'][number]

const KIND_NAMES = { collage_2: 'Two-photo collage', collage_4: 'Four-photo collage', carousel: 'Carousel' } as const
const PAN_STEP = 0.05
const ZOOM_STEP = 0.25

const describeCrop = (crop: Crop) =>
  `${Math.round(crop.cx * 100)}% across, ${Math.round(crop.cy * 100)}% down, zoom ${Math.round(crop.zoom * 100)}%`

// "1350 × 1080": the output size for a shape, as shown on screen.
const sizeOf = (aspect: Aspect): string => `${CANVAS[aspect].width} × ${CANVAS[aspect].height}`
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
  const item = project.items[selected] ?? project.items[0]!
  const unavailable = project.items.filter((i) => !i.available)

  // Applies a result from main; anything that failed leaves the project as it was and says so.
  function applied(result: { ok: boolean; data?: Project }, what: string) {
    if (result.ok && result.data) {
      setProject(result.data)
      setStatus(`${what}. All changes saved.`)
    } else setStatus(`That change couldn’t be saved. Nothing was changed.`)
  }

  async function settings(change: { title?: string; aspect?: Aspect; background?: Background }, what: string) {
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
    const cell = placements(project!.kind, project!.aspect, project!.items.length)[target.position]!.cell
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
      const cell = placements(p.kind, p.aspect, p.items.length)[position]!.cell
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

  const slides = canvasCount(project.kind, project.items.length)
  const preview = (canvasIndex: number, width: number) => (
    <StudioCanvas
      key={canvasIndex}
      kind={project.kind}
      aspect={project.aspect}
      background={project.background}
      items={project.items}
      canvasIndex={canvasIndex}
      displayWidth={width}
      highlight={item.position}
      onWheelZoom={wheelZoom}
      label={
        project.kind === 'carousel'
          ? `Preview of slide ${canvasIndex + 1} of ${slides}`
          : `Preview: ${KIND_NAMES[project.kind].toLowerCase()}, ${ASPECT_LABEL[project.aspect].split(' ')[0]!.toLowerCase()}, ${project.background} background`
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
          {KIND_NAMES[project.kind]} · {project.items.length} photos · {sizeOf(project.aspect)}
          {project.kind === 'carousel' ? ` · ${slides} slides` : ''}
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
          {project.kind === 'carousel' ? (
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

          <fieldset className="studio__choice">
            <legend>Shape</legend>
            {(['1:1', '4:5', '5:4'] as const).map((value) => (
              <label key={value} className="library__check">
                <input type="radio" name="aspect" checked={project.aspect === value} onChange={() => void settings({ aspect: value }, 'Shape changed')} />
                <span>{ASPECT_LABEL[value]}</span>
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
                  checked={project.background === value}
                  onChange={() => void settings({ background: value }, 'Background changed')}
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
            summary={`JPEG, ${sizeOf(project.aspect)} pixels, ${slides} ${slides === 1 ? 'file' : 'files'}`}
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
