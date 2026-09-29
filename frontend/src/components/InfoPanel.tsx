import { useEffect, useState } from 'react'
import { api, type EditorsInfo, type FontInfo, type Guide, type Project, type Snapshot } from '../api'
import { describeLocation } from '../axes'
import { useConfirm } from './Confirm'
import { CommitInput } from './GlyphEditor'

const FIELDS: { key: keyof FontInfo; label: string; numeric?: boolean }[] = [
  { key: 'familyName', label: 'Family name' },
  { key: 'styleName', label: 'Style name' },
  { key: 'unitsPerEm', label: 'Units per em', numeric: true },
  { key: 'ascender', label: 'Ascender', numeric: true },
  { key: 'descender', label: 'Descender', numeric: true },
  { key: 'capHeight', label: 'Cap height', numeric: true },
  { key: 'xHeight', label: 'x-height', numeric: true },
]

/** [where, keys, what it does] */
const SHORTCUTS: [string, string, string][] = [
  ['Anywhere', 'Ctrl+S', 'Switch to the master you were on before (and back)'],
  ['Anywhere', 'Ctrl+I', 'Import SVGs'],
  ['Anywhere', 'Esc', 'Close a menu or dialog'],
  ['Toolbar', 'Shift+click Reimport', 'Re-read every SVG, not just changed ones'],
  ['Glyph', 'Ctrl+E', 'Edit the glyph in your drawing app'],
  ['Glyph', '← → ↑ ↓', 'Nudge the selected anchor by 1 (on a mark view: the mark)'],
  ['Glyph', 'Shift+arrows', 'Nudge by 10'],
  ['Glyph', 'Delete', 'Remove the selected anchor'],
  ['Glyph', 'Shift+drag', 'Drag an anchor or mark in a straight line'],
  ['Glyph', 'Drag an edge', "Change the side bearing or width (moves the SVG's artboard)"],
  ['Kerning', '↑ ↓', 'Previous / next pair in the list'],
  ['Kerning', 'Shift+click ← →', 'Move a gap marker by 1 instead of 5'],
]

interface Props {
  project: Project
  onChanged: (reimport: boolean) => void
  onRestored: (project: Project) => void
  onError: (msg: string) => void
  onDeleteWeight: (name: string) => void
  editors?: EditorsInfo | null
  onEditors?: (info: EditorsInfo) => void
}

export function InfoPanel({ project, onChanged, onRestored, onError, onDeleteWeight, editors, onEditors }: Props) {
  const confirm = useConfirm()
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
    <div className="panel light">
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
              readOnly={f.key === 'styleName'}
              title={f.key === 'styleName' ? 'The style name is the weight\'s name' : undefined}
              value={draft[f.key]}
              onChange={(e) =>
                setDraft({ ...draft, [f.key]: f.numeric ? Number(e.target.value) || 0 : e.target.value })
              }
            />
          </label>
        ))}
      </div>
      <p className="muted">
        The SVG artboard (Illustrator artboard, Inkscape page) maps top edge → ascender, bottom edge → descender. Changing either rescales every
        outline, so saving re-imports all SVGs (a snapshot is taken first). Anchors and widths you set in-app are kept.
      </p>
      <div className="row">
        <button className="primary" disabled={!dirty} onClick={() => void save()}>Save</button>
      </div>

      {editors && (
        <>
          <h4>Drawing app</h4>
          <div className="row">
            <select value={editors.choice} aria-label="Drawing app"
              onChange={async (e) => {
                try {
                  onEditors?.(await api.setEditor(e.target.value))
                } catch (err) {
                  onError(String(err))
                }
              }}>
              <option value="auto">Automatic ({editors.installed[editors.active] ?? editors.label})</option>
              {Object.entries(editors.installed).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <span className="muted small">
              What Edit opens glyph SVGs in (Ctrl+E). A setting for this computer, not the project.
            </span>
          </div>
        </>
      )}

      <h4>Keyboard shortcuts</h4>
      <table className="rules shortcuts">
        <tbody>
          {SHORTCUTS.map(([area, keys, what]) => (
            <tr key={keys + what}>
              <td className="muted small">{area}</td>
              <td><kbd>{keys}</kbd></td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Guides</h4>
      <p className="muted small">
        Extra lines in the glyph editor, for heights the standard metrics don't cover: where Hebrew letters top out
        next to Latin capitals and x-height, a figure height, an accent line. Shared by every master.
      </p>
      <GuidesEditor project={project} onChanged={() => onChanged(false)} onError={onError} />

      <h4>Scripts</h4>
      <p className="muted small">
        {project.scripts.length
          ? <>This font has {project.scripts.map((s) => s.name).join(' and ')} letters.</>
          : <>No letters yet.</>}
        {' '}OpenType language systems (from the letters present):{' '}
        <code>{project.languageSystems.map(([s]) => s).join(', ')}</code>. Digits, punctuation and the space are shared
        by every script.
      </p>

      <h4>Masters</h4>
      <p className="muted small">
        Each master (a weight, width...) has its own SVGs, anchors, widths and kerning. The glyph set, kerning groups,
        ligatures, family name and vertical metrics are shared. Switch or add masters from the menu at the top left;
        set up axes in the variable tab.
      </p>
      <table className="rules weights-table">
        <tbody>
          {project.weights.map((w) => (
            <tr key={w.name}>
              <td><strong>{w.name}</strong>{w.active && <span className="muted small"> · editing</span>}</td>
              <td className="num-cell">{describeLocation(project.axes, w.location)}</td>
              <td className="muted small mono">{w.glyphs}/</td>
              <td>
                <button className="icon" title={`Remove ${w.name}`} disabled={project.weights.length === 1}
                  onClick={async () => {
                    if (await confirm({
                      title: `Remove the ${w.name} master?`,
                      body: <p>Its SVG folder and font data are moved into <code>snapshots/removed-weights/</code>, not deleted.</p>,
                      confirmLabel: 'Remove master',
                      danger: true,
                    })) onDeleteWeight(w.name)
                  }}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Snapshots project={project} onRestored={onRestored} onError={onError} />
    </div>
  )
}

function GuidesEditor({ project, onChanged, onError }: { project: Project; onChanged: () => void; onError: (m: string) => void }) {
  const guides = project.settings.guides ?? []
  const save = async (next: Guide[]) => {
    try {
      await api.saveSettings({ guides: next })
      onChanged()
    } catch (e) {
      onError(String(e))
    }
  }
  const { xHeight, capHeight } = project.info
  return (
    <>
      {guides.length > 0 && (
        <table className="rules guides-table">
          <tbody>
            {guides.map((g, i) => (
              <tr key={i}>
                <td><CommitInput value={g.name} onCommit={(v) => v.trim() && void save(guides.map((x, j) => (j === i ? { ...x, name: v.trim() } : x)))} /></td>
                <td className="num-cell"><CommitInput value={String(g.y)} numeric
                  onCommit={(v) => void save(guides.map((x, j) => (j === i ? { ...x, y: Math.round(Number(v)) } : x)))} /></td>
                <td><button className="icon" title="Remove guide" onClick={() => void save(guides.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <button onClick={() => void save([...guides, guides.some((g) => g.name === 'Hebrew height')
          ? { name: `Guide ${guides.length + 1}`, y: Math.round(xHeight / 2) }
          : { name: 'Hebrew height', y: Math.round((xHeight + capHeight) / 2) }])}>
          + Add guide
        </button>
      </div>
    </>
  )
}

function Snapshots({ project, onRestored, onError }: Omit<Props, 'onChanged' | 'onDeleteWeight'>) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null)
  const confirm = useConfirm()

  useEffect(() => {
    api.snapshots().then((r) => setSnapshots(r.snapshots)).catch((e) => onError(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.revision])

  const restore = async (s: Snapshot) => {
    const when = new Date(s.created).toLocaleString()
    if (!(await confirm({
      title: 'Restore this snapshot?',
      body: (
        <>
          <p>The project goes back to how it was {when} ({s.reason.toLowerCase()}).</p>
          <p>The current state is snapshotted first, so this can be undone too.</p>
        </>
      ),
      confirmLabel: 'Restore',
    }))) return
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
