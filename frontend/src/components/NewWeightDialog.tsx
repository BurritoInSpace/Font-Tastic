import { useState } from 'react'
import { api, type Project } from '../api'

/** OpenType weight classes and their usual names (matches the backend). */
const WEIGHTS: [number, string][] = [
  [100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'],
  [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black'],
]
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

interface Props {
  project: Project
  onCancel: () => void
  onDone: (project: Project, name: string) => void
}

export function NewWeightDialog({ project, onCancel, onDone }: Props) {
  const taken = new Set(project.weights.map((w) => w.weight))
  const takenNames = new Set(project.weights.map((w) => w.name.toLowerCase()))
  const firstFree = [700, 300, 500, 600, 800, 200, 900, 100].find((w) => !taken.has(w)) ?? 700
  const [weight, setWeight] = useState(firstFree)
  const [name, setName] = useState(() => WEIGHTS.find(([w]) => w === firstFree)?.[1] ?? '')
  const nearest = (w: number) =>
    [...project.weights].sort((a, b) => Math.abs(a.weight - w) - Math.abs(b.weight - w))[0]?.name ?? project.weight
  const [copyFrom, setCopyFrom] = useState(() => nearest(firstFree))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickWeight = (w: number) => {
    // Keep a custom name; otherwise follow the standard name for the weight.
    const standard = new Set(WEIGHTS.map(([, n]) => n))
    if (!name || standard.has(name)) setName(WEIGHTS.find(([x]) => x === w)?.[1] ?? name)
    setWeight(w)
    setCopyFrom(nearest(w))
  }

  const problem = !NAME.test(name)
    ? 'Use letters, digits, - or _ (it also names the folder)'
    : takenNames.has(name.toLowerCase()) ? `There is already a weight called ${name}`
      : taken.has(weight) ? `There is already a weight at ${weight}` : null

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.addWeight(name, weight, copyFrom)
      onDone(res.project, name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const current = project.weights[0]
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal new-weight-dialog" role="dialog" aria-label="New weight">
        <header>
          <h2>New weight</h2>
          <span className="muted small">
            It starts as a copy of a weight you pick (SVGs, anchors, widths and kerning). Redraw its SVGs heavier or
            lighter in Illustrator.
          </span>
        </header>
        <div className="new-weight-body">
          <div className="row">
            <label>
              <span>Weight</span>
              <select value={weight} onChange={(e) => pickWeight(Number(e.target.value))}>
                {WEIGHTS.map(([w, n]) => (
                  <option key={w} value={w} disabled={taken.has(w)}>{w} · {n}{taken.has(w) ? ' (exists)' : ''}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value.trim())} />
            </label>
            <label>
              <span>Start from</span>
              <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                {project.weights.map((w) => <option key={w.name} value={w.name}>{w.name} · {w.weight}</option>)}
              </select>
            </label>
          </div>
          <p className="muted small">
            Its SVGs go in <code>glyphs/{name || '…'}/</code>.
            {project.flatLayout && current && (
              <> Your {current.name} SVGs move from <code>glyphs/</code> into <code>glyphs/{current.name}/</code> (and
                {' '}<code>font.ufo</code> to <code>masters/{current.name}.ufo</code>), so close any of them that are open
                in Illustrator first.</>
            )}
          </p>
          {problem && <p className="warn-text small">{problem}</p>}
          {error && <p className="error small">{error}</p>}
        </div>
        <footer>
          <span className="spacer" />
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="primary" disabled={!!problem || busy} onClick={() => void submit()}>
            {busy ? 'Copying…' : `Add ${name || 'weight'}`}
          </button>
        </footer>
      </div>
    </div>
  )
}
