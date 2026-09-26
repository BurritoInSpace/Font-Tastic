import { useEffect, useRef, useState } from 'react'
import { api, type Anchor, type Glyph, type Project } from '../api'
import { basesFor, glyphLabel, marksFor, STANDARD_ANCHORS } from '../glyphs'
import { useConfirm } from './Confirm'
import { ReassignDialog } from './ReassignDialog'

interface Props {
  project: Project
  glyph: Glyph
  onChanged: () => void
  onError: (msg: string) => void
  onMessage?: (msg: string) => void
  /** jump to another glyph (e.g. one just created), or to none (after deleting) */
  onOpenGlyph?: (name: string | null) => void
  /** replace the project with one the server returned */
  onProject?: (project: Project) => void

}

const PAD = 160

export function GlyphEditor({ project, glyph, onChanged, onError, onMessage, onOpenGlyph, onProject }: Props) {
  const [reassigning, setReassigning] = useState(false)
  const confirm = useConfirm()
  const [anchors, setAnchors] = useState<Anchor[]>(glyph.anchors)
  const [active, setActive] = useState<number | null>(null)
  const [showGhosts, setShowGhosts] = useState(true)
  const [ghostChoice, setGhostChoice] = useState<Record<string, string>>({})
  const groupRef = useRef<SVGGElement>(null)
  const drag = useRef<{
    index: number
    moved: boolean
    /** 'mark': the mark is dragged over a fixed letter (its anchor moves the opposite way) */
    mode: 'anchor' | 'mark'
    start: { x: number; y: number }
    origin: Anchor
  } | null>(null)
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

  const onPointerDown = (index: number, mode: 'anchor' | 'mark' = 'anchor') => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { index, moved: false, mode, start: toFont(e), origin: anchors[index] }
    setActive(index)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toFont(e)
    d.moved = true
    const moved = d.mode === 'mark'
      // the mark follows the pointer, so its attachment anchor moves the other way
      ? { x: d.origin.x - (p.x - d.start.x), y: d.origin.y - (p.y - d.start.y) }
      : { x: p.x - viewOffset.x, y: p.y - viewOffset.y }
    setAnchors((prev) => prev.map((a, j) => (j === d.index ? { ...a, ...moved } : a)))
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
      const sign = attach && active === attach.index ? -1 : 1 // arrows move the mark, not its anchor
      const next = anchors.map((a, j) => (j === active ? { ...a, x: a.x + sign * d[0], y: a.y + sign * d[1] } : a))
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

  // Companions: marks hanging off this base's anchors, or letters a mark can sit on.
  const ghosts: { key: string; glyph: Glyph; dx: number; dy: number }[] = []
  const companions: { anchor: string; options: Glyph[]; chosen: Glyph | undefined }[] = []
  // A mark shown on a letter is drawn in the letter's space: the letter stays
  // put and the mark (with its anchors) is offset onto the letter's anchor.
  let attach: { index: number; base: Glyph; offset: { x: number; y: number } } | null = null
  for (const [i, a] of anchors.entries()) {
    const options = isMark
      ? a.name.startsWith('_') ? basesFor(project, a.name) : []
      : a.name.startsWith('_') ? [] : marksFor(project, a.name)
    if (options.length === 0) continue
    const chosen = options.find((g) => g.name === ghostChoice[a.name]) ?? options[0]
    companions.push({ anchor: a.name, options, chosen })
    if (!showGhosts || !chosen) continue
    const partnerName = isMark ? a.name.slice(1) : `_${a.name}`
    const pa = chosen.anchors.find((p) => p.name === partnerName)
    if (!pa) continue
    if (isMark) {
      if (!attach) attach = { index: i, base: chosen, offset: { x: pa.x - a.x, y: pa.y - a.y } }
    } else {
      ghosts.push({ key: a.name, glyph: chosen, dx: a.x - pa.x, dy: a.y - pa.y })
    }
  }
  const viewOffset = attach ? attach.offset : { x: 0, y: 0 }
  const shown = (a: Anchor) => ({ x: a.x + viewOffset.x, y: a.y + viewOffset.y })

  // Frame the letter (in attached view) or the glyph itself. Doesn't depend on
  // anchors, so the view holds still while dragging.
  const frame = attach ? attach.base : glyph
  const [fx0, fy0, fx1, fy1] = frame.bounds ?? [0, 0, frame.width, 0]
  const x0 = Math.min(0, fx0, attach ? 0 : bx0) - PAD
  const x1 = Math.max(frame.width, fx1, attach ? 0 : bx1, x0 + PAD + 200) + PAD
  const yTop = Math.max(info.ascender, fy1, attach ? 0 : by1) + PAD
  const yBottom = Math.min(info.descender, fy0, attach ? 0 : by0) - PAD

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

  // A mark attaches through exactly one anchor (_top, _bottom, ...); offer the
  // choice only while it has none. Stacking anchors (…mkmk) go in "custom".
  const attached = anchors.some((a) => a.name.startsWith('_') && !a.name.endsWith('mkmk'))
  const suggestions = isMark && attached ? [] : STANDARD_ANCHORS.map((n) => (isMark ? `_${n}` : n)).filter(
    (n) => !anchors.some((a) => a.name === n),
  )

  const deleteGlyph = async () => {
    const pairs = project.kerning.filter((k) => k.first === glyph.name || k.second === glyph.name).length
    const groups = Object.values(project.kernGroups).flatMap((side) => Object.values(side))
      .filter((members) => members.includes(glyph.name)).length
    const rules = project.ligatures.filter((r) => r.glyph === glyph.name || r.components.includes(glyph.name)).length
    const extras = [
      pairs && `${pairs} kerning pair${pairs === 1 ? '' : 's'}`,
      groups && `${groups} kerning group membership${groups === 1 ? '' : 's'}`,
      rules && `${rules} ligature rule${rules === 1 ? '' : 's'}`,
    ].filter(Boolean)
    const ok = await confirm({
      title: `Delete ${glyph.char ? glyph.char + ' ' : ''}${glyph.name}?`,
      body: (
        <>
          {glyph.source && !glyph.sourceMissing && <p>Its file <code>{glyph.source}</code> is deleted too.</p>}
          {extras.length > 0 && <p>This also removes {extras.join(', ')}.</p>}
          <p>A snapshot is taken first, so it can be restored from the Project tab.</p>
        </>
      ),
      confirmLabel: 'Delete glyph',
      danger: true,
    })
    if (!ok) return
    try {
      const res = await api.deleteGlyph(glyph.name)
      onProject?.(res.project)
      onOpenGlyph?.(null)
      onMessage?.(`Deleted ${glyph.name}`)
    } catch (e) {
      onError(String(e))
    }
  }

  const inFont = new Set(project.glyphs.flatMap((g) => (g.unicode === null ? [] : [g.unicode])))
  const duplicateAs = async (cp: number) => {
    const nameOf = (u: number | null) => project.niqqud.find((n) => n.unicode === u)?.name
    try {
      const res = await api.duplicateGlyph(glyph.name, cp)
      onMessage?.(`Made ${nameOf(cp) ?? res.name} from ${nameOf(glyph.unicode) ?? glyph.name}. Drag it into place on a letter.`)
      onChanged()
      onOpenGlyph?.(res.name)
    } catch (e) {
      onError(String(e))
    }
  }

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
            <rect className="advance" x={0} y={info.descender} width={frame.width}
              height={info.ascender - info.descender} />
            {ghosts.map((g) => (
              <path key={g.key} className="ghost" d={g.glyph.path} transform={`translate(${g.dx},${g.dy})`} />
            ))}
            {attach && <path className="ghost base-ghost" d={attach.base.path} />}
            <path className={`outline${attach ? ' draggable' : ''}`} d={glyph.path}
              transform={`translate(${viewOffset.x},${viewOffset.y})`}
              onPointerDown={attach ? onPointerDown(attach.index, 'mark') : undefined} />
            {anchors.map((a, i) => (
              <g key={i} className={`anchor${i === active ? ' active' : ''}${a.name.startsWith('_') ? ' mark-anchor' : ''}`}
                transform={`translate(${shown(a).x},${shown(a).y})`}
                onPointerDown={onPointerDown(i, attach && i === attach.index ? 'mark' : 'anchor')}>
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
            <text key={i} className={`anchor-label${a.name.startsWith('_') ? ' mark-anchor' : ''}`}
              x={shown(a).x + 26} y={-shown(a).y - 26}>{a.name}</text>
          ))}
        </svg>
      </div>

      <aside className="inspector side-panel light">
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
        <p className="hint">
          {attach
            ? `Drag the mark onto ${attach.base.char || attach.base.name} to place it · arrow keys nudge the mark (Shift ×10)`
            : 'Drag anchors on the canvas · arrow keys nudge (Shift ×10) · Delete removes'}
        </p>

        {!glyph.auto && glyph.name !== '.notdef' && (
          <div className="row glyph-actions">
            <button onClick={() => setReassigning(true)} title="It was named or imported as the wrong character">
              Reassign…
            </button>
            <button className="danger" onClick={() => void deleteGlyph()}>Delete glyph</button>
          </div>
        )}
        {reassigning && (
          <ReassignDialog project={project} glyph={glyph} onCancel={() => setReassigning(false)}
            onDone={(next, newName, renamed) => {
              setReassigning(false)
              onProject?.(next)
              onOpenGlyph?.(newName)
              const moved = Object.entries(renamed).filter(([old]) => old !== glyph.name)
              onMessage?.(`${glyph.name} is now ${newName}` +
                (moved.length ? ` (also ${moved.map(([a, b]) => `${a} → ${b}`).join(', ')})` : ''))
            }} />
        )}

        {isMark && !glyph.auto && (
          <div className="row">
            <label className="muted" htmlFor="duplicate-as">Duplicate as</label>
            <select id="duplicate-as" value="" onChange={(e) => e.target.value && void duplicateAs(Number(e.target.value))}
              title="Make another niqqud mark from this drawing, with its own anchor and SVG">
              <option value="">choose a mark…</option>
              {project.niqqud.filter((n) => n.unicode !== glyph.unicode).map((n) => (
                <option key={n.unicode} value={n.unicode} disabled={inFont.has(n.unicode)}>
                  {'\u25CC' + String.fromCodePoint(n.unicode)}  {n.name}{inFont.has(n.unicode) ? ' (already in the font)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

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
