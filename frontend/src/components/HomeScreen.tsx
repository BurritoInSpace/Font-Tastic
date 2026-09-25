import { useEffect, useState } from 'react'
import { api, ApiError, nativeBridge, type ImportReport, type Project, type RecentProject } from '../api'
import { GITHUB_MARK, GITHUB_MARK_VIEWBOX, GITHUB_URL, logo, wordmark } from '../assets'

interface Props {
  onOpened: (project: Project, report: ImportReport) => void
  message: { text: string; error?: boolean } | null
}

type Opened = { project: Project; import: ImportReport }

/** Where a new project goes by default: next to the most recent one. */
function defaultLocation(recent: RecentProject[]): string {
  const last = recent.find((r) => r.exists)
  if (!last) return ''
  const parts = last.path.split(/[\\/]/)
  return parts.slice(0, -2).join(last.path.includes('\\') ? '\\' : '/')
}

export function HomeScreen({ onOpened, message }: Props) {
  const [recent, setRecent] = useState<RecentProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [convertPath, setConvertPath] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const bridge = nativeBridge()

  useEffect(() => {
    api.recent().then((r) => setRecent(r.recent)).catch(() => setRecent([]))
  }, [])

  const run = async (action: () => Promise<Opened>, pathForConversion?: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await action()
      onOpened(res.project, res.import)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'needs-conversion' && pathForConversion) {
        setConvertPath(pathForConversion)
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBusy(false)
    }
  }

  const open = (path: string) => void run(() => api.open(path), path)

  const pickAndOpen = async () => {
    const path = bridge ? await bridge.pick_project_file() : window.prompt('Path to a .fonttastic file or project folder')
    if (path) open(path)
  }

  return (
    <div className="home">
      <header className="home-header">
        <img className="logo" src={logo} alt="" />
        <img className="wordmark" src={wordmark} alt="Font-tastic" />
        <a className="github" href={GITHUB_URL} target="_blank" rel="noreferrer" title="Font-tastic on GitHub">
          <svg viewBox={GITHUB_MARK_VIEWBOX} aria-hidden="true"><path d={GITHUB_MARK} /></svg>
        </a>
      </header>

      <div className="home-body">
        <section aria-label="Recent projects">
          {recent === null ? null : recent.length === 0 ? (
            <div className="home-empty">
              No projects yet.<br />Make a new project or open an existing one.
            </div>
          ) : (
            <ul className="recent">
              {recent.map((r) => (
                <li key={r.path} className={r.exists ? '' : 'missing'}>
                  <Thumbnail project={r} />
                  <button className="recent-open" disabled={!r.exists || busy} onClick={() => open(r.path)}
                    title={r.exists ? r.path : 'Moved or deleted'}>
                    <span className="recent-title">
                      <span className="recent-name">{r.name}</span>
                      <span className="recent-date">{formatDate(r.opened)}</span>
                    </span>
                    <span className="recent-path">{r.exists ? r.path : `Missing: ${r.path}`}</span>
                  </button>
                  <button className="icon recent-remove" title="Remove from this list"
                    onClick={() => api.removeRecent(r.path).then((x) => setRecent(x.recent))}>✖</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="home-divider" aria-hidden="true" />

        <section className="home-actions">
          <div className="buttons">
            <button className="primary" onClick={() => setCreating(true)} disabled={busy}>New Project</button>
            <button className="secondary" onClick={() => void pickAndOpen()} disabled={busy}>Open Project</button>
          </div>

          {creating && (
            <NewProjectForm
              initialLocation={defaultLocation(recent ?? [])}
              busy={busy}
              onCancel={() => setCreating(false)}
              onCreate={(parent, name) => void run(() => api.newProject(parent, name))}
            />
          )}

          {convertPath && (
            <div className="notice">
              <p>
                <strong>{convertPath}</strong> uses the old layout (<code>glyphs/</code> + <code>font.ufo/</code>) without
                a project file. Converting adds a <code>.fonttastic</code> file; nothing else in the folder changes.
              </p>
              <div className="row">
                <button className="primary" disabled={busy}
                  onClick={() => { const p = convertPath; setConvertPath(null); void run(() => api.convert(p)) }}>
                  Convert and open
                </button>
                <button className="secondary" onClick={() => setConvertPath(null)}>Cancel</button>
              </div>
            </div>
          )}

          {(error || message) && (
            <p className={error || message?.error ? 'error' : 'home-note'}>{error ?? message?.text}</p>
          )}
        </section>
      </div>
    </div>
  )
}

/** A letter from the project's own font, so each project is recognisable. */
function Thumbnail({ project }: { project: RecentProject }) {
  const [preview, setPreview] = useState<{ path: string; bounds: [number, number, number, number] | null } | null>(null)
  useEffect(() => {
    if (!project.exists) return
    let cancelled = false
    api.recentPreview(project.path).then((r) => !cancelled && setPreview(r.preview)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [project.path, project.exists])

  if (!preview?.bounds) return <div className="recent-thumb" aria-hidden="true" />
  const [x0, y0, x1, y1] = preview.bounds
  const size = Math.max(x1 - x0, y1 - y0) * 1.15
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return (
    <div className="recent-thumb" aria-hidden="true">
      <svg viewBox={`${cx - size / 2} ${-cy - size / 2} ${size} ${size}`}>
        <path d={preview.path} transform="scale(1,-1)" />
      </svg>
    </div>
  )
}

function NewProjectForm({ initialLocation, busy, onCancel, onCreate }: {
  initialLocation: string
  busy: boolean
  onCancel: () => void
  onCreate: (parent: string, name: string) => void
}) {
  const [name, setName] = useState('')
  const [location, setLocation] = useState(initialLocation)
  const bridge = nativeBridge()
  const sep = location.includes('/') && !location.includes('\\') ? '/' : '\\'
  const target = location && name.trim() ? `${location.replace(/[\\/]+$/, '')}${sep}${name.trim()}` : null

  return (
    <form className="home-form" onSubmit={(e) => { e.preventDefault(); if (target) onCreate(location, name.trim()) }}>
      <label htmlFor="project-name">Project Name</label>
      <input id="project-name" autoFocus value={name} placeholder="e.g. Shalom Sans" onChange={(e) => setName(e.target.value)} />
      <label htmlFor="project-location">Location</label>
      <div className="row">
        <input id="project-location" className="grow" value={location} placeholder="Folder to create the project in"
          onChange={(e) => setLocation(e.target.value)} />
        {bridge && (
          <button type="button" className="primary choose"
            onClick={async () => { const p = await bridge.pick_folder(); if (p) setLocation(p) }}>
            Choose
          </button>
        )}
      </div>
      <p className="home-note">
        {target ? <>Creates <code>{target}</code> with the project file, a <code>glyphs</code> folder for your SVGs, and the font data.</>
          : 'Pick a name and a location.'}
      </p>
      <div className="buttons">
        <button className="primary" type="submit" disabled={!target || busy}>Create Project</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
