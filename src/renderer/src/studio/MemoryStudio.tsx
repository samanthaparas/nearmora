/**
 * The Memory Studio screen: saved collage and carousel projects, and the editor for one of them.
 * New projects start from Favorites; export (writing the finished files) arrives in the next milestone part.
 */

import { useCallback, useEffect, useState } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'
import { templateName } from '@shared/studio/templates'
import { ProjectEditor } from './ProjectEditor'
import '../library/Library.css'
import '../best-moments/BestMoments.css'
import './Studio.css'

type ProjectSummary = CommandOutput<'projects:list'>[number]

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function MemoryStudio({ initialProjectId, onGoToFavorites }: { initialProjectId: string | null; onGoToFavorites: () => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(initialProjectId)

  const load = useCallback(() => {
    void window.nearmora.listProjects().then((result) => setProjects(result.ok ? result.data : []))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      <header className="content__header">
        <h1 className="content__title">Memory Studio</h1>
        <p className="content__subtitle">Turn a few favorites into something worth sharing.</p>
      </header>

      {openId ? (
        <ProjectEditor
          key={openId}
          projectId={openId}
          onClose={() => {
            setOpenId(null)
            load()
          }}
          onDeleted={() => {
            setOpenId(null)
            load()
          }}
        />
      ) : projects === null ? (
        <p>Loading…</p>
      ) : projects.length === 0 ? (
        <section className="empty-state" aria-labelledby="studio-empty">
          <h2 id="studio-empty" className="empty-state__title">
            No projects yet.
          </h2>
          <p className="empty-state__body">Choose 2 or 4 favorites for a collage, or 2–10 for a carousel.</p>
          <button type="button" className="button button--primary" onClick={onGoToFavorites}>
            Go to Favorites
          </button>
        </section>
      ) : (
        <section className="moments" aria-labelledby="projects-title">
          <h2 id="projects-title" className="moments__title">
            Your projects
          </h2>
          <ul className="moments__list moments__list--wrap">
            {projects.map((project) => (
              <li key={project.id}>
                <button type="button" className="moments__card" onClick={() => setOpenId(project.id)}>
                  {project.coverAssetId ? <img className="moments__cover" src={`nm-media://thumb/${project.coverAssetId}`} alt="" /> : null}
                  <span className="moments__name">{project.title}</span>
                  <span className="moments__count">
                    {templateName(project.templateId, project.templateVersion)} · {project.photoCount} photos · edited {dateFormat.format(project.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
