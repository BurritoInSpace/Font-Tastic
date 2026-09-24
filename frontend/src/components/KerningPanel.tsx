import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Glyph, type Project } from '../api'
import { charsToGlyphs } from '../glyphs'
import {
  defaultGroupName,
  groupKey,
  groupOf,
  membersOf,
  pairKey,
  parseGroupKey,
  resolveKern,
  sideLabel,
  type Side,
} from '../kerning'
import { CommitInput } from './GlyphEditor'

interface Props {
  project: Project
  onChanged: () => void
  onError: (msg: string) => void
}

type Level = 'glyph' | 'group'
type Levels = Record<Side, Level>

export function KerningPanel({ project, onChanged, onError }: Props) {
  const glyphs = project.glyphs.filter((g) => g.category !== 'mark' && !g.name.startsWith('.'))
  const byName = useMemo(() => new Map(project.glyphs.map((g) => [g.name, g])), [project.glyphs])
  const saved = useMemo(
    () => new Map(project.kerning.map((k) => [pairKey(k.first, k.second), k.value])),
    [project.kerning],
  )

  // Start on the first two letters (not space and the like).
  const starters = glyphs.filter((g) => g.niceName).concat(glyphs)
  const [first, setFirst] = useState(() => starters[0]?.name ?? '')
  const [second, setSecond] = useState(() => starters[1]?.name ?? '')
  const [levels, setLevels] = useState<Levels>({ 1: 'group', 2: 'group' })
  const [typed, setTyped] = useState('')
  const [context, setContext] = useState('')
  const [value, setValue] = useState(0)
  // One debounce timer per pair, so switching pairs never drops a pending save.
  const saveTimers = useRef(new Map<string, number>())
  // Set when a row in the pair list is clicked, so its level is shown rather than the most specific one.
  const requestedLevels = useRef<Levels | null>(null)

  const g1 = groupOf(project, 1, first)
  const g2 = groupOf(project, 2, second)
  const k1 = levels[1] === 'group' && g1 ? groupKey(1, g1) : first
  const k2 = levels[2] === 'group' && g2 ? groupKey(2, g2) : second
  const editKey = pairKey(k1, k2)

  // Picking a pair shows whichever stored pair currently decides its value;
  // with none, it starts at group level when the glyphs have groups.
  useEffect(() => {
    if (requestedLevels.current) {
      setLevels(requestedLevels.current)
      requestedLevels.current = null
      return
    }
    const r = resolveKern(project, saved, first, second)
    setLevels(
      r.source
        ? { 1: r.source[0] === first ? 'glyph' : 'group', 2: r.source[1] === second ? 'glyph' : 'group' }
        : { 1: 'group', 2: 'group' },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, second])

  // Load the stored value when the edited pair changes (not on every save, or
  // a slow round trip would overwrite clicks made in the meantime).
  useEffect(() => {
    setValue(saved.get(editKey) ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editKey])

  const commit = (v: number) => {
    const key = editKey
    const [a, b] = [k1, k2]
    window.clearTimeout(saveTimers.current.get(key))
    saveTimers.current.set(key, window.setTimeout(async () => {
      saveTimers.current.delete(key)
      try {
        await api.setKern(a, b, v)
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

  const newGroupFrom = async (side: Side, glyph: string) => {
    const g = byName.get(glyph)
    if (!g) return
    try {
      await api.setKernGroup(side, defaultGroupName(project, side, g), [glyph])
      setLevels((l) => ({ ...l, [side]: 'group' }))
      onChanged()
    } catch (e) {
      onError(String(e))
    }
  }

  // The table as it is while editing (unsaved value included), for drawing.
  const live = useMemo(() => {
    const t = new Map(saved)
    if (value === 0) t.delete(editKey)
    else t.set(editKey, value)
    return t
  }, [saved, editKey, value])

  const ctx = charsToGlyphs(project, context) ?? []
  const sequence = [...ctx, first, second, ...ctx].map((n) => byName.get(n)).filter((g): g is Glyph => !!g)
  const kernOf = (a: string, b: string) => resolveKern(project, live, a, b).value

  const covers = membersOf(project, k1).length * membersOf(project, k2).length
  // Which stored pair actually decides this letter pair, if not the one being edited:
  // a more specific one overrides the edit; a more general one applies until the edit gets a value.
  const decider = resolveKern(project, live, first, second)
  const other = decider.source && pairKey(...decider.source) !== editKey ? decider.source : null
  const otherIsMoreSpecific =
    other !== null && specificity({ first: other[0], second: other[1] }) > specificity({ first: k1, second: k2 })

  const openPair = (a: string, b: string) => {
    requestedLevels.current = { 1: parseGroupKey(a) ? 'group' : 'glyph', 2: parseGroupKey(b) ? 'group' : 'glyph' }
    const fa = membersOf(project, a)[0]
    const fb = membersOf(project, b)[0]
    if (!fa || !fb) return onError('That group is empty; add letters to it first')
    setTyped('')
    if (fa === first && fb === second) {
      setLevels(requestedLevels.current)
      requestedLevels.current = null
    } else {
      setFirst(fa)
      setSecond(fb)
    }
  }

  const sortedPairs = [...project.kerning].sort((a, b) => specificity(a) - specificity(b) ||
    a.first.localeCompare(b.first) || a.second.localeCompare(b.second))

  return (
    <div className="panel kerning">
      <h2>Kerning</h2>
      <p className="muted">
        Type a pair the way you write it. For <span dir="rtl">בת</span> the first letter is bet, on the right.
        Negative values pull the pair together. Kern whole groups of similar letters at once, then add exceptions
        for single pairs that need their own value.
      </p>

      <div className="row pair-picker" dir="rtl">
        <input className="pair-input" dir="rtl" value={typed} placeholder="בת" maxLength={4}
          onChange={(e) => pickTyped(e.target.value)} />
        <SideControl label="Right-hand letter" side={1} glyphs={glyphs} glyph={first} group={g1} level={levels[1]}
          onGlyph={setFirst} onLevel={(l) => setLevels({ ...levels, 1: l })} onNewGroup={() => void newGroupFrom(1, first)} />
        <span className="muted">+</span>
        <SideControl label="Left-hand letter" side={2} glyphs={glyphs} glyph={second} group={g2} level={levels[2]}
          onGlyph={setSecond} onLevel={(l) => setLevels({ ...levels, 2: l })} onNewGroup={() => void newGroupFrom(2, second)} />
        <span className="spacer" />
        <input dir="auto" value={context} placeholder="context letters" onChange={(e) => setContext(e.target.value)} />
      </div>

      <PairView project={project} sequence={sequence} kernOf={kernOf} firstIndex={ctx.length} />

      <div className="kern-caption">
        Editing <strong dir="ltr">{sideLabel(byName, k1)} + {sideLabel(byName, k2)}</strong>
        {covers > 1 ? <span className="muted"> · applies to {covers} letter pairs</span>
          : k1 === first && k2 === second && (g1 || g2) ? <span className="muted"> · an exception for just this pair</span>
          : null}
        {other && (
          <div className={`small ${otherIsMoreSpecific ? 'warn-text' : 'muted'}`}>
            {otherIsMoreSpecific ? 'These letters have their own value' : 'Right now these letters get'} ({decider.value}) from{' '}
            <button className="link" onClick={() => openPair(other[0], other[1])}>
              {sideLabel(byName, other[0])} + {sideLabel(byName, other[1])}
            </button>
            {otherIsMoreSpecific ? ", which overrides what you're editing here." : '; a value here overrides it.'}
          </div>
        )}
      </div>

      <div className="row kern-controls">
        <button onClick={() => change(value - 10)} title="Tighter by 10">−10</button>
        <button onClick={() => change(value - 1)} title="Tighter by 1">−1</button>
        <input type="range" min={-400} max={200} value={value} onChange={(e) => change(Number(e.target.value))} />
        <button onClick={() => change(value + 1)} title="Looser by 1">+1</button>
        <button onClick={() => change(value + 10)} title="Looser by 10">+10</button>
        <CommitInput value={String(value)} numeric onCommit={(v) => change(Math.round(Number(v)))} />
        <button disabled={value === 0 && !saved.has(editKey)} onClick={() => change(0)}>Remove</button>
      </div>

      <h4>Pairs <span className="muted">{project.kerning.length}</span></h4>
      {project.kerning.length === 0 ? (
        <p className="muted small">No kerning yet.</p>
      ) : (
        <table className="rules kern-list">
          <tbody>
            {sortedPairs.map((k) => (
              <tr key={pairKey(k.first, k.second)} className={pairKey(k.first, k.second) === editKey ? 'active' : ''}
                onClick={() => openPair(k.first, k.second)}>
                <td className="seq" dir="rtl">
                  <SideChip byName={byName} k={k.first} /> <SideChip byName={byName} k={k.second} />
                </td>
                <td className="muted small">
                  {specificity(k) === 3 ? 'exception' : `${membersOf(project, k.first).length * membersOf(project, k.second).length} pairs`}
                </td>
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

      <KernGroups project={project} glyphs={glyphs} byName={byName} onChanged={onChanged} onError={onError} />
    </div>
  )
}

/** 0 = group+group, 1–2 = mixed, 3 = glyph+glyph (an exception). */
function specificity(k: { first: string; second: string }) {
  return (parseGroupKey(k.first) ? 0 : 2) + (parseGroupKey(k.second) ? 0 : 1)
}

function SideChip({ byName, k }: { byName: Map<string, Glyph>; k: string }) {
  const isGroup = !!parseGroupKey(k)
  return <span className={isGroup ? 'group-chip' : 'glyph-chip'} dir="ltr">{sideLabel(byName, k)}</span>
}

function SideControl({ label, side, glyphs, glyph, group, level, onGlyph, onLevel, onNewGroup }: {
  label: string
  side: Side
  glyphs: Glyph[]
  glyph: string
  group: string | null
  level: Level
  onGlyph: (g: string) => void
  onLevel: (l: Level) => void
  onNewGroup: () => void
}) {
  return (
    <div className="side-control" dir="ltr" title={`${label} (kerning side ${side})`}>
      <select value={glyph} onChange={(e) => onGlyph(e.target.value)}>
        {glyphs.map((g) => (
          <option key={g.name} value={g.name}>{g.char ? `${g.char}  ${g.name}` : g.name}</option>
        ))}
      </select>
      {group ? (
        <div className="segmented">
          <button className={level === 'glyph' ? 'active' : ''} onClick={() => onLevel('glyph')}>letter</button>
          <button className={level === 'group' ? 'active' : ''} onClick={() => onLevel('group')}>@{group}</button>
        </div>
      ) : (
        <button className="link" onClick={onNewGroup}>+ group</button>
      )}
    </div>
  )
}

const SIDE_INFO: Record<Side, { title: string; hint: string }> = {
  1: {
    title: 'Right-hand letter groups',
    hint: 'Letters whose left edge looks alike: the edge that faces the next letter.',
  },
  2: {
    title: 'Left-hand letter groups',
    hint: 'Letters whose right edge looks alike: the edge that faces the previous letter.',
  },
}

function KernGroups({ project, glyphs, byName, onChanged, onError }: {
  project: Project
  glyphs: Glyph[]
  byName: Map<string, Glyph>
  onChanged: () => void
  onError: (msg: string) => void
}) {
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      onChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <h4>Groups</h4>
      <p className="muted small">
        A letter can be in one group of each kind. Adding it to a group moves it out of any other group of that kind.
      </p>
      <div className="group-columns">
        {([1, 2] as Side[]).map((side) => {
          const groups = Object.entries(project.kernGroups[`${side}`])
          return (
            <section key={side} className="group-column">
              <h5>{SIDE_INFO[side].title}</h5>
              <p className="muted small">{SIDE_INFO[side].hint}</p>
              {groups.length === 0 && <p className="muted small">None yet.</p>}
              {groups.map(([name, members]) => {
                const key = groupKey(side, name)
                const uses = project.kerning.filter((k) => k.first === key || k.second === key).length
                return (
                  <div key={name} className="group-card">
                    <div className="row">
                      <span className="group-at">@</span>
                      <CommitInput value={name} onCommit={(v) => void run(() => api.setKernGroup(side, v.trim(), members, name))} />
                      <span className="muted small">{uses} pair{uses === 1 ? '' : 's'}</span>
                      <span className="spacer" />
                      <button className="icon" title="Delete group" onClick={() => {
                        if (uses && !window.confirm(`Delete @${name}? Its ${uses} kerning pair${uses === 1 ? '' : 's'} will be removed too (a snapshot is taken first).`)) return
                        void run(() => api.deleteKernGroup(side, name))
                      }}>×</button>
                    </div>
                    <div className="members" dir="rtl">
                      {members.map((m) => (
                        <span key={m} className="member" title={m}>
                          {byName.get(m)?.char || m}
                          <button className="icon" title={`Remove ${m}`}
                            onClick={() => void run(() => api.setKernGroup(side, name, members.filter((x) => x !== m)))}>×</button>
                        </span>
                      ))}
                      <AddLetters project={project} onAdd={(names) => void run(() => api.setKernGroup(side, name, [...members, ...names]))}
                        onError={onError} />
                    </div>
                  </div>
                )
              })}
              <NewGroup glyphs={glyphs} onCreate={(name, members) => void run(() => api.setKernGroup(side, name, members))} />
            </section>
          )
        })}
      </div>
    </>
  )
}

function AddLetters({ project, onAdd, onError }: { project: Project; onAdd: (names: string[]) => void; onError: (m: string) => void }) {
  const [text, setText] = useState('')
  const add = () => {
    if (!text.trim()) return
    const names = charsToGlyphs(project, text)
    if (!names) return onError('Some of those letters are not in the font')
    onAdd(names)
    setText('')
  }
  return (
    <input className="add-letters" dir="rtl" value={text} placeholder="+ letters" onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && add()} onBlur={add} />
  )
}

function NewGroup({ glyphs, onCreate }: { glyphs: Glyph[]; onCreate: (name: string, members: string[]) => void }) {
  const [name, setName] = useState('')
  const [letters, setLetters] = useState('')
  const cmap = new Map(glyphs.filter((g) => g.unicode !== null).map((g) => [g.unicode!, g.name]))
  const members = [...letters].map((ch) => cmap.get(ch.codePointAt(0)!)).filter((n): n is string => !!n)
  return (
    <form className="row new-group" onSubmit={(e) => {
      e.preventDefault()
      if (!name.trim()) return
      onCreate(name.trim(), members)
      setName('')
      setLetters('')
    }}>
      <input value={name} placeholder="new group name" onChange={(e) => setName(e.target.value)} />
      <input dir="rtl" className="add-letters" value={letters} placeholder="letters" onChange={(e) => setLetters(e.target.value)} />
      <button type="submit" disabled={!name.trim()}>Add</button>
    </form>
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
