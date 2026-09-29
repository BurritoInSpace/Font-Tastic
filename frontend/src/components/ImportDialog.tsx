import { useState } from 'react'
import { api, type FontInfo, type Project, type UploadAnalysis } from '../api'
import {
  ALTERNATE_FEATURES,
  LIGATURE_FEATURES,
  initialDecision,
  plan,
  type Decision,
  type Planned,
} from '../importPlan'

export interface Upload {
  analysis: UploadAnalysis
  data: string // base64
}

interface Props {
  project: Project
  uploads: Upload[]
  onCancel: () => void
  onDone: (project: Project, added: string[], errors: Record<string, string>) => void
}

export function ImportDialog({ project, uploads, onCancel, onDone }: Props) {
  const [decisions, setDecisions] = useState<Decision[]>(() => uploads.map((u) => initialDecision(u.analysis)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const planned = plan(project, uploads.map((u) => u.analysis), decisions)
  const toImport = planned.filter((p) => p.resolution.kind === 'add' || p.resolution.kind === 'replace')
  const pending = planned.filter((p) => p.resolution.kind === 'incomplete').length

  const update = (i: number, patch: Partial<Decision>) =>
    setDecisions((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)))

  // Bulk answers, for imports with many files.
  const [onlyPending, setOnlyPending] = useState(false)
  const [bulkFeature, setBulkFeature] = useState('salt')
  const duplicates = planned.filter((p) => p.duplicateOf)
  const replaceable = duplicates.filter((p) => !p.duplicateInBatch).length
  const alternatable = duplicates.filter((p) => p.canAlternate).length
  const unrecognized = uploads
    .map((u, i) => ({ u, d: decisions[i] }))
    .filter(({ u, d }) => u.analysis.status === 'unknown' && d.identity === 'char' && !d.char.trim())
  /** Set the same answer for every file that matches an existing glyph, where it's possible for that file. */
  const answerDuplicates = (choice: 'replace' | 'alternate' | 'skip') =>
    setDecisions((ds) => ds.map((d, i) => {
      const p = planned[i]
      if (!p.duplicateOf) return d
      if (choice === 'replace' && p.duplicateInBatch) return d
      if (choice === 'alternate' && !p.canAlternate) return d
      return { ...d, onDuplicate: choice, dupFeature: choice === 'alternate' ? bulkFeature : d.dupFeature }
    }))
  const skipUnrecognized = () =>
    setDecisions((ds) => ds.map((d, i) =>
      uploads[i].analysis.status === 'unknown' && d.identity === 'char' && !d.char.trim() ? { ...d, identity: 'skip' } : d))

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const files = planned.flatMap((p, i) =>
        p.resolution.kind === 'add' || p.resolution.kind === 'replace'
          ? [{ data: uploads[i].data, glyphName: p.resolution.glyphName, replace: p.resolution.kind === 'replace' }]
          : [],
      )
      const res = await api.addGlyphFiles(files)
      onDone(res.project, res.added, res.errors)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal import-dialog" role="dialog" aria-label="Import SVGs">
        <header>
          <h2>Import {uploads.length === 1 ? '1 SVG' : `${uploads.length} SVGs`}</h2>
          <span className="muted small">Files are copied into the project's glyphs/ folder under their glyph names.</span>
        </header>
        {(duplicates.length > 0 || unrecognized.length > 0 || uploads.length > 6) && (
          <div className="import-bulk">
            {duplicates.length > 0 && (
              <div className="row">
                <span className="muted small">
                  {duplicates.length} file{duplicates.length === 1 ? '' : 's'} match{duplicates.length === 1 ? 'es' : ''} a
                  glyph already in the font:
                </span>
                <button disabled={replaceable === 0} onClick={() => answerDuplicates('replace')}
                  title="Replace every glyph that can be replaced (anchors and spacing are kept; a snapshot is taken)">
                  Replace all{replaceable < duplicates.length ? ` possible (${replaceable})` : ''}
                </button>
                <button disabled={alternatable === 0} onClick={() => answerDuplicates('alternate')}
                  title="Keep the existing glyphs and add these as stylistic alternates">
                  All as alternates
                </button>
                <FeatureSelect options={ALTERNATE_FEATURES} value={bulkFeature} onChange={setBulkFeature} />
                <button onClick={() => answerDuplicates('skip')}>Skip all</button>
              </div>
            )}
            {unrecognized.length > 0 && (
              <div className="row">
                <span className="muted small">
                  {unrecognized.length} file{unrecognized.length === 1 ? '' : 's'} with a name that isn't a glyph:
                </span>
                <button onClick={skipUnrecognized}>Skip all unrecognized</button>
              </div>
            )}
            <label className="check small">
              <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
              Only show files that still need an answer{pending ? ` (${pending})` : ''}
            </label>
          </div>
        )}
        <div className="import-rows">
          {uploads.map((u, i) => onlyPending && planned[i].resolution.kind !== 'incomplete' ? null : (
            <ImportRow key={i} project={project} upload={u} decision={decisions[i]} planned={planned[i]}
              onChange={(patch) => update(i, patch)} />
          ))}
        </div>
        <footer>
          {error && <span className="error small">{error}</span>}
          <span className="muted small">{pending > 0 ? `${pending} still need an answer` : ''}</span>
          <span className="spacer" />
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="primary" disabled={busy || pending > 0 || toImport.length === 0} onClick={() => void submit()}>
            {busy ? 'Importing…' : `Import ${toImport.length}`}
          </button>
        </footer>
      </div>
    </div>
  )
}

function ImportRow({ project, upload, decision: d, planned, onChange }: {
  project: Project
  upload: Upload
  decision: Decision
  planned: Planned
  onChange: (patch: Partial<Decision>) => void
}) {
  const a = upload.analysis
  const byName = new Map(project.glyphs.map((g) => [g.name, g]))
  const r = planned.resolution
  const recognized = a.status === 'new' || a.status === 'duplicate'
  const bases = project.glyphs.filter((g) => !g.name.startsWith('.'))
  const label = (name: string) => `${byName.get(name)?.char ?? ''} ${name}`.trim()

  return (
    <div className={`import-row ${r.kind}`}>
      <Thumb path={a.path} advance={a.advance} info={project.info} />
      <div className="import-body">
        <div className="import-file">
          <strong>{a.filename}</strong>
          {a.warnings?.map((w) => <span key={w} className="warn-text small"> · {w}</span>)}
        </div>

        {a.status === 'invalid' ? (
          <div className="error small">{a.error}</div>
        ) : (
          <>
            {d.identity === 'named' && recognized ? (
              <div className="row">
                <span>Recognized as <strong>{a.glyphName}</strong> {charFor(a.unicode)}</span>
                <button className="link" onClick={() => onChange({ identity: 'char' })}>not right?</button>
              </div>
            ) : (
              <>
                <div className="row">
                  <span className="muted">{recognized ? 'What is it?' : 'Unrecognized name. What is it?'}</span>
                  <div className="segmented">
                    {(['char', 'alternate', 'ligature', 'skip'] as const).map((k) => (
                      <button key={k} className={d.identity === k ? 'active' : ''} onClick={() => onChange({ identity: k })}>
                        {{ char: 'Character', alternate: 'Alternate of…', ligature: 'Ligature', skip: 'Skip' }[k]}
                      </button>
                    ))}
                  </div>
                  {recognized && (
                    <button className="link" onClick={() => onChange({ identity: 'named' })}>use {a.glyphName}</button>
                  )}
                </div>
                {d.identity === 'char' && (
                  <div className="row">
                    <input dir="auto" className="char-input" autoFocus value={d.char} placeholder="א or U+05D0"
                      onChange={(e) => onChange({ char: e.target.value })} />
                  </div>
                )}
                {d.identity === 'alternate' && (
                  <div className="row">
                    <select value={d.base} onChange={(e) => onChange({ base: e.target.value })}>
                      <option value="">Choose a glyph…</option>
                      {bases.map((g) => <option key={g.name} value={g.name}>{label(g.name)}</option>)}
                    </select>
                    <FeatureSelect options={ALTERNATE_FEATURES} value={d.feature} onChange={(feature) => onChange({ feature })} />
                  </div>
                )}
                {d.identity === 'ligature' && (
                  <div className="row">
                    <input dir="auto" className="char-input" value={d.letters} placeholder="אל"
                      onChange={(e) => onChange({ letters: e.target.value })} />
                    <FeatureSelect options={LIGATURE_FEATURES} value={d.ligFeature} onChange={(ligFeature) => onChange({ ligFeature })} />
                  </div>
                )}
              </>
            )}

            {planned.duplicateOf && (
              <div className="duplicate">
                <span>
                  <strong>{label(planned.duplicateOf)}</strong>{' '}
                  {planned.duplicateInBatch ? 'is also in this import.' : 'already exists.'}
                </span>
                <div className="segmented">
                  {!planned.duplicateInBatch && (
                    <button className={d.onDuplicate === 'replace' ? 'active' : ''} onClick={() => onChange({ onDuplicate: 'replace' })}>
                      Replace it
                    </button>
                  )}
                  {planned.canAlternate && (
                    <button className={d.onDuplicate === 'alternate' ? 'active' : ''} onClick={() => onChange({ onDuplicate: 'alternate' })}>
                      Stylistic alternate
                    </button>
                  )}
                  <button className={d.onDuplicate === 'skip' ? 'active' : ''} onClick={() => onChange({ onDuplicate: 'skip' })}>
                    Skip
                  </button>
                </div>
                {d.onDuplicate === 'alternate' && planned.canAlternate && (
                  <FeatureSelect options={ALTERNATE_FEATURES} value={d.dupFeature} onChange={(dupFeature) => onChange({ dupFeature })} />
                )}
              </div>
            )}
          </>
        )}

        <div className={`resolution small ${r.kind}`}>
          {r.kind === 'add' && <>→ <strong>{r.glyphName}</strong> · {r.note}</>}
          {r.kind === 'replace' && <>→ <strong>{r.glyphName}</strong> · {r.note}</>}
          {(r.kind === 'skip' || r.kind === 'incomplete') && r.note}
        </div>
      </div>
    </div>
  )
}

function FeatureSelect({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title="OpenType feature">
      {options.map((f) => <option key={f}>{f}</option>)}
    </select>
  )
}

function charFor(cp: number | null) {
  if (cp === null) return null
  return <span className="big-inline">{String.fromCodePoint(cp)}</span>
}

function Thumb({ path, advance, info }: { path?: string; advance?: number; info: FontInfo }) {
  const w = Math.max(advance ?? info.unitsPerEm, 200)
  return (
    <svg className="import-thumb" viewBox={`-40 ${-info.ascender} ${w + 80} ${info.ascender - info.descender}`}>
      <line x1={-40} x2={w + 40} y1={0} y2={0} />
      {path && <path d={path} transform="scale(1,-1)" />}
    </svg>
  )
}
