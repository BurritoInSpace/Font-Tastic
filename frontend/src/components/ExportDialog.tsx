import { useState } from 'react'
import { api, type CompatReport, type Project } from '../api'

type Format = 'otf' | 'ttf'

interface ExportChoice {
  staticFormats: Format[]
  /** null: every weight */
  weights: string[] | null
  variableFormats: Format[]
}

interface Props {
  project: Project
  compat: CompatReport | null
  onCancel: () => void
  onDone: (result: { paths: string[]; bytes: number; variableNote: string | null }) => void
  onError: (msg: string) => void
}

const DEFAULT: ExportChoice = { staticFormats: ['otf', 'ttf'], weights: null, variableFormats: ['otf', 'ttf'] }

/** Choose what Export writes into build/; the choice is remembered per project. */
export function ExportDialog({ project, compat, onCancel, onDone, onError }: Props) {
  const saved = (project.settings as { export?: ExportChoice }).export
  const [choice, setChoice] = useState<ExportChoice>(() => ({ ...DEFAULT, ...saved }))
  const [busy, setBusy] = useState(false)

  const allWeights = project.weights.map((w) => w.name)
  const chosenWeights = choice.weights ?? allWeights
  const blocking = compat ? compat.errors + compat.fixable : 0
  const variableBlocked = project.weights.length < 2
    ? 'Needs at least two weights'
    : blocking > 0
      ? `${blocking} problem${blocking === 1 ? '' : 's'} to fix first (see the variable tab)`
      : null
  const variableFormats = variableBlocked ? [] : choice.variableFormats

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])
  const staticNothing = choice.staticFormats.length === 0 || chosenWeights.length === 0
  const nothing = staticNothing && variableFormats.length === 0

  const submit = async () => {
    setBusy(true)
    const request = {
      staticFormats: chosenWeights.length ? choice.staticFormats : [],
      weights: choice.weights,
      variableFormats,
    }
    try {
      await api.saveSettings({ export: choice }).catch(() => {})
      const res = await api.exportFonts(request)
      onDone(res)
    } catch (e) {
      onError(String(e))
      setBusy(false)
    }
  }

  const count = (staticNothing ? 0 : choice.staticFormats.length * chosenWeights.length) + variableFormats.length

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal export-dialog" role="dialog" aria-label="Export">
        <header>
          <h2>Export</h2>
          <span className="muted small">Fonts are written into the project's <code>build/</code> folder.</span>
        </header>
        <div className="export-body">
          <section>
            <h4>Single weights</h4>
            <div className="row">
              {(['otf', 'ttf'] as Format[]).map((f) => (
                <label key={f} className="check">
                  <input type="checkbox" checked={choice.staticFormats.includes(f)}
                    onChange={() => setChoice({ ...choice, staticFormats: toggle(choice.staticFormats, f) })} />
                  {f.toUpperCase()} <span className="muted small">{f === 'otf' ? 'curves as drawn' : 'TrueType curves'}</span>
                </label>
              ))}
            </div>
            {allWeights.length > 1 && (
              <div className="row weights-pick">
                {allWeights.map((w) => (
                  <label key={w} className="check">
                    <input type="checkbox" checked={chosenWeights.includes(w)}
                      onChange={() => {
                        const next = toggle(chosenWeights, w)
                        setChoice({ ...choice, weights: next.length === allWeights.length ? null : next })
                      }} />
                    {w}
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className={variableBlocked ? 'disabled' : ''}>
            <h4>Variable font</h4>
            <div className="row">
              {(['otf', 'ttf'] as Format[]).map((f) => (
                <label key={f} className="check">
                  <input type="checkbox" disabled={!!variableBlocked} checked={variableFormats.includes(f)}
                    onChange={() => setChoice({ ...choice, variableFormats: toggle(choice.variableFormats, f) })} />
                  {f.toUpperCase()} <span className="muted small">{f === 'otf' ? 'CFF2, curves as drawn' : 'TrueType'}</span>
                </label>
              ))}
            </div>
            {variableBlocked && <p className="muted small">{variableBlocked}</p>}
          </section>
        </div>
        <footer>
          <span className="muted small">{nothing ? 'Pick at least one thing to export' : `${count} file${count === 1 ? '' : 's'}`}</span>
          <span className="spacer" />
          <button className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="primary" disabled={nothing || busy} onClick={() => void submit()}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </footer>
      </div>
    </div>
  )
}
