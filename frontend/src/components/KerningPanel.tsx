import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Glyph, type Project } from '../api'
import { charsToGlyphs } from '../glyphs'
import { CommitInput } from './GlyphEditor'

interface Props {
  project: Project
  onChanged: () => void
  onError: (msg: string) => void
}

const pairKey = (a: string, b: string) => `${a} ${b}`

export function KerningPanel({ project, onChanged, onError }: Props) {
  const glyphs = project.glyphs.filter((g) => g.category !== 'mark' && !g.name.startsWith('.'))
  const byName = useMemo(() => new Map(project.glyphs.map((g) => [g.name, g])), [project.glyphs])
  const saved = useMemo(
    () => new Map(project.kerning.map((k) => [pairKey(k.first, k.second), k.value])),
    [project.kerning],
  )

  const [first, setFirst] = useState(() => glyphs[0]?.name ?? '')
  const [second, setSecond] = useState(() => glyphs[1]?.name ?? '')
  const [typed, setTyped] = useState('')
  const [context, setContext] = useState('')
  const [value, setValue] = useState(0)
  // One debounce timer per pair, so switching pairs never drops a pending save.
  const saveTimers = useRef(new Map<string, number>())

  // Picking a pair loads its stored value. (Not re-synced on every save, or a
  // slow round-trip would overwrite clicks made in the meantime.)
  useEffect(() => {
    setValue(saved.get(pairKey(first, second)) ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, second])

  const commit = (v: number) => {
    const key = pairKey(first, second)
    window.clearTimeout(saveTimers.current.get(key))
    saveTimers.current.set(key, window.setTimeout(async () => {
      saveTimers.current.delete(key)
      try {
        await api.setKern(first, second, v)
        onChanged()
      } catch (e) {
        onError(String(e))
      }
    }, 300))
  }
  const change = (v: number) => {
    setValue(v)
    commit(v)
  }

  const pickTyped = (text: string) => {
    setTyped(text)
    const names = charsToGlyphs(project, text)
    if (names && names.length === 2) {
      setFirst(names[0])
      setSecond(names[1])
    }
  }

  const ctx = charsToGlyphs(project, context) ?? []
  const sequence = [...ctx, first, second, ...ctx].map((n) => byName.get(n)).filter((g): g is Glyph => !!g)
  const kernOf = (a: string, b: string) =>
    a === first && b === second ? value : (saved.get(pairKey(a, b)) ?? 0)

  return (
    <div className="panel kerning">
      <h2>Kerning</h2>
      <p className="muted">
        Type a pair the way you write it. For <span dir="rtl">בת</span> the first glyph is bet, on the right.
        Negative values pull the pair together.
      </p>

      <div className="row pair-picker" dir="rtl">
        <input className="pair-input" dir="rtl" value={typed} placeholder="בת" maxLength={4}
          onChange={(e) => pickTyped(e.target.value)} />
        <GlyphSelect glyphs={glyphs} value={first} onChange={setFirst} />
        <span className="muted">+</span>
        <GlyphSelect glyphs={glyphs} value={second} onChange={setSecond} />
        <span className="spacer" />
        <input dir="auto" value={context} placeholder="context letters" onChange={(e) => setContext(e.target.value)} />
      </div>

      <PairView project={project} sequence={sequence} kernOf={kernOf} firstIndex={ctx.length} />

      <div className="row kern-controls">
        <button onClick={() => change(value - 10)} title="Tighter by 10">−10</button>
        <button onClick={() => change(value - 1)} title="Tighter by 1">−1</button>
        <input type="range" min={-400} max={200} value={value} onChange={(e) => change(Number(e.target.value))} />
        <button onClick={() => change(value + 1)} title="Looser by 1">+1</button>
        <button onClick={() => change(value + 10)} title="Looser by 10">+10</button>
        <CommitInput value={String(value)} numeric onCommit={(v) => change(Math.round(Number(v)))} />
        <button disabled={value === 0 && !saved.has(pairKey(first, second))} onClick={() => change(0)}>Remove</button>
      </div>

      <h4>Pairs <span className="muted">{project.kerning.length}</span></h4>
      {project.kerning.length === 0 ? (
        <p className="muted small">No kerning yet.</p>
      ) : (
        <table className="rules kern-list">
          <tbody>
            {project.kerning.map((k) => (
              <tr key={pairKey(k.first, k.second)}
                className={k.first === first && k.second === second ? 'active' : ''}
                onClick={() => { setFirst(k.first); setSecond(k.second); setTyped('') }}>
                <td className="seq" dir="rtl">{byName.get(k.first)?.char}{byName.get(k.second)?.char}</td>
                <td className="muted small">{k.first} + {k.second}</td>
                <td className="num-cell">{k.value}</td>
                <td>
                  <button className="icon" title="Remove pair" onClick={async (e) => {
                    e.stopPropagation()
                    try {
                      await api.setKern(k.first, k.second, 0)
                      onChanged()
                    } catch (err) {
                      onError(String(err))
                    }
                  }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function GlyphSelect({ glyphs, value, onChange }: { glyphs: Glyph[]; value: string; onChange: (v: string) => void }) {
  return (
    <select dir="ltr" value={value} onChange={(e) => onChange(e.target.value)}>
      {glyphs.map((g) => (
        <option key={g.name} value={g.name}>{g.char ? `${g.char}  ${g.name}` : g.name}</option>
      ))}
    </select>
  )
}

/** Draws a logical-order glyph sequence right to left, applying kerning between neighbours. */
function PairView({ project, sequence, kernOf, firstIndex }: {
  project: Project
  sequence: Glyph[]
  kernOf: (a: string, b: string) => number
  /** logical index of the pair's first glyph; the pair is drawn highlighted */
  firstIndex: number
}) {
  const { ascender, descender } = project.info
  const visual = [...sequence].reverse()
  const placed: { glyph: Glyph; x: number; hot: boolean }[] = []
  let x = 0
  visual.forEach((g, j) => {
    if (j > 0) x += kernOf(g.name, visual[j - 1].name) // logical pair is (right, left)
    const logicalIndex = sequence.length - 1 - j
    placed.push({ glyph: g, x, hot: logicalIndex === firstIndex || logicalIndex === firstIndex + 1 })
    x += g.width
  })
  const pad = 120
  const hot = placed.filter((p) => p.hot)
  const gapX = hot.length === 2 ? hot[0].x + hot[0].glyph.width : null

  return (
    <div className="pair-view">
      <svg viewBox={`${-pad} ${-ascender - 40} ${Math.max(x, 1) + pad * 2} ${ascender - descender + 80}`}>
        <line className="metric baseline" x1={-pad} x2={x + pad} y1={0} y2={0} />
        {gapX !== null && <line className="kern-seam" x1={gapX} x2={gapX} y1={-ascender} y2={-descender} />}
        {placed.map((p, i) => (
          <g key={i} transform={`translate(${p.x},0)`}>
            <rect className="glyph-box" x={0} y={-ascender} width={p.glyph.width} height={ascender - descender} />
            <path className={p.hot ? 'hot' : 'ctx'} d={p.glyph.path} transform="scale(1,-1)" />
          </g>
        ))}
      </svg>
    </div>
  )
}
