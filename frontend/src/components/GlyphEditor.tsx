import { useEffect, useRef, useState } from 'react'
import { api, type Anchor, type Glyph, type Project } from '../api'
import { basesFor, glyphLabel, marksFor, STANDARD_ANCHORS } from '../glyphs'

interface Props {
  project: Project
  glyph: Glyph
  onChanged: () => void
  onError: (msg: string) => void
  onMessage?: (msg: string) => void
}

const PAD = 160

export function GlyphEditor({ project, glyph, onChanged, onError, onMessage }: Props) {
  const [anchors, setAnchors] = useState<Anchor[]>(glyph.anchors)
  const [active, setActive] = useState<number | null>(null)
  const [showGhosts, setShowGhosts] = useState(true)
  const [ghostChoice, setGhostChoice] = useState<Record<string, string>>({})
  const groupRef = useRef<SVGGElement>(null)
  const drag = useRef<{ index: number; moved: boolean } | null>(null)
  const nudgeTimer = useRef<number | undefined>(undefined)

  // Server state wins whenever the glyph (or the project revision) changes.
  useEffect(() => {
    setAnchors(glyph.anchors)
  }, [glyph])
  useEffect(() => setActive(null), [glyph.name])

  const commit = async (next: Anchor[]) => {
    try {
      await api.setAnchors(glyph.name, next)
      onChanged()
    } catch (e) {
      onError(String(e))
    }
  }

  const editInIllustrator = async () => {
    try {
      const res = await api.editGlyph(glyph.name)
      onMessage?.(
        `${res.created ? `Wrote ${glyph.name}.svg from the current outline and opened` : 'Opened'} it in ${res.app}. ` +
          'Save there and it updates here.',
      )
      if (res.created) onChanged()
    } catch (e) {
      onError(String(e))
    }
  }

  const toFont = (e: { clientX: number; clientY: number }) => {
    const g = groupRef.current!
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(g.getScreenCTM()!.inverse())
    return { x: Math.round(pt.x), y: Math.round(pt.y) }
  }

  const onPointerDown = (index: number) => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { index, moved: false }
    setActive(index)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const { x, y } = toFont(e)
    drag.current.moved = true
    const i = drag.current.index
    setAnchors((prev) => prev.map((a, j) => (j === i ? { ...a, x, y } : a)))
  }
  const onPointerUp = () => {
    if (drag.current?.moved) void commit(anchors)
    drag.current = null
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        void editInIllustrator()
        return
      }
      if (active === null) return
      const step = e.shiftKey ? 10 : 1
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const next = anchors.filter((_, j) => j !== active)
        setAnchors(next)
        setActive(null)
        void commit(next)
        return
      }
      if (!d) return
      e.preventDefault()
      const next = anchors.map((a, j) => (j === active ? { ...a, x: a.x + d[0], y: a.y + d[1] } : a))
      setAnchors(next)
      window.clearTimeout(nudgeTimer.current)
      nudgeTimer.current = window.setTimeout(() => void commit(next), 350)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const { info } = project
  const isMark = glyph.category === 'mark'
  const [bx0, by0, bx1, by1] = glyph.bounds ?? [0, 0, glyph.width, 0]
  const x0 = Math.min(0, bx0) - PAD
  const x1 = Math.max(glyph.width, bx1, x0 + PAD + 200) + PAD
  const yTop = Math.max(info.ascender, by1) + PAD
  const yBottom = Math.min(info.descender, by0) - PAD

  // Ghost glyphs: marks hanging off this base's anchors, or a base under this mark.
  const ghosts: { key: string; glyph: Glyph; dx: number; dy: number }[] = []
  const companions: { anchor: string; options: Glyph[]; chosen: Glyph | undefined }[] = []
  for (const a of anchors) {
    const options = isMark
      ? a.name.startsWith('_') ? basesFor(project, a.name) : []
      : a.name.startsWith('_') ? [] : marksFor(project, a.name)
    if (options.length === 0) continue
    const chosen = options.find((g) => g.name === ghostChoice[a.name]) ?? options[0]
    companions.push({ anchor: a.name, options, chosen })
    if (!showGhosts || !chosen) continue
    const partnerName = isMark ? a.name.slice(1) : `_${a.name}`
    const pa = chosen.anchors.find((p) => p.name === partnerName)
    if (pa) ghosts.push({ key: a.name, glyph: chosen, dx: a.x - pa.x, dy: a.y - pa.y })
  }

  const metricLines = [
    { y: info.ascender, label: 'ascender' },
    { y: info.capHeight, label: 'cap height' },
    { y: info.xHeight, label: 'x-height' },
    { y: 0, label: 'baseline' },
    { y: info.descender, label: 'descender' },
  ]

  const addAnchor = (name: string) => {
    if (!name || anchors.some((a) => a.name === name)) return
    const cx = Math.round(glyph.bounds ? (bx0 + bx1) / 2 : glyph.width / 2)
    const next = [...anchors, { name, x: cx, y: name.includes('bottom') ? 0 : info.capHeight }]
    setAnchors(next)
    setActive(next.length - 1)
    void commit(next)
  }

  const suggestions = STANDARD_ANCHORS.map((n) => (isMark ? `_${n}` : n)).filter(
    (n) => !anchors.some((a) => a.name === n),
  )

  return (
    <div className="editor">
      <div className="canvas-wrap">
        <svg
          className="canvas"
          viewBox={`${x0} ${-yTop} ${x1 - x0} ${yTop - yBottom}`}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerDown={() => setActive(null)}
        >
          <g ref={groupRef} transform="scale(1,-1)">
            {metricLines.map((m) => (
              <line key={m.label} className={`metric ${m.label === 'baseline' ? 'baseline' : ''}`}
                x1={x0} x2={x1} y1={m.y} y2={m.y} />
            ))}
            <rect className="advance" x={0} y={info.descender} width={glyph.width}
              height={info.ascender - info.descender} />
            {ghosts.map((g) => (
              <path key={g.key} className="ghost" d={g.glyph.path} transform={`translate(${g.dx},${g.dy})`} />
            ))}
            <path className="outline" d={glyph.path} />
            {anchors.map((a, i) => (
              <g key={i} className={`anchor${i === active ? ' active' : ''}${a.name.startsWith('_') ? ' mark-anchor' : ''}`}
                transform={`translate(${a.x},${a.y})`} onPointerDown={onPointerDown(i)}>
                <circle r={18} />
                <line x1={-34} x2={34} y1={0} y2={0} />
                <line x1={0} x2={0} y1={-34} y2={34} />
              </g>
            ))}
          </g>
          {metricLines.map((m) => (
            <text key={m.label} className="metric-label" x={x0 + 12} y={-m.y - 10}>{m.label}</text>
          ))}
          {anchors.map((a, i) => (
            <text key={i} className={`anchor-label${a.name.startsWith('_') ? ' mark-anchor' : ''}`} x={a.x + 26} y={-a.y - 26}>{a.name}</text>
          ))}
        </svg>
      </div>

      <aside className="inspector">
        <header>
          <div className="big-char">{glyph.char}</div>
          <div>
            <h2>{glyph.name}</h2>
            <div className="muted">
              {glyphLabel(glyph)} · {glyph.category}
              {glyph.source ? ` · ${glyph.source}` : glyph.auto ? ' · auto-generated' : ''}
            </div>
          </div>
        </header>

        <div className="row">
          <button className="primary" onClick={() => void editInIllustrator()} title="Ctrl+E">
            Edit in Illustrator
          </button>
          <button disabled={!glyph.source || glyph.sourceMissing}
            onClick={() => api.revealGlyph(glyph.name).catch((e) => onError(String(e)))}
            title={glyph.source ? `Show ${glyph.source} in Explorer` : 'No SVG yet'}>
            Show file
          </button>
        </div>
        {glyph.sourceMissing && (
          <p className="warnings">
            {glyph.source} was deleted or moved. The outline is kept; Edit in Illustrator writes a new SVG from it.
          </p>
        )}

        {glyph.warnings.length > 0 && (
          <ul className="warnings">{glyph.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        )}

        <WidthField glyph={glyph} onChanged={onChanged} onError={onError} />

        <h4>Anchors</h4>
        <table className="anchors">
          <tbody>
            {anchors.map((a, i) => (
              <tr key={i} className={i === active ? 'active' : ''} onClick={() => setActive(i)}>
                <td><CommitInput value={a.name} onCommit={(v) => {
                  const next = anchors.map((b, j) => (j === i ? { ...b, name: v.trim() } : b))
                  setAnchors(next); void commit(next)
                }} /></td>
                {(['x', 'y'] as const).map((k) => (
                  <td key={k}><CommitInput value={String(a[k])} numeric onCommit={(v) => {
                    const next = anchors.map((b, j) => (j === i ? { ...b, [k]: Number(v) } : b))
                    setAnchors(next); void commit(next)
                  }} /></td>
                ))}
                <td><button className="icon" title="Delete anchor" onClick={() => {
                  const next = anchors.filter((_, j) => j !== i)
                  setAnchors(next); setActive(null); void commit(next)
                }}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          {suggestions.map((n) => (
            <button key={n} className="chip" onClick={() => addAnchor(n)}>+ {n}</button>
          ))}
          <CommitInput value="" placeholder="custom…" onCommit={(v) => addAnchor(v.trim())} />
        </div>
        <p className="hint">Drag anchors on the canvas · arrow keys nudge (Shift ×10) · Delete removes</p>

        {companions.length > 0 && (
          <>
            <h4>
              <label><input type="checkbox" checked={showGhosts} onChange={(e) => setShowGhosts(e.target.checked)} />
                {' '}Preview {isMark ? 'on base' : 'marks'}</label>
            </h4>
            {companions.map((c) => (
              <div className="row" key={c.anchor}>
                <span className="muted anchor-name">{c.anchor}</span>
                <select value={c.chosen?.name} onChange={(e) => setGhostChoice({ ...ghostChoice, [c.anchor]: e.target.value })}>
                  {c.options.map((g) => <option key={g.name} value={g.name}>{g.char} {g.name}</option>)}
                </select>
              </div>
            ))}
          </>
        )}
      </aside>
    </div>
  )
}

function WidthField({ glyph, onChanged, onError }: Omit<Props, 'project'>) {
  const set = async (width: number | null) => {
    try {
      await api.setWidth(glyph.name, width)
      onChanged()
    } catch (e) {
      onError(String(e))
    }
  }
  return (
    <div className="row width-row">
      <label>Advance width</label>
      <CommitInput value={String(glyph.width)} numeric onCommit={(v) => void set(Number(v))} />
      {glyph.widthOverride && glyph.source && (
        <button className="link" onClick={() => void set(null)} title="Use the Illustrator artboard width again">
          reset to artboard
        </button>
      )}
    </div>
  )
}

/** Text input that only reports on Enter or blur, so typing doesn't spam the server. */
export function CommitInput({ value, onCommit, numeric, placeholder }: {
  value: string
  onCommit: (v: string) => void
  numeric?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const done = () => {
    if (draft === value || (numeric && (draft.trim() === '' || Number.isNaN(Number(draft))))) {
      setDraft(value)
      return
    }
    onCommit(draft)
    if (value === '') setDraft('')
  }
  return (
    <input
      value={draft}
      placeholder={placeholder}
      inputMode={numeric ? 'numeric' : undefined}
      className={numeric ? 'num' : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}
