import { useEffect, useMemo, useState } from 'react'
import { api, type CompatReport, type Project, type VariableSetup } from '../api'
import { ShapingFont } from '../shaping'
import { CommitInput } from './GlyphEditor'

interface Props {
  project: Project
  compat: CompatReport | null
  onOpenGlyph: (name: string) => void
  onNewWeight: () => void
  onError: (msg: string) => void
}

const SEVERITY_LABEL = { error: 'Needs redrawing', fixable: 'Fixable in the app', warning: 'May look off in between' }

/** The Variable tab: weight axis, named instances, a live interpolation preview and the compatibility report. */
export function VariablePanel({ project, compat, onOpenGlyph, onNewWeight, onError }: Props) {
  const [setup, setSetup] = useState<VariableSetup | null>(null)

  useEffect(() => {
    api.variable().then(setSetup).catch((e) => onError(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.revision, project.weights.length])

  if (!setup) return null
  if (!setup.available) {
    return (
      <div className="panel-page">
        <div className="panel light">
          <h2>Variable font</h2>
          <p>
            A variable font holds a whole range of weights in one file, interpolated from the weights you draw. It needs
            at least two weights, e.g. a Light and a Bold, drawn with the same points.
          </p>
          <div className="row">
            <button className="primary" onClick={onNewWeight}>+ New weight…</button>
          </div>
        </div>
      </div>
    )
  }

  const save = async (values: Parameters<typeof api.setVariable>[0]) => {
    try {
      setSetup(await api.setVariable(values))
    } catch (e) {
      onError(String(e))
    }
  }

  return (
    <div className="variable-layout">
      <div className="kerning-main">
        <VariablePreview project={project} setup={setup} />

        <div className="card light">
          <h2>Weight axis</h2>
          <p className="muted small">
            Each weight sits on the axis at its weight class. The default weight is what the font shows when no weight
            is chosen.
          </p>
          <div className="axis">
            {setup.masters!.map((m) => (
              <div key={m.name} className="axis-stop" style={{ left: `${pct(setup, m.weight)}%` }}>
                <span className="axis-dot" />
                <span>{m.name}</span>
                <span className="muted small">{m.weight}</span>
              </div>
            ))}
          </div>
          <div className="row">
            <label className="muted" htmlFor="default-weight">Default weight</label>
            <select id="default-weight" value={setup.default} onChange={(e) => void save({ default: e.target.value })}>
              {setup.masters!.map((m) => <option key={m.name} value={m.name}>{m.name} · {m.weight}</option>)}
            </select>
            <span className="spacer" />
            <button onClick={onNewWeight}>+ New weight…</button>
          </div>
        </div>

        <div className="card light">
          <h2>Named instances</h2>
          <p className="muted small">
            In-between styles that apps list by name (e.g. Medium at 500). Any weight from {setup.min} to {setup.max} works.
          </p>
          <table className="rules">
            <tbody>
              {setup.instances!.map((inst, i) => (
                <tr key={`${inst.name}-${i}`}>
                  <td>
                    <CommitInput value={inst.name} onCommit={(v) => void save({
                      instances: setup.instances!.map((x, j) => (j === i ? { ...x, name: v.trim() } : x)),
                    })} />
                  </td>
                  <td className="num-cell">
                    <CommitInput value={String(inst.weight)} numeric onCommit={(v) => void save({
                      instances: setup.instances!.map((x, j) => (j === i ? { ...x, weight: Math.round(Number(v)) } : x)),
                    })} />
                  </td>
                  <td>
                    <button className="icon" title="Remove instance"
                      onClick={() => void save({ instances: setup.instances!.filter((_, j) => j !== i) })}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button onClick={() => void save({
              instances: [...setup.instances!, { name: 'New', weight: Math.round((setup.min! + setup.max!) / 2) }],
            })}>+ Add instance</button>
          </div>
        </div>
      </div>

      <aside className="side-panel light">
        <h4>Compatibility</h4>
        <CompatReportView compat={compat} onOpenGlyph={onOpenGlyph} />
      </aside>
    </div>
  )
}

function pct(setup: VariableSetup, weight: number) {
  const span = setup.max! - setup.min! || 1
  return ((weight - setup.min!) / span) * 100
}

/** The variable font rendered by HarfBuzz at any weight along the axis. */
function VariablePreview({ project, setup }: { project: Project; setup: VariableSetup }) {
  const [font, setFont] = useState<ShapingFont | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [weight, setWeight] = useState(() => setup.masters!.find((m) => m.name === setup.default)?.weight ?? setup.min!)
  const [text, setText] = useState(() => project.settings.previewText?.split('\n')[0] ?? 'שָׁלוֹם בַּת אל')

  useEffect(() => {
    let cancelled = false
    api.variableFont()
      .then((data) => {
        if (!cancelled) {
          setFont(new ShapingFont(data))
          setError(null)
        }
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
    return () => {
      cancelled = true
    }
  }, [project.revision])

  const run = useMemo(() => {
    if (!font) return null
    font.setVariations({ wght: weight })
    return font.shape(text, { kern: true, mark: true, liga: true })
  }, [font, weight, text])

  const { ascender, descender } = project.info
  const lineHeight = ascender - descender
  return (
    <div className="card light">
      <div className="row">
        <h2>Interpolation preview</h2>
        <span className="spacer" />
        <strong className="weight-readout">{Math.round(weight)}</strong>
      </div>
      <div className="variable-preview">
        {error ? <div className="compile-error">{error}</div> : run && (
          <svg viewBox={`-20 ${-ascender} ${run.width + 40} ${lineHeight}`} preserveAspectRatio="xMaxYMid meet">
            {run.glyphs.map((g, i) => (
              <path key={i} d={g.path} transform={`translate(${g.x},${-g.y}) scale(1,-1)`} />
            ))}
          </svg>
        )}
      </div>
      <input type="range" min={setup.min} max={setup.max} value={weight} onChange={(e) => setWeight(Number(e.target.value))}
        aria-label="Weight" className="weight-slider" />
      <div className="row">
        {setup.instances!.map((i) => (
          <button key={`${i.name}${i.weight}`} className={`toggle ${Math.round(weight) === i.weight ? 'on' : 'off'}`}
            onClick={() => setWeight(i.weight)}>{i.name}</button>
        ))}
        <span className="spacer" />
        <input dir="rtl" value={text} onChange={(e) => setText(e.target.value)} aria-label="Preview text" />
      </div>
      <p className="hint">Glyphs that don't match across weights yet are shown at the default weight.</p>
    </div>
  )
}

function CompatReportView({ compat, onOpenGlyph }: { compat: CompatReport | null; onOpenGlyph: (g: string) => void }) {
  if (!compat) return <p className="hint">Checking…</p>
  const entries = Object.entries(compat.glyphs)
  if (!entries.length) {
    return <p className="gap-ok">Every glyph matches across the weights. The variable font is ready to export.</p>
  }
  const bySeverity = (sev: string) => entries.filter(([, ps]) => ps.some((p) => p.severity === sev))
  return (
    <div className="compat-report">
      <p className="hint">
        {compat.errors} to redraw · {compat.fixable} fixable · {compat.warnings} warnings. Export skips the variable font
        until nothing needs redrawing or fixing.
      </p>
      {(['error', 'fixable', 'warning'] as const).map((sev) => {
        const glyphs = bySeverity(sev)
        if (!glyphs.length) return null
        return (
          <div key={sev} className="compat-list">
            <h4>{SEVERITY_LABEL[sev]}</h4>
            <ul>
              {glyphs.map(([name, ps]) => (
                <li key={name} className={sev}>
                  <button className="link" onClick={() => onOpenGlyph(name)}>{name}</button>
                  {ps.filter((p) => p.severity === sev).map((p, i) => <div key={i}>{p.message}</div>)}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
