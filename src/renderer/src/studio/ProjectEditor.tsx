/**
 * Editing one Memory Studio project (AC6) with Quick edits: layout, captions (playful layouts), sharing or print size, background colour, margin, gutter, photo
 * border, and for each photo its order, swap, replace, fit or fill, crop and zoom. Every edit is saved at once, can be
 * undone and redone (buttons, or ⌘Z and ⇧⌘Z), and "Reset to layout defaults" brings back the layout's own look.
 * The preview is drawn from the same composition as the export. Photos that can't be reached, and photos too small for
 * the chosen print size, are named before export.
 */

import { useState, type KeyboardEvent } from 'react'
import { clampCrop, DEFAULT_CROP, MAX_ZOOM, photoArea, type Crop } from '@shared/layout'
import { captionText, compose, resolveParams, UnknownTemplateError, type Composition } from '@shared/studio/compose'
import { moveItem, replaceItem, resetDesign, swapItems, updateItem, type Design } from '@shared/studio/design'
import { FORMAT_IDS, FORMATS, formatLabel, type FormatId } from '@shared/studio/formats'
import { BACKGROUNDS, BORDER_COLORS, MAX_BORDER, MAX_CAPTION, type Params } from '@shared/studio/params'
import { printResolution } from '@shared/studio/resolution'
import { findTemplate, templatesFor } from '@shared/studio/templates'
import { missingCharacters } from '@shared/studio/text'
import { ColourChoice } from './ColourChoice'
import { ExportPanel } from './ExportPanel'
import { ReplacePhoto } from './ReplacePhoto'
import { StudioCanvas } from './StudioCanvas'
import { TemplateIcon } from './TemplateIcon'
import { useProjectEditing } from './use-project-editing'

const PAN_STEP = 0.05
const ZOOM_STEP = 0.25
/** The widest margin or gutter offered by the sliders, in reference pixels (the settings allow up to 300). */
const MAX_SPACING = 200

const describeCrop = (crop: Crop) =>
  `${Math.round(crop.cx * 100)}% across, ${Math.round(crop.cy * 100)}% down, zoom ${Math.round(crop.zoom * 100)}%`

// "1350 × 1080": the output size of a format, as shown on screen.
const sizeOf = (format: FormatId): string => `${FORMATS[format].width} × ${FORMATS[format].height}`

const composeDesign = (design: Design): Composition => compose({ ...design, photoCount: design.items.length })

// "cream", "white", or the colour itself when it isn't one of the named ones; used in the preview's description.
const colourName = (colour: string): string => Object.entries(BACKGROUNDS).find(([, c]) => c === colour.toLowerCase())?.[0] ?? colour

export function ProjectEditor({ projectId, onClose, onDeleted }: { projectId: string; onClose: () => void; onDeleted: () => void }) {
  const { project, setProject, design, canUndo, canRedo, status, setStatus, change, live, undo, redo } = useProjectEditing(projectId)
  const [selected, setSelected] = useState(0)
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!project || !design) return <p>{status === 'All changes saved' ? 'Opening project…' : status}</p>
  let composition: Composition
  try {
    composition = composeDesign(design)
  } catch (error: unknown) {
    if (!(error instanceof UnknownTemplateError)) throw error
    return <p role="alert">This project uses a layout this version of Nearmora doesn’t know. It is kept as it is; a newer version can open it.</p>
  }
  const template = findTemplate(design.templateId, design.templateVersion)!
  const resolved = resolveParams(template, design.params)
  const position = Math.min(selected, design.items.length - 1)
  const item = design.items[position]!
  // Photo details (size, offline, file name) come from the last save; a just-replaced photo has none until it lands.
  const detailOf = (assetId: string) => project.items.find((i) => i.assetId === assetId)
  const unavailable = design.items.map((i) => detailOf(i.assetId)).filter((d) => d && !d.available)
  const title = titleDraft ?? project.title

  const setParams = (params: Partial<Params>) => ({ ...design, params: { ...design.params, ...params } })

  // Crops are kept within the photo before they're stored, measured against the photo's area inside its border.
  function cropFor(assetId: string, at: number, next: Crop): Crop {
    const detail = detailOf(assetId)
    const cell = photoArea(composition.elements[at]!.rect, composition.border.width)
    return detail?.width && detail.height ? clampCrop({ width: detail.width, height: detail.height }, cell, next) : next
  }
  const setCrop = (next: Crop) => change(updateItem(design, position, { crop: cropFor(item.assetId, position, next) }), `Crop: ${describeCrop(next)}`)
  const pan = (dx: number, dy: number) => setCrop({ ...item.crop, cx: item.crop.cx + dx, cy: item.crop.cy + dy })
  const zoom = (delta: number) => setCrop({ ...item.crop, zoom: Math.min(MAX_ZOOM, Math.max(1, item.crop.zoom + delta)) })

  // Pinch or wheel over a photo: selects it and zooms it live; the whole gesture is one undo step.
  function wheelZoom(at: number, factor: number) {
    setSelected(at)
    const target = design!.items[at]!
    const next = { ...target.crop, zoom: Math.min(MAX_ZOOM, Math.max(1, target.crop.zoom * factor)) }
    live(updateItem(design!, at, { crop: cropFor(target.assetId, at, next) }), 'Zoom changed')
  }

  // Arrow keys move the photo inside its frame; + and − zoom. Moving right shows more of the photo's right side.
  function onCropKeys(event: KeyboardEvent) {
    if (item.fit === 'fit') return
    const moves: Record<string, [number, number]> = { ArrowLeft: [-PAN_STEP, 0], ArrowRight: [PAN_STEP, 0], ArrowUp: [0, -PAN_STEP], ArrowDown: [0, PAN_STEP] }
    const step = moves[event.key]
    if (step) {
      event.preventDefault()
      pan(step[0], step[1])
    } else if (event.key === '+' || event.key === '=') zoom(ZOOM_STEP)
    else if (event.key === '-') zoom(-ZOOM_STEP)
  }

  const slides = composition.canvasCount
  // Tall shapes are previewed narrower, so the whole canvas fits on screen beside the controls.
  const previewWidth = (widest: number, tallest: number) => Math.round(Math.min(widest, (tallest * composition.width) / composition.height))
  const resolution = printResolution(
    composition,
    design.format,
    design.items.map((i) => ({ ...i, width: detailOf(i.assetId)?.width ?? null, height: detailOf(i.assetId)?.height ?? null })),
  )
  const weak = resolution.filter((r) => r.sharpness !== 'good')
  const selectedPrint = resolution.find((r) => r.slot === position)
  const preview = (canvasIndex: number, width: number) => (
    <StudioCanvas
      key={canvasIndex}
      composition={composition}
      items={design.items}
      canvasIndex={canvasIndex}
      displayWidth={width}
      highlight={position}
      onWheelZoom={wheelZoom}
      label={
        composition.mode === 'carousel'
          ? `Preview of slide ${canvasIndex + 1} of ${slides}`
          : `Preview: ${template.name.toLowerCase()}, ${FORMATS[design.format].label.toLowerCase()}, ${colourName(resolved.background)} background${
              resolved.borderWidth > 0 ? `, ${colourName(resolved.borderColor)} border` : ''
            }${(template.captions ?? [])
              .map((c) => captionText(template, design.params)(c.id).trim())
              .filter(Boolean)
              .map((words) => `, caption “${words}”`)
              .join('')}`
      }
    />
  )

  // A range for a spacing setting: shown live while it moves, saved and added to undo when it pauses.
  const slider = (label: string, value: number, max: number, onLive: (value: number) => Design) => (
    <label className="studio__slider">
      <span>{label}</span>
      <input type="range" min={0} max={max} step={2} value={value} aria-valuetext={`${value} pixels`} onChange={(e) => live(onLive(Number(e.target.value)), `${label} changed`)} />
      <output aria-hidden="true">{value} px</output>
    </label>
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
          {template.name} · {design.items.length} photos · {sizeOf(design.format)}
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
            {unavailable.map((i) => `${i!.fileName ?? 'A photo'}${i!.folderName ? ` (in “${i!.folderName}”)` : ''}`).join(', ')}. You can keep editing; export
            needs them reconnected.
          </p>
        </div>
      ) : null}

      <div className="studio__layout">
        <div className="studio__previews">
          {composition.mode === 'carousel' ? (
            <div className="studio__slides">{Array.from({ length: slides }, (_, i) => preview(i, previewWidth(220, 300)))}</div>
          ) : (
            preview(0, previewWidth(480, 560))
          )}
          {/* Prints: photos enlarged so much they may look soft, named before export with what can help. */}
          {weak.length > 0 ? (
            <div className="library__confirm" role="status">
              <p className="library__confirm-title">
                {weak.some((r) => r.sharpness === 'low') ? 'Some photos may look blurry at this print size' : 'Some photos may look slightly soft up close'}
              </p>
              <ul className="review__note">
                {weak.map((r) => (
                  <li key={r.slot}>
                    Photo {r.slot + 1}: about {r.ppi} pixels per inch{r.sharpness === 'low' ? ', likely to look blurry' : ', may look soft up close'}
                  </li>
                ))}
              </ul>
              <p className="review__note">Zooming out, showing the whole photo, or a smaller print size gives each photo more pixels per inch.</p>
            </div>
          ) : null}
        </div>

        <div className="studio__controls">
          {/* Undo, redo and reset cover every Quick edit below; the title has its own Save. */}
          <div className="studio__bar" role="toolbar" aria-label="Edit history">
            <button type="button" className="button button--secondary" disabled={!canUndo} aria-keyshortcuts="Meta+Z" onClick={undo}>
              Undo
            </button>
            <button type="button" className="button button--secondary" disabled={!canRedo} aria-keyshortcuts="Meta+Shift+Z" onClick={redo}>
              Redo
            </button>
            <button
              type="button"
              className="button button--quiet"
              title="Spacing, colours, border, fit and crops go back to the layout’s own. Photos and their order stay."
              onClick={() => change(resetDesign(design), 'Reset to layout defaults')}
            >
              Reset to layout defaults
            </button>
          </div>

          <form
            className="moment-header__form"
            onSubmit={(e) => {
              e.preventDefault()
              void window.nearmora.renameProject({ projectId, title }).then((result) => {
                if (!result.ok) return setStatus('That title couldn’t be saved. Nothing was changed.')
                setProject(result.data)
                setTitleDraft(null)
                setStatus('Renamed. All changes saved.')
              })
            }}
          >
            <label className="library__field">
              <span>Title</span>
              <input value={title} maxLength={120} onChange={(e) => setTitleDraft(e.target.value)} />
            </label>
            <button type="submit" className="button button--secondary" disabled={title.trim() === project.title}>
              Save title
            </button>
          </form>

          {/* Any layout that takes this many photos; photos keep their order, crops and fit. */}
          <section aria-labelledby="layout-title">
            <h3 id="layout-title" className="studio__template-title">
              Layout
            </h3>
            <ul className="studio__template-list">
              {templatesFor(design.items.length).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="studio__template"
                    aria-pressed={t.id === design.templateId}
                    title={t.description}
                    onClick={() => {
                      if (t.id !== design.templateId) change({ ...design, templateId: t.id, templateVersion: t.version }, `Layout changed to ${t.name}`)
                    }}
                  >
                    <TemplateIcon template={t} />
                    <span>{t.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Playful layouts' captions: typed text shows at once and is saved (as one undo step) when typing pauses. */}
          {template.captions?.map((caption) => {
            const words = captionText(template, design.params)(caption.id)
            const missing = missingCharacters(words)
            return (
              <label key={caption.id} className="library__field">
                <span>{caption.label}</span>
                <input
                  value={words}
                  maxLength={MAX_CAPTION}
                  aria-describedby={missing.length > 0 ? `missing-${caption.id}` : undefined}
                  onChange={(e) => live(setParams({ text: { ...design.params.text, [caption.id]: e.target.value } }), `${caption.label} changed`)}
                />
                {missing.length > 0 ? (
                  <span id={`missing-${caption.id}`} className="review__note">
                    The caption font can’t draw {missing.join(' ')}, so {missing.length === 1 ? 'it is' : 'they are'} left out.
                  </span>
                ) : null}
              </label>
            )
          })}

          {/* Sizes for screens and sizes for printing, as two groups of one choice. */}
          {(['share', 'print'] as const).map((use) => (
            <fieldset key={use} className="studio__choice">
              <legend>{use === 'share' ? 'Shape for sharing' : 'Print size (300 pixels per inch)'}</legend>
              {FORMAT_IDS.filter((id) => FORMATS[id].use === use).map((value) => (
                <label key={value} className="library__check">
                  <input type="radio" name="format" checked={design.format === value} onChange={() => change({ ...design, format: value }, 'Size changed')} />
                  <span>{formatLabel(value)}</span>
                </label>
              ))}
            </fieldset>
          ))}

          <ColourChoice
            legend="Background"
            swatches={BACKGROUNDS}
            value={resolved.background}
            onPick={(colour) => change(setParams({ background: colour }), 'Background changed')}
            onLive={(colour) => live(setParams({ background: colour }), 'Background changed')}
          />

          {/* Carousel slides are one photo edge to edge, so spacing only applies to collages. */}
          {composition.mode === 'single' ? (
            <fieldset className="studio__choice studio__choice--column">
              <legend>Spacing</legend>
              {slider('Margin', resolved.margin, MAX_SPACING, (margin) => setParams({ margin }))}
              {slider('Gutter', resolved.gutter, MAX_SPACING, (gutter) => setParams({ gutter }))}
            </fieldset>
          ) : null}

          <fieldset className="studio__choice studio__choice--column">
            <legend>Photo border</legend>
            {slider('Border width', resolved.borderWidth, MAX_BORDER, (borderWidth) => setParams({ borderWidth }))}
          </fieldset>
          <ColourChoice
            legend="Border colour"
            swatches={BORDER_COLORS}
            value={resolved.borderColor}
            disabled={resolved.borderWidth === 0}
            onPick={(colour) => change(setParams({ borderColor: colour }), 'Border colour changed')}
            onLive={(colour) => live(setParams({ borderColor: colour }), 'Border colour changed')}
          />

          {/* Pick the photo to adjust; its frame is outlined in the preview. */}
          <ol className="studio__items" aria-label="Photos in this project, in order">
            {design.items.map((i, at) => (
              <li key={i.assetId} className="studio__item">
                <button
                  type="button"
                  className="strip__item"
                  aria-pressed={at === position}
                  aria-label={`Adjust photo ${at + 1}${detailOf(i.assetId)?.available === false ? ', offline' : ''}`}
                  onClick={() => {
                    setSelected(at)
                    setReplacing(false)
                  }}
                >
                  <img src={`nm-media://thumb/${i.assetId}`} alt="" />
                  <span className="strip__label" aria-hidden="true">
                    {at + 1}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div
            className="studio__adjust"
            role="group"
            aria-label={`Photo ${position + 1}: order, fit and crop${item.fit === 'fill' ? ' (arrow keys move it, + and − zoom)' : ''}`}
            onKeyDown={onCropKeys}
          >
            <p className="review__note">
              Photo {position + 1} of {design.items.length} · {item.fit === 'fill' ? describeCrop(item.crop) : 'whole photo shown'}
              {selectedPrint ? ` · prints at about ${selectedPrint.ppi} pixels per inch` : ''}
            </p>
            <div className="library__source-actions">
              <button
                type="button"
                className="button button--quiet"
                disabled={position === 0}
                onClick={() => {
                  change(moveItem(design, position, position - 1), `Moved to position ${position}`)
                  setSelected(position - 1)
                }}
              >
                Move earlier
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={position === design.items.length - 1}
                onClick={() => {
                  change(moveItem(design, position, position + 1), `Moved to position ${position + 2}`)
                  setSelected(position + 1)
                }}
              >
                Move later
              </button>
              <button type="button" className="button button--quiet" onClick={() => setReplacing(true)}>
                Replace…
              </button>
            </div>
            {/* Swap trades places with any other photo directly, without stepping one place at a time. */}
            <div className="library__source-actions" role="group" aria-label={`Swap photo ${position + 1} with`}>
              {design.items.map((_, other) =>
                other === position ? null : (
                  <button
                    key={other}
                    type="button"
                    className="button button--quiet"
                    aria-label={`Swap with photo ${other + 1}`}
                    onClick={() => {
                      change(swapItems(design, position, other), `Swapped photos ${position + 1} and ${other + 1}`)
                      setSelected(other)
                    }}
                  >
                    ⇄ {other + 1}
                  </button>
                ),
              )}
            </div>
            {replacing ? (
              <ReplacePhoto
                position={position}
                exclude={design.items.map((i) => i.assetId)}
                onCancel={() => setReplacing(false)}
                onChoose={(assetId) => {
                  setReplacing(false)
                  change(replaceItem(design, position, assetId), `Replaced photo ${position + 1}`)
                }}
              />
            ) : null}

            <fieldset className="studio__choice">
              <legend>Fit</legend>
              <label className="library__check">
                <input type="radio" name="fit" checked={item.fit === 'fill'} onChange={() => change(updateItem(design, position, { fit: 'fill' }), 'Photo fills its place')} />
                <span>Fill the space (crops the photo)</span>
              </label>
              <label className="library__check">
                <input type="radio" name="fit" checked={item.fit === 'fit'} onChange={() => change(updateItem(design, position, { fit: 'fit' }), 'Whole photo shown')} />
                <span>Show the whole photo</span>
              </label>
            </fieldset>

            {/* Crop controls only mean something when the photo fills its place. */}
            <div className="library__source-actions" role="group" aria-label="Crop">
              <button type="button" className="button button--quiet" disabled={item.fit === 'fit'} aria-label="Show more of the left" onClick={() => pan(-PAN_STEP, 0)}>
                ←
              </button>
              <button type="button" className="button button--quiet" disabled={item.fit === 'fit'} aria-label="Show more of the top" onClick={() => pan(0, -PAN_STEP)}>
                ↑
              </button>
              <button type="button" className="button button--quiet" disabled={item.fit === 'fit'} aria-label="Show more of the bottom" onClick={() => pan(0, PAN_STEP)}>
                ↓
              </button>
              <button type="button" className="button button--quiet" disabled={item.fit === 'fit'} aria-label="Show more of the right" onClick={() => pan(PAN_STEP, 0)}>
                →
              </button>
              <button type="button" className="button button--quiet" disabled={item.fit === 'fit' || item.crop.zoom <= 1} onClick={() => zoom(-ZOOM_STEP)}>
                Zoom out
              </button>
              <button type="button" className="button button--quiet" disabled={item.fit === 'fit' || item.crop.zoom >= MAX_ZOOM} onClick={() => zoom(ZOOM_STEP)}>
                Zoom in
              </button>
              <button type="button" className="button button--quiet" disabled={item.fit === 'fit'} onClick={() => setCrop(DEFAULT_CROP)}>
                Reset crop
              </button>
            </div>
          </div>

          <ExportPanel
            projectId={projectId}
            blocked={unavailable.length > 0}
            summary={`JPEG, ${sizeOf(design.format)} pixels, ${slides} ${slides === 1 ? 'file' : 'files'}`}
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
