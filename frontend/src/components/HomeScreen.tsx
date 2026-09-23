import { useEffect, useState } from 'react'
import { api, ApiError, nativeBridge, type ImportReport, type Project, type RecentProject } from '../api'

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
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [error, setError] = useState<string | null>(null)
  const [convertPath, setConvertPath] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const bridge = nativeBridge()

  useEffect(() => {
    api.recent().then((r) => setRecent(r.recent)).catch(() => {})
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
      <div className="home-inner">
        <h1>Font-tastic</h1>
        <p className="muted">Illustrator draws the glyphs; Font-tastic does the typography.</p>

        <div className="row home-actions">
          <button className="primary" onClick={() => setCreating(true)} disabled={busy}>New project…</button>
          <button onClick={() => void pickAndOpen()} disabled={busy}>Open project…</button>
        </div>

        {creating && (
          <NewProjectForm
            initialLocation={defaultLocation(recent)}
            busy={busy}
            onCancel={() => setCreating(false)}
            onCreate={(parent, name) => void run(() => api.newProject(parent, name))}
          />
        )}

        {convertPath && (
          <div className="notice">
            <p>
              <strong>{convertPath}</strong> uses the old layout (<code>glyphs/</code> + <code>font.ufo/</code>) without a
              project file. Converting adds a <code>.fonttastic</code> file; nothing else in the folder changes.
            </p>
            <div className="row">
              <button className="primary" disabled={busy}
                onClick={() => { const p = convertPath; setConvertPath(null); void run(() => api.convert(p)) }}>
                Convert and open
              </button>
              <button onClick={() => setConvertPath(null)}>Cancel</button>
            </div>
          </div>
        )}

        {(error || message) && (
          <p className={error || message?.error ? 'error' : 'muted'}>{error ?? message?.text}</p>
        )}

        <h4>Recent projects</h4>
        {recent.length === 0 ? (
          <p className="muted small">Nothing yet. Create a project, or open an existing one.</p>
        ) : (
          <ul className="recent">
            {recent.map((r) => (
              <li key={r.path} className={r.exists ? '' : 'missing'}>
                <button className="recent-open" disabled={!r.exists || busy} onClick={() => open(r.path)}
                  title={r.exists ? r.path : 'Moved or deleted'}>
                  <span className="recent-name">{r.name}</span>
                  <span className="muted small recent-path">{r.exists ? r.path : `Missing: ${r.path}`}</span>
                </button>
                <span className="muted small">{formatDate(r.opened)}</span>
                <button className="icon" title="Remove from list"
                  onClick={() => api.removeRecent(r.path).then((x) => setRecent(x.recent))}>×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
    <form className="notice new-project" onSubmit={(e) => { e.preventDefault(); if (target) onCreate(location, name.trim()) }}>
      <label>
        <span>Name</span>
        <input autoFocus value={name} placeholder="e.g. Shalom Sans" onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        <span>Location</span>
        <div className="row">
          <input className="grow" value={location} placeholder="Folder to create the project in"
            onChange={(e) => setLocation(e.target.value)} />
          {bridge && (
            <button type="button" onClick={async () => { const p = await bridge.pick_folder(); if (p) setLocation(p) }}>
              Choose…
            </button>
          )}
        </div>
      </label>
      <p className="muted small">
        {target ? <>Creates <code>{target}</code> with the project file, <code>glyphs/</code> for your SVGs and the font data.</>
          : 'Pick a name and a location.'}
      </p>
      <div className="row">
        <button className="primary" type="submit" disabled={!target || busy}>Create project</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
