import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Project } from '../api'
import { charsToGlyphs, sectionOf, sectionRank } from '../glyphs'

export type BulkAction = 'accents' | 'sidebearings' | 'anchors' | 'match' | 'reimport'

interface MenuProps {
  project: Project
  logo: string
  onAction: (action: BulkAction) => void
}

/** The top-left logo: a menu of actions that work on many glyphs at once, by category. */
export function ActionsMenu({ project, logo, onAction }: MenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const multi = project.weights.length > 1
  const latin = project.scripts.some((s) => s.direction === 'ltr')
  const groups: { title: string; items: { action: BulkAction; label: string; hint: string; disabled?: string }[] }[] = [
    {
      title: 'Spacing',
      items: [{ action: 'sidebearings', label: 'Set side bearings…', hint: 'Same left and/or right side bearing for many glyphs' }],
    },
    {
      title: 'Anchors',
      items: [{ action: 'anchors', label: 'Line up anchors…', hint: 'Move one anchor to the same height (or centre) in many glyphs' }],
    },
    {
      title: 'Point order',
      items: [{
        action: 'match', label: 'Match every master to the default',
        hint: 'Fix contour order, direction and start points wherever the compatibility check can',
        disabled: multi ? undefined : 'Needs two or more masters',
      }],
    },
    {
      title: 'Glyphs',
      items: [
        {
          action: 'accents', label: 'Build accented letters…', hint: 'é, ü, ñ… from the letters and accents you drew',
          disabled: latin ? undefined : 'Needs Latin, Greek or Cyrillic letters',
        },
        { action: 'reimport', label: 'Re-read every SVG', hint: 'Import all SVGs again, in every master' },
      ],
    },
  ]

  return (
    <div className="actions-menu" ref={ref}>
      <button className="logo-button" onClick={() => setOpen(!open)} title="Actions for many glyphs at once"
        aria-haspopup="menu" aria-expanded={open}>
        <img className="topbar-logo" src={logo} alt="Font-tastic" />
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          {groups.map((g) => (
            <div key={g.title} className="menu-group">
              <div className="menu-title">{g.title}</div>
              {g.items.map((item) => (
                <button key={item.action} role="menuitem" disabled={!!item.disabled} title={item.disabled ?? item.hint}
                  onClick={() => { setOpen(false); onAction(item.action) }}>
                  <span>{item.label}</span>
                  <span className="menu-hint">{item.disabled ?? item.hint}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Which glyphs a bulk action applies to: a glyph panel section, everything, or letters typed in. */
function GlyphScope({ project, value, onChange, extra }: {
  project: Project
  value: string[]
  onChange: (names: string[]) => void
  /** an extra first option, e.g. "Every glyph with this anchor" */
  extra?: { label: string; names: string[] }
}) {
  const sections = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const g of project.glyphs) {
      if (g.name === '.notdef') continue
      const s = sectionOf(g)
      m.set(s, [...(m.get(s) ?? []), g.name])
    }
    return [...m].sort(([a], [b]) => {
      const [ra, na] = sectionRank(a)
      const [rb, nb] = sectionRank(b)
      return ra - rb || na.localeCompare(nb)
    })
  }, [project])
  const [choice, setChoice] = useState(extra ? 'extra' : sections[0]?.[0] ?? 'typed')
  const [typed, setTyped] = useState('')

  const resolve = (c: string, text: string): string[] => {
    if (c === 'extra') return extra?.names ?? []
    if (c === 'all') return project.glyphs.filter((g) => g.name !== '.notdef').map((g) => g.name)
    if (c === 'typed') return charsToGlyphs(project, text.replace(/\s/g, '')) ?? []
    return sections.find(([s]) => s === c)?.[1] ?? []
  }
  useEffect(() => {
    onChange(resolve(choice, typed))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, typed, extra?.names.join(',')])

  const unknown = choice === 'typed' && typed.trim() && charsToGlyphs(project, typed.replace(/\s/g, '')) === null
  return (
    <div className="scope">
      <label>
        <span>Glyphs</span>
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          {extra && <option value="extra">{extra.label} ({extra.names.length})</option>}
          {sections.map(([s, names]) => <option key={s} value={s}>{s} ({names.length})</option>)}
          <option value="all">Every glyph ({project.glyphs.length - 1})</option>
          <option value="typed">Letters I type…</option>
        </select>
      </label>
      {choice === 'typed' && (
        <input dir="auto" value={typed} placeholder="e.g. בגדה or HIMN" onChange={(e) => setTyped(e.target.value)} />
      )}
      <span className="muted small">{unknown ? 'Some of those letters aren\'t in the font' : `${value.length} glyphs`}</span>
    </div>
  )
}

function Dialog({ title, intro, children, busy, canApply, onCancel, onApply }: {
  title: string
  intro: string
  children: React.ReactNode
  busy: boolean
  canApply: boolean
  onCancel: () => void
  onApply: () => void
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal bulk-dialog" role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <span className="muted small">{intro}</span>
        </header>
        <div className="bulk-body">{children}</div>
        <footer>
          <span className="muted small">A snapshot is taken first, so this can be undone from the Project tab.</span>
          <span className="spacer" />
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="primary" disabled={!canApply || busy} onClick={onApply}>{busy ? 'Working…' : 'Apply'}</button>
        </footer>
      </div>
    </div>
  )
}

const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? undefined : Math.round(Number(s)))

interface DialogProps {
  project: Project
  onCancel: () => void
  onDone: (project: Project, message: string) => void
  onError: (msg: string) => void
}

export function SideBearingsDialog({ project, onCancel, onDone, onError }: DialogProps) {
  const [names, setNames] = useState<string[]>([])
  const [lsb, setLsb] = useState('')
  const [rsb, setRsb] = useState('')
  const [allMasters, setAllMasters] = useState(false)
  const [busy, setBusy] = useState(false)
  const apply = async () => {
    setBusy(true)
    try {
      const res = await api.bulkMetrics({ glyphs: names, lsb: num(lsb), rsb: num(rsb), allMasters })
      const skipped = Object.keys(res.skipped).length
      onDone(res.project, `Set side bearings of ${res.changed.length} glyph${res.changed.length === 1 ? '' : 's'}` +
        (skipped ? ` (skipped ${skipped}: marks, built or empty glyphs, or no SVG)` : ''))
    } catch (e) {
      onError(String(e))
      setBusy(false)
    }
  }
  return (
    <Dialog title="Set side bearings" busy={busy} onCancel={onCancel} onApply={() => void apply()}
      canApply={names.length > 0 && (num(lsb) !== undefined || num(rsb) !== undefined)}
      intro="Moves the artboard edges in each glyph's SVG, as the side bearing fields do. Leave a side empty to keep it.">
      <GlyphScope project={project} value={names} onChange={setNames} />
      <div className="row">
        <label className="field"><span>Left side bearing</span>
          <input className="num" value={lsb} placeholder="keep" onChange={(e) => setLsb(e.target.value)} /></label>
        <label className="field"><span>Right side bearing</span>
          <input className="num" value={rsb} placeholder="keep" onChange={(e) => setRsb(e.target.value)} /></label>
      </div>
      {project.weights.length > 1 && (
        <label className="check">
          <input type="checkbox" checked={allMasters} onChange={(e) => setAllMasters(e.target.checked)} />
          In every master (otherwise just {project.weight})
        </label>
      )}
    </Dialog>
  )
}

export function AnchorsDialog({ project, onCancel, onDone, onError }: DialogProps) {
  // Anchor names in use, most common first, with each one's usual height.
  const anchors = useMemo(() => {
    const m = new Map<string, { names: string[]; ys: number[] }>()
    for (const g of project.glyphs) {
      for (const a of g.anchors) {
        const e = m.get(a.name) ?? { names: [], ys: [] }
        e.names.push(g.name)
        e.ys.push(a.y)
        m.set(a.name, e)
      }
    }
    return [...m].sort((a, b) => b[1].names.length - a[1].names.length)
  }, [project])
  const [anchor, setAnchor] = useState(anchors[0]?.[0] ?? '')
  const current = anchors.find(([n]) => n === anchor)?.[1]
  const usualY = useMemo(() => {
    if (!current) return ''
    const counts = new Map<number, number>()
    for (const y of current.ys) counts.set(y, (counts.get(y) ?? 0) + 1)
    return String([...counts].sort((a, b) => b[1] - a[1])[0][0])
  }, [current])
  const [names, setNames] = useState<string[]>([])
  const [xMode, setXMode] = useState<'keep' | 'center' | 'value'>('keep')
  const [x, setX] = useState('')
  const [y, setY] = useState('')
  useEffect(() => setY(usualY), [usualY])
  const [allMasters, setAllMasters] = useState(false)
  const [busy, setBusy] = useState(false)

  const xValue = xMode === 'center' ? 'center' : xMode === 'value' ? num(x) : undefined
  const apply = async () => {
    setBusy(true)
    try {
      const res = await api.bulkAnchors({ anchor, glyphs: names, x: xValue, y: num(y), allMasters })
      onDone(res.project, `Moved the ${anchor} anchor in ${res.changed.length} glyph${res.changed.length === 1 ? '' : 's'}`)
    } catch (e) {
      onError(String(e))
      setBusy(false)
    }
  }
  return (
    <Dialog title="Line up anchors" busy={busy} onCancel={onCancel} onApply={() => void apply()}
      canApply={!!anchor && names.length > 0 && (xValue !== undefined || num(y) !== undefined)}
      intro="Put one anchor at the same height in many glyphs, e.g. every _bottom mark, and optionally centre it on each drawing.">
      <label className="field"><span>Anchor</span>
        <select value={anchor} onChange={(e) => setAnchor(e.target.value)}>
          {anchors.map(([n, e]) => <option key={n} value={n}>{n} ({e.names.length})</option>)}
        </select>
      </label>
      <GlyphScope project={project} value={names} onChange={setNames}
        extra={current ? { label: `Every glyph with ${anchor}`, names: current.names } : undefined} />
      <div className="row">
        <label className="field"><span>Height (y)</span>
          <input className="num" value={y} placeholder="keep" onChange={(e) => setY(e.target.value)} /></label>
        <label className="field"><span>Across (x)</span>
          <select value={xMode} onChange={(e) => setXMode(e.target.value as typeof xMode)}>
            <option value="keep">keep</option>
            <option value="center">centre on the drawing</option>
            <option value="value">set to…</option>
          </select>
        </label>
        {xMode === 'value' && (
          <label className="field"><span>x</span>
            <input className="num" value={x} onChange={(e) => setX(e.target.value)} /></label>
        )}
      </div>
      {project.weights.length > 1 && (
        <label className="check">
          <input type="checkbox" checked={allMasters} onChange={(e) => setAllMasters(e.target.checked)} />
          In every master (otherwise just {project.weight})
        </label>
      )}
    </Dialog>
  )
}
