import { useEffect, useState } from 'react'
import { api, type AxisPreset, type Project } from '../api'
import { SUGGESTED, WEIGHT_NAMES, describeLocation, sameLocation, suggestName, type Location } from '../axes'

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

interface Props {
  project: Project
  onCancel: () => void
  onDone: (project: Project, name: string) => void
}

/** Add a master: a copy of an existing one, placed somewhere else on the axes, to redraw. */
export function NewWeightDialog({ project, onCancel, onDone }: Props) {
  const axes = project.axes
  const current = project.weights.find((w) => w.active) ?? project.weights[0]
  const [presets, setPresets] = useState<Record<string, AxisPreset>>({})
  const takenBy = (loc: Location) => project.weights.find((w) => sameLocation(axes, w.location, loc))
  const [location, setLocation] = useState<Location>(() => {
    for (const w of [700, 300, 500, 600, 800, 200, 900, 100]) {
      const loc = { ...current.location, wght: w }
      if (!takenBy(loc)) return loc
    }
    return { ...current.location }
  })
  const defaults: Location = Object.fromEntries(axes.map((a) => [a.tag, presets[a.tag]?.default ?? 0]))
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [copyFrom, setCopyFrom] = useState(current.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.variable().then((v) => setPresets(v.presets)).catch(() => {})
  }, [])
  // Follow the location with a standard name until the user types their own.
  useEffect(() => {
    if (!nameEdited) setName(suggestName(axes, location, defaults))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, presets, nameEdited])

  /** The master closest to a location, each axis measured against its spread. */
  const nearest = (loc: Location) => {
    const span = (tag: string) => {
      const values = project.weights.map((w) => w.location[tag]).concat(loc[tag])
      return Math.max(1, Math.max(...values) - Math.min(...values))
    }
    const distance = (l: Location) => axes.reduce((d, a) => d + Math.abs(l[a.tag] - loc[a.tag]) / span(a.tag), 0)
    return [...project.weights].sort((a, b) => distance(a.location) - distance(b.location))[0]?.name ?? current.name
  }

  const setAxis = (tag: string, value: number) => {
    const next = { ...location, [tag]: value }
    setLocation(next)
    setCopyFrom(nearest(next))
  }

  const existing = takenBy(location)
  const takenNames = new Set(project.weights.map((w) => w.name.toLowerCase()))
  const outOfRange = axes.find((a) => {
    const p = presets[a.tag]
    return p && !(location[a.tag] >= p.min && location[a.tag] <= p.max)
  })
  const problem = !NAME.test(name)
    ? 'Use letters, digits, - or _ (it also names the folder)'
    : takenNames.has(name.toLowerCase()) ? `There is already a master called ${name}`
      : existing ? `${existing.name} is already at ${describeLocation(axes, location)}`
        : outOfRange ? `${outOfRange.name} must be between ${presets[outOfRange.tag].min} and ${presets[outOfRange.tag].max}`
          : null

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.addWeight(name, copyFrom, location)
      onDone(res.project, name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const first = project.weights[0]
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal new-weight-dialog" role="dialog" aria-label="New master">
        <header>
          <h2>New master</h2>
          <span className="muted small">
            It starts as a copy of a master you pick (SVGs, anchors, widths and kerning), placed where you set it on
            the axes. Redraw its SVGs in Illustrator to match.
          </span>
        </header>
        <div className="new-weight-body">
          <div className="axis-fields">
            {axes.map((a) => (
              <label key={a.tag}>
                <span>{a.name}{presets[a.tag]?.unit ? ` (${presets[a.tag].unit})` : ''}</span>
                {a.tag === 'wght' ? (
                  <select value={location.wght} onChange={(e) => setAxis('wght', Number(e.target.value))}>
                    {!WEIGHT_NAMES.some(([w]) => w === location.wght) && <option value={location.wght}>{location.wght}</option>}
                    {WEIGHT_NAMES.map(([w, n]) => {
                      const there = takenBy({ ...location, wght: w })
                      return <option key={w} value={w}>{w} · {n}{there ? ` (${there.name})` : ''}</option>
                    })}
                  </select>
                ) : a.tag === 'ital' ? (
                  <select value={location.ital} onChange={(e) => setAxis('ital', Number(e.target.value))}>
                    <option value={0}>0 · Upright</option>
                    <option value={1}>1 · Italic</option>
                  </select>
                ) : (
                  <>
                    <input type="number" value={location[a.tag]} list={`suggest-${a.tag}`} step="any"
                      onChange={(e) => e.target.value !== '' && setAxis(a.tag, Number(e.target.value))} />
                    {SUGGESTED[a.tag] && (
                      <datalist id={`suggest-${a.tag}`}>
                        {SUGGESTED[a.tag].map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                      </datalist>
                    )}
                  </>
                )}
              </label>
            ))}
          </div>
          <div className="row">
            <label>
              <span>Name</span>
              <input value={name} onChange={(e) => { setName(e.target.value.trim()); setNameEdited(true) }} />
            </label>
            <label>
              <span>Start from</span>
              <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                {project.weights.map((w) => (
                  <option key={w.name} value={w.name}>{w.name} · {describeLocation(axes, w.location)}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted small">
            Its SVGs go in <code>glyphs/{name || '…'}/</code>.
            {axes.length === 1 && ' To vary along width, optical size or slant too, add the axis in the variable tab first.'}
            {project.flatLayout && first && (
              <> Your {first.name} SVGs move from <code>glyphs/</code> into <code>glyphs/{first.name}/</code> (and
                {' '}<code>font.ufo</code> to <code>masters/{first.name}.ufo</code>), so close any of them that are open
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
            {busy ? 'Copying…' : `Add ${name || 'master'}`}
          </button>
        </footer>
      </div>
    </div>
  )
}
