import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Project } from '../api'
import { ShapingFont } from '../shaping'

interface Props {
  project: Project
  onSelectGlyph: (name: string) => void
}

const DEFAULT_TEXT = 'שָׁלוֹם בַּת אל\nנָמַל הֹם תְּ'
const DEFAULT_HEIGHT = 170
const MIN_HEIGHT = 70

/**
 * The live preview: a dark strip with the text shaped by HarfBuzz from the
 * compiled font (drag its top edge to resize), and a light controls bar with
 * the text, the size slider and feature toggles.
 */
export function Preview({ project, onSelectGlyph }: Props) {
  const [font, setFont] = useState<ShapingFont | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState(() => project.settings.previewText ?? DEFAULT_TEXT)
  const [size, setSize] = useState(72)
  const [boxes, setBoxes] = useState(false)
  const [features, setFeatures] = useState<Record<string, boolean>>({})
  const [height, setHeight] = useState(() => project.settings.previewHeight ?? DEFAULT_HEIGHT)
  const [resizing, setResizing] = useState(false)

  // Recompile/reload whenever the project changes.
  useEffect(() => {
    let cancelled = false
    api
      .fontBinary()
      .then((data) => {
        if (cancelled) return
        setFont(new ShapingFont(data))
        setError(null)
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
    return () => {
      cancelled = true
    }
  }, [project.revision, project.root])

  // The preview text and height belong to the project (saved in its .fonttastic file).
  const saved = useRef(project.settings.previewText)
  useEffect(() => {
    setText(project.settings.previewText ?? DEFAULT_TEXT)
    setHeight(project.settings.previewHeight ?? DEFAULT_HEIGHT)
    saved.current = project.settings.previewText
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.file])
  useEffect(() => {
    if (text === (saved.current ?? DEFAULT_TEXT)) return
    const t = window.setTimeout(() => {
      saved.current = text
      api.saveSettings({ previewText: text }).catch(() => {})
    }, 800)
    return () => window.clearTimeout(t)
  }, [text])

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height
    const max = Math.round(window.innerHeight * 0.7)
    let latest = startHeight
    setResizing(true)
    const move = (ev: PointerEvent) => {
      latest = Math.min(max, Math.max(MIN_HEIGHT, startHeight + (startY - ev.clientY)))
      setHeight(latest)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setResizing(false)
      if (latest !== startHeight) api.saveSettings({ previewHeight: latest }).catch(() => {})
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const toggles = useMemo(() => {
    const tags = new Set<string>(['kern', 'mark', 'liga'])
    for (const r of project.ligatures) tags.add(r.feature)
    for (const g of project.glyphs) {
      const suffix = g.name.split('.')[1]
      if (suffix && /^(salt|ss\d\d)$/.test(suffix)) tags.add(suffix)
    }
    return [...tags]
  }, [project])

  const isOn = (tag: string) => features[tag] ?? ['kern', 'mark', 'liga'].includes(tag)

  const lines = useMemo(() => {
    if (!font) return []
    const feats = Object.fromEntries(toggles.map((t) => [t, isOn(t)]))
    return text.split('\n').map((line) => font.shape(line, feats))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, text, features, toggles])

  const { ascender, descender, unitsPerEm } = project.info
  const lineHeight = ascender - descender

  return (
    <div className="preview">
      <div className="preview-area" style={{ height }}>
        <div className={`preview-resize${resizing ? ' dragging' : ''}`} onPointerDown={startResize}
          title="Drag to resize the preview" />
        {error ? (
          <div className="compile-error"><strong>Compile failed:</strong> {error}</div>
        ) : (
          <div className="preview-lines">
            {lines.map((run, li) => (
              <svg
                key={li}
                className="line"
                width={((run.width + 40) * size) / unitsPerEm}
                height={(lineHeight * size) / unitsPerEm}
                viewBox={`-20 ${-ascender} ${run.width + 40} ${lineHeight}`}
              >
                {run.glyphs.map((g, i) => (
                  <g key={i} transform={`translate(${g.x},${-g.y})`} onClick={() => onSelectGlyph(g.name)} className="shaped">
                    {boxes && g.advance > 0 && (
                      <rect className="glyph-box" x={0} y={-ascender} width={g.advance} height={lineHeight} />
                    )}
                    <path d={g.path} transform="scale(1,-1)">
                      <title>{g.name}</title>
                    </path>
                  </g>
                ))}
              </svg>
            ))}
          </div>
        )}
      </div>

      <div className="preview-bar light">
        <textarea dir="rtl" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
          aria-label="Preview text" />
        <div className="preview-options">
          <input type="range" min={24} max={260} value={size} onChange={(e) => setSize(Number(e.target.value))}
            title={`Text size: ${size}px`} aria-label="Preview text size" />
          <div className="toggles">
            {toggles.map((t) => (
              <button key={t} className={`toggle ${isOn(t) ? 'on' : 'off'}`} aria-pressed={isOn(t)}
                onClick={() => setFeatures({ ...features, [t]: !isOn(t) })} title={`OpenType feature ${t}`}>
                {t}
              </button>
            ))}
            <button className={`toggle ${boxes ? 'on' : 'off'}`} aria-pressed={boxes} onClick={() => setBoxes(!boxes)}
              title="Show each glyph's advance box">
              boxes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
