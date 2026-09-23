import { useEffect, useState } from 'react'
import { api, type FontInfo, type Project, type Snapshot } from '../api'

const FIELDS: { key: keyof FontInfo; label: string; numeric?: boolean }[] = [
  { key: 'familyName', label: 'Family name' },
  { key: 'styleName', label: 'Style name' },
  { key: 'unitsPerEm', label: 'Units per em', numeric: true },
  { key: 'ascender', label: 'Ascender', numeric: true },
  { key: 'descender', label: 'Descender', numeric: true },
  { key: 'capHeight', label: 'Cap height', numeric: true },
  { key: 'xHeight', label: 'x-height', numeric: true },
]

interface Props {
  project: Project
  onChanged: (reimport: boolean) => void
  onRestored: (project: Project) => void
  onError: (msg: string) => void
}

export function InfoPanel({ project, onChanged, onRestored, onError }: Props) {
  const [draft, setDraft] = useState<FontInfo>(project.info)
  useEffect(() => setDraft(project.info), [project.info])

  const dirty = FIELDS.some((f) => String(draft[f.key]) !== String(project.info[f.key]))
  const artboardChanged = draft.ascender !== project.info.ascender || draft.descender !== project.info.descender

  const save = async () => {
    try {
      await api.setInfo(draft)
      onChanged(artboardChanged)
    } catch (e) {
      onError(String(e))
    }
  }

  return (
    <div className="panel">
      <h2>{project.name}</h2>
      <div className="project-location">
        <span className="muted small">Project file</span>
        <code>{project.file}</code>
      </div>

      <h4>Font info</h4>
      <div className="form">
        {FIELDS.map((f) => (
          <label key={f.key}>
            <span>{f.label}</span>
            <input
              className={f.numeric ? 'num' : undefined}
              value={draft[f.key]}
              onChange={(e) =>
                setDraft({ ...draft, [f.key]: f.numeric ? Number(e.target.value) || 0 : e.target.value })
              }
            />
          </label>
        ))}
      </div>
      <p className="muted">
        The Illustrator artboard maps top edge → ascender, bottom edge → descender. Changing either rescales every
        outline, so saving re-imports all SVGs (a snapshot is taken first). Anchors and widths you set in-app are kept.
      </p>
      <div className="row">
        <button className="primary" disabled={!dirty} onClick={() => void save()}>Save</button>
      </div>

      <Snapshots project={project} onRestored={onRestored} onError={onError} />
    </div>
  )
}

function Snapshots({ project, onRestored, onError }: Omit<Props, 'onChanged'>) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null)

  useEffect(() => {
    api.snapshots().then((r) => setSnapshots(r.snapshots)).catch((e) => onError(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.revision])

  const restore = async (s: Snapshot) => {
    const when = new Date(s.created).toLocaleString()
    if (!window.confirm(`Restore the project to how it was ${when} (${s.reason.toLowerCase()})?\n\n` +
      'The current state is snapshotted first, so this can be undone too.')) return
    try {
      const res = await api.restore(s.id)
      setSnapshots(res.snapshots)
      onRestored(res.project)
    } catch (e) {
      onError(String(e))
    }
  }

  return (
    <>
      <h4>Snapshots</h4>
      <p className="muted small">
        Taken automatically before replacing outlines, re-importing everything or changing vertical metrics. The last
        30 are kept in the project's <code>snapshots/</code> folder.
      </p>
      {snapshots === null ? null : snapshots.length === 0 ? (
        <p className="muted small">None yet.</p>
      ) : (
        <table className="rules snapshots">
          <tbody>
            {snapshots.map((s) => (
              <tr key={s.id}>
                <td className="nowrap">{new Date(s.created).toLocaleString()}</td>
                <td>
                  {s.reason}
                  {s.files.length > 0 && <span className="muted small"> · {s.files.length} SVG{s.files.length > 1 ? 's' : ''}</span>}
                </td>
                <td><button onClick={() => void restore(s)}>Restore</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
