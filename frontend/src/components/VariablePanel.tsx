import { useEffect, useMemo, useState } from 'react'
import { api, type AxisRange, type CompatReport, type Project, type VariableSetup } from '../api'
import { describeLocation, type Location } from '../axes'
import { ShapingFont } from '../shaping'
import { CommitInput } from './GlyphEditor'

interface Props {
  project: Project
  compat: CompatReport | null
  /** points: open it in the numbered points view */
  onOpenGlyph: (name: string, points?: boolean) => void
  onNewWeight: () => void
  onError: (msg: string) => void
  onProject: (project: Project) => void
  onCompat: (compat: CompatReport) => void
  onMessage: (msg: string) => void
}

const SEVERITY_LABEL = { error: 'Needs redrawing', fixable: 'Fixable in the app', warning: 'May look off in between' }

/** The Variable tab: axes and masters, named instances, a live interpolation preview and the compatibility report. */
export function VariablePanel({ project, compat, onOpenGlyph, onNewWeight, onError, onProject, onCompat, onMessage }: Props) {
  const [setup, setSetup] = useState<VariableSetup | null>(null)

  useEffect(() => {
    api.variable().then(setSetup).catch((e) => onError(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.revision, project.weights.length, project.axes.length])

  if (!setup) return null

  const save = async (values: Parameters<typeof api.setVariable>[0]) => {
    try {
      setSetup(await api.setVariable(values))
    } catch (e) {
      onError(String(e))
    }
  }
  /** Run an axis/master change; the server answers with the new project and setup. */
  const change = async (action: () => Promise<{ project: Project; variable: VariableSetup }>) => {
    try {
      const res = await action()
      onProject(res.project)
      setSetup(res.variable)
      return true
    } catch (e) {
      onError(String(e))
      return false
    }
  }

  const axesCard = (
    <AxesCard setup={setup} change={change} onNewWeight={onNewWeight} onDefault={(d) => void save({ default: d })} />
  )

  if (!setup.available) {
    return (
      <div className="panel-page">
        <div className="panel light">
          <h2>Variable font</h2>
          <p>
            A variable font holds a whole range of styles in one file, interpolated from the masters you draw: a Light
            and a Bold for a weight range, a Condensed and a Regular for width, and so on. It needs at least two
            masters, drawn with the same points.
          </p>
          <div className="row">
            <button className="primary" onClick={onNewWeight}>+ New master…</button>
          </div>
        </div>
        {axesCard}
      </div>
    )
  }

  return (
    <div className="variable-layout">
      <div className="kerning-main">
        <VariablePreview project={project} setup={setup} />
        {axesCard}
        <InstancesCard setup={setup} save={save} />
      </div>

      <aside className="side-panel light">
        <h4>Compatibility</h4>
        <CompatReportView compat={compat} onOpenGlyph={onOpenGlyph} defaultWeight={setup.default}
          onFixAll={async () => {
            try {
              const res = await api.fixAll()
              onProject(res.project)
              onCompat(res.compat)
              const failed = Object.entries(res.errors)
              if (failed.length) onError(`Couldn't match ${failed.map(([g, m]) => `${g} (${m})`).join('; ')}`)
              else onMessage(res.fixed.length ? `Matched ${res.fixed.join(', ')} to ${setup.default}` : 'Nothing to fix')
            } catch (e) {
              onError(String(e))
            }
          }}
          onFix={async (name) => {
            try {
              const res = await api.matchGlyph(name)
              onProject(res.project)
              const failed = Object.entries(res.errors)
              if (failed.length) onError(failed.map(([w, m]) => `${w}: ${m}`).join('; '))
              else onMessage(`Matched ${name} to ${setup.default}`)
            } catch (e) {
              onError(String(e))
            }
          }} />
      </aside>
    </div>
  )
}

const pct = (a: AxisRange, value: number) => ((value - a.min) / (a.max - a.min || 1)) * 100
const withUnit = (a: { unit: string }, v: number) => `${v}${a.unit === '%' || a.unit === '°' ? a.unit : a.unit ? ` ${a.unit}` : ''}`

/** The axes, where every master sits on them, and the default master. */
function AxesCard({ setup, change, onNewWeight, onDefault }: {
  setup: VariableSetup
  change: (action: () => Promise<{ project: Project; variable: VariableSetup }>) => Promise<boolean>
  onNewWeight: () => void
  onDefault: (name: string) => void
}) {
  const [adding, setAdding] = useState(false)
  return (
    <div className="card light">
      <div className="row">
        <h2 className="grow">Axes</h2>
        {!adding && <button onClick={() => setAdding(true)}>+ Add axis</button>}
      </div>
      <p className="muted small">
        Every master sits at a place on each axis. An axis goes into the font once masters differ along it.
      </p>

      {setup.axes.map((a) => {
        // masters at the same value share one stop
        const stops = new Map<number, string[]>()
        for (const m of setup.masters) stops.set(m.location[a.tag], [...(stops.get(m.location[a.tag]) ?? []), m.name])
        return (
          <div key={a.tag} className="axis-block">
            <div className="row">
              <strong>{a.name}</strong>
              <span className="muted small mono">{a.tag}</span>
              <span className="muted small grow">
                {a.active
                  ? `${withUnit(a, a.min)} to ${withUnit(a, a.max)}, default ${withUnit(a, a.default)}`
                  : `Every master is at ${withUnit(a, a.default)}. Add a master elsewhere on it to use it.`}
              </span>
              {a.tag !== 'wght' && (
                <button className="icon" title={`Remove the ${a.name} axis`}
                  onClick={() => void change(() => api.deleteAxis(a.tag))}>×</button>
              )}
            </div>
            {a.active && (
              <div className="axis">
                {[...stops].map(([value, names]) => (
                  <div key={value} style={{ left: `${pct(a, value)}%` }}
                    className={`axis-stop${value === a.default ? ' default' : ''}${value === a.min ? ' start' : value === a.max ? ' end' : ''}`}>
                    <span className="axis-dot" />
                    {names.map((n) => <span key={n}>{n}</span>)}
                    <span className="muted small">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {adding && (
        <AddAxisForm setup={setup} onCancel={() => setAdding(false)}
          onAdd={async (tag, name, value) => {
            if (await change(() => api.addAxis(tag, name, value))) setAdding(false)
          }} />
      )}

      {setup.missingCorners.length > 0 && (
        <p className="hint warn">
          No master drawn at {setup.missingCorners.map((c) => describeLocation(setup.axes, c)).join('; ')}. The font
          adds up the changes of the masters around it there, which can look off; add a master there if it does.
        </p>
      )}

      <h4>Masters</h4>
      <table className="rules masters-table">
        <thead>
          <tr>
            <th />
            {setup.axes.map((a) => <th key={a.tag}>{a.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {setup.masters.map((m) => (
            <tr key={m.name}>
              <td><strong>{m.name}</strong>{m.name === setup.default && <span className="muted small"> · default</span>}</td>
              {setup.axes.map((a) => (
                <td key={a.tag} className="num-cell">
                  <CommitInput value={String(m.location[a.tag])} numeric
                    onCommit={(v) => void change(() => api.moveMaster(m.name, { [a.tag]: Number(v) }))} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <label className="muted" htmlFor="default-weight">Default master</label>
        <select id="default-weight" value={setup.default} onChange={(e) => onDefault(e.target.value)}
          title="What the font shows when no style is chosen">
          {setup.masters.map((m) => (
            <option key={m.name} value={m.name}>{m.name} · {describeLocation(setup.axes, m.location)}</option>
          ))}
        </select>
        <span className="spacer" />
        <button onClick={onNewWeight}>+ New master…</button>
      </div>
    </div>
  )
}

function AddAxisForm({ setup, onCancel, onAdd }: {
  setup: VariableSetup
  onCancel: () => void
  onAdd: (tag: string, name: string, value: number) => void
}) {
  const free = Object.keys(setup.presets).filter((t) => !setup.axes.some((a) => a.tag === t))
  const [choice, setChoice] = useState(free[0] ?? 'custom')
  const [tag, setTag] = useState('')
  const [name, setName] = useState('')
  const preset = setup.presets[choice]
  const [value, setValue] = useState(preset?.default ?? 0)
  const pick = (c: string) => {
    setChoice(c)
    setValue(setup.presets[c]?.default ?? 0)
  }
  const custom = choice === 'custom'
  return (
    <div className="add-axis">
      <div className="row">
        <select value={choice} onChange={(e) => pick(e.target.value)} aria-label="Axis">
          {free.map((t) => <option key={t} value={t}>{setup.presets[t].name} ({t})</option>)}
          <option value="custom">Custom axis…</option>
        </select>
        {custom && (
          <>
            <input className="tag-input" value={tag} maxLength={4} placeholder="TAG" aria-label="Tag"
              onChange={(e) => setTag(e.target.value.toUpperCase())} />
            <input value={name} placeholder="Name, e.g. Serif" aria-label="Name" onChange={(e) => setName(e.target.value)} />
          </>
        )}
      </div>
      <p className="muted small">
        {custom
          ? 'A custom axis has a four-letter uppercase tag of your choosing (e.g. SERF for serif length).'
          : preset.about}
      </p>
      <div className="row">
        <label className="muted" htmlFor="axis-value">Existing masters are at</label>
        <input id="axis-value" type="number" step="any" className="num" value={value}
          onChange={(e) => setValue(Number(e.target.value))} />
        {preset?.unit && <span className="muted small">{preset.unit}</span>}
        <span className="spacer" />
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={custom && (tag.length !== 4 || !name.trim())}
          onClick={() => onAdd(custom ? tag : choice, custom ? name.trim() : '', value)}>
          Add axis
        </button>
      </div>
    </div>
  )
}

function InstancesCard({ setup, save }: {
  setup: VariableSetup
  save: (values: Parameters<typeof api.setVariable>[0]) => Promise<void>
}) {
  const active = setup.axes.filter((a) => a.active)
  const defaultLocation = setup.masters.find((m) => m.name === setup.default)?.location ?? {}
  const setInstance = (i: number, patch: { name?: string; location?: Location }) => void save({
    instances: setup.instances.map((x, j) => (j === i ? { ...x, ...patch, location: { ...x.location, ...patch.location } } : x)),
  })
  return (
    <div className="card light">
      <h2>Named instances</h2>
      <p className="muted small">
        In-between styles that apps list by name (e.g. Medium at weight 500), anywhere inside the masters' range.
      </p>
      <table className="rules instances-table">
        <thead>
          <tr>
            <th>Name</th>
            {active.map((a) => <th key={a.tag} className="num-cell">{a.name}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {setup.instances.map((inst, i) => (
            <tr key={`${inst.name}-${i}`}>
              <td><CommitInput value={inst.name} onCommit={(v) => setInstance(i, { name: v.trim() })} /></td>
              {active.map((a) => (
                <td key={a.tag} className="num-cell">
                  <CommitInput value={String(inst.location[a.tag])} numeric
                    onCommit={(v) => setInstance(i, { location: { [a.tag]: Number(v) } })} />
                </td>
              ))}
              <td>
                <button className="icon" title="Remove instance"
                  onClick={() => void save({ instances: setup.instances.filter((_, j) => j !== i) })}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button onClick={() => void save({ instances: [...setup.instances, { name: 'New', location: { ...defaultLocation } }] })}>
          + Add instance
        </button>
      </div>
    </div>
  )
}

/** The variable font rendered by HarfBuzz anywhere on the axes: one slider per axis. */
function VariablePreview({ project, setup }: { project: Project; setup: VariableSetup }) {
  const active = setup.axes.filter((a) => a.active)
  const [font, setFont] = useState<ShapingFont | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [location, setLocation] = useState<Location>(
    () => setup.masters.find((m) => m.name === setup.default)?.location ?? {})
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
    font.setVariations(Object.fromEntries(active.map((a) => [a.tag, location[a.tag] ?? a.default])))
    return font.shape(text, { kern: true, mark: true, liga: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, location, text, setup])

  const at = (a: AxisRange) => Math.min(a.max, Math.max(a.min, location[a.tag] ?? a.default))
  const { ascender, descender } = project.info
  const lineHeight = ascender - descender
  return (
    <div className="card light">
      <h2>Interpolation preview</h2>
      <div className="variable-preview">
        {error ? <div className="compile-error">{error}</div> : run && (
          <svg viewBox={`-20 ${-ascender} ${run.width + 40} ${lineHeight}`}
            preserveAspectRatio={run.rtl ? 'xMaxYMid meet' : 'xMinYMid meet'}>
            {run.glyphs.map((g, i) => (
              <path key={i} d={g.path} transform={`translate(${g.x},${-g.y}) scale(1,-1)`} />
            ))}
          </svg>
        )}
      </div>
      {active.map((a) => (
        <div key={a.tag} className="axis-slider">
          <span className="axis-slider-name">{a.name}</span>
          <input type="range" min={a.min} max={a.max} step={a.max - a.min <= 2 ? 0.01 : a.max - a.min <= 50 ? 0.1 : 1}
            value={at(a)} aria-label={a.name} className="weight-slider"
            onChange={(e) => setLocation({ ...location, [a.tag]: Number(e.target.value) })} />
          <strong className="weight-readout">{Math.round(at(a) * 10) / 10}</strong>
        </div>
      ))}
      <div className="row">
        {setup.instances.map((i) => {
          const on = active.every((a) => Math.abs(at(a) - i.location[a.tag]) < 0.05)
          return (
            <button key={`${i.name}${describeLocation(setup.axes, i.location)}`} className={`toggle ${on ? 'on' : 'off'}`}
              title={describeLocation(setup.axes, i.location)} onClick={() => setLocation({ ...i.location })}>
              {i.name}
            </button>
          )
        })}
        <span className="spacer" />
        <input dir="auto" value={text} onChange={(e) => setText(e.target.value)} aria-label="Preview text" />
      </div>
      <p className="hint">Glyphs that don't match across masters yet are shown at the default master.</p>
    </div>
  )
}

function CompatReportView({ compat, onOpenGlyph, defaultWeight, onFix, onFixAll }: {
  compat: CompatReport | null
  onOpenGlyph: (g: string, points?: boolean) => void
  defaultWeight: string
  onFix: (g: string) => void
  onFixAll: () => void
}) {
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
            <div className="row">
              <h4 className="grow">{SEVERITY_LABEL[sev]}</h4>
              {sev === 'fixable' && (
                <button className="secondary" onClick={onFixAll}
                  title={`Reorder contours and start points in every weight to follow ${defaultWeight}`}>
                  Fix all
                </button>
              )}
            </div>
            <ul>
              {glyphs.map(([name, ps]) => (
                <li key={name} className={sev}>
                  <div className="row">
                    <button className="link grow" onClick={() => onOpenGlyph(name, sev !== 'warning')}>{name}</button>
                    {sev === 'fixable' && (
                      <button className="chip" onClick={() => onFix(name)} title={`Match to ${defaultWeight}`}>Fix</button>
                    )}
                  </div>
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
