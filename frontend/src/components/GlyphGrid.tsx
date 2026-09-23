import { useRef, useState } from 'react'
import type { FontInfo, Glyph } from '../api'
import { glyphLabel, sectionOf, type Section } from '../glyphs'

const ORDER: Section[] = ['Letters', 'Marks', 'Alternates & ligatures', 'Other']

interface Props {
  glyphs: Glyph[]
  info: FontInfo
  selected: string | null
  onSelect: (name: string) => void
  onImport: (files: File[]) => void
}

export function GlyphGrid({ glyphs, info, selected, onSelect, onImport }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const svgs = (list: FileList | null) => [...(list ?? [])].filter((f) => f.name.toLowerCase().endsWith('.svg'))

  const sections = new Map<Section, Glyph[]>()
  for (const g of glyphs) {
    const s = sectionOf(g)
    sections.set(s, [...(sections.get(s) ?? []), g])
  }

  return (
    <div
      className={`glyph-grid${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const files = svgs(e.dataTransfer.files)
        if (files.length) onImport(files)
      }}
    >
      <div className="grid-actions">
        <button onClick={() => fileInput.current?.click()} title="Add SVG files to the project (or drop them here)">
          Import SVGs…
        </button>
        <input ref={fileInput} type="file" accept=".svg,image/svg+xml" multiple hidden
          onChange={(e) => {
            const files = svgs(e.target.files)
            e.target.value = ''
            if (files.length) onImport(files)
          }} />
      </div>
      {dragging && <div className="drop-hint">Drop SVGs to import</div>}
      {ORDER.filter((s) => sections.has(s)).map((s) => (
        <section key={s}>
          <h3>
            {s} <span className="count">{sections.get(s)!.length}</span>
          </h3>
          <div className="cells">
            {sections.get(s)!.map((g) => (
              <button
                key={g.name}
                className={`cell${g.name === selected ? ' selected' : ''}${g.auto ? ' auto' : ''}`}
                onClick={() => onSelect(g.name)}
                title={`${g.name}${g.source ? ` — ${g.source}` : ''}`}
              >
                <GlyphThumb glyph={g} info={info} />
                <span className="cell-label">{g.char || glyphLabel(g)}</span>
                {g.warnings.length > 0 && <span className="badge warn" title={g.warnings.join('\n')}>!</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function GlyphThumb({ glyph, info }: { glyph: Glyph; info: FontInfo }) {
  if (glyph.category === 'mark' && glyph.bounds) {
    // Marks are tiny at em scale; frame them on their own bounds.
    const [x0, y0, x1, y1] = glyph.bounds
    const size = Math.max(x1 - x0, y1 - y0, info.unitsPerEm * 0.35)
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    return (
      <svg className="thumb" viewBox={`${cx - size / 2} ${-cy - size / 2} ${size} ${size}`}>
        <path d={glyph.path} transform="scale(1,-1)" />
      </svg>
    )
  }
  const [bx0, , bx1] = glyph.bounds ?? [0, 0, glyph.width, 0]
  const x0 = Math.min(0, bx0)
  const x1 = Math.max(glyph.width, bx1)
  const w = Math.max(x1 - x0, info.unitsPerEm * 0.3)
  const cx = (x0 + x1) / 2
  const h = info.ascender - info.descender
  return (
    <svg className="thumb" viewBox={`${cx - w / 2 - 40} ${-info.ascender} ${w + 80} ${h}`}>
      <path d={glyph.path} transform="scale(1,-1)" />
    </svg>
  )
}
