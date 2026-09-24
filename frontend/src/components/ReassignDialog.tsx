import { useState } from 'react'
import { api, type Glyph, type Project } from '../api'
import { charsToGlyphs } from '../glyphs'
import { ALTERNATE_FEATURES, LIGATURE_FEATURES, canonicalName, nextAlternateName, parseChar } from '../importPlan'

interface Props {
  project: Project
  glyph: Glyph
  onCancel: () => void
  onDone: (project: Project, newName: string, renamed: Record<string, string>) => void
}

type Identity = 'char' | 'alternate' | 'ligature'

/** "This glyph is actually something else": pick what it should be. */
export function ReassignDialog({ project, glyph, onCancel, onDone }: Props) {
  const [identity, setIdentity] = useState<Identity>('char')
  const [char, setChar] = useState('')
  const [base, setBase] = useState('')
  const [feature, setFeature] = useState('salt')
  const [letters, setLetters] = useState('')
  const [ligFeature, setLigFeature] = useState('liga')
  const [swap, setSwap] = useState(false)
  const [moveAlternates, setMoveAlternates] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const byName = new Map(project.glyphs.map((g) => [g.name, g]))
  const cmap = new Map(project.glyphs.filter((g) => g.unicode !== null).map((g) => [g.unicode!, g.name]))
  const others = new Set(project.glyphs.map((g) => g.name).filter((n) => n !== glyph.name))
  const niqqud = new Set(project.niqqud.map((n) => n.unicode))

  // Work out the new name, or why there isn't one yet.
  let target: string | null = null
  let problem: string | null = null
  let becomesMark = false
  if (identity === 'char') {
    const cp = parseChar(char)
    if (cp === null) problem = 'Type the character it should be (or its code, like U+05E8)'
    else {
      target = cmap.get(cp) ?? canonicalName(cp)
      becomesMark = niqqud.has(cp)
    }
  } else if (identity === 'alternate') {
    if (!base) problem = 'Pick the glyph this is an alternate of'
    else {
      target = nextAlternateName(base.split('.')[0], feature, others)
      becomesMark = byName.get(base)?.category === 'mark'
    }
  } else {
    const comps = charsToGlyphs(project, letters)
    if (!comps || comps.length < 2) problem = 'Type two or more letters that are already in the font'
    else target = `${comps.join('_')}.${ligFeature}`
  }
  if (target === glyph.name) {
    problem = `It's already ${glyph.name}`
    target = null
  }

  const taken = target !== null && others.has(target)
  const takenGlyph = taken ? byName.get(target!) : undefined
  const alternates = glyph.name.includes('.') ? [] : project.glyphs.filter((g) => g.name.startsWith(glyph.name + '.'))
  const roleChanges = target !== null && becomesMark !== (glyph.category === 'mark')
  const blocked = !target || (taken && (!swap || !!takenGlyph?.auto))

  const submit = async () => {
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.renameGlyph(glyph.name, target, taken && swap, identity === 'char' && moveAlternates)
      onDone(res.project, target, res.renamed)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal reassign-dialog" role="dialog" aria-label="Reassign glyph">
        <header>
          <h2>Reassign {glyph.char} {glyph.name}</h2>
          <span className="muted small">
            For a glyph that was named or imported as the wrong character. Its drawing and SVG move to the new name,
            and kerning, groups and ligature rules follow.
          </span>
        </header>
        <div className="reassign-body">
          <div className="row">
            <span className="muted">It is actually</span>
            <div className="segmented">
              {(['char', 'alternate', 'ligature'] as Identity[]).map((k) => (
                <button key={k} className={identity === k ? 'active' : ''} onClick={() => setIdentity(k)}>
                  {{ char: 'a character', alternate: 'an alternate of…', ligature: 'a ligature' }[k]}
                </button>
              ))}
            </div>
          </div>
          {identity === 'char' && (
            <input dir="auto" className="char-input" autoFocus value={char} placeholder="ר or U+05E8"
              onChange={(e) => setChar(e.target.value)} />
          )}
          {identity === 'alternate' && (
            <div className="row">
              <select value={base} onChange={(e) => setBase(e.target.value)}>
                <option value="">Choose a glyph…</option>
                {project.glyphs.filter((g) => g.name !== glyph.name && !g.name.startsWith('.')).map((g) => (
                  <option key={g.name} value={g.name}>{g.char} {g.name}</option>
                ))}
              </select>
              <select value={feature} onChange={(e) => setFeature(e.target.value)}>
                {ALTERNATE_FEATURES.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
          )}
          {identity === 'ligature' && (
            <div className="row">
              <input dir="rtl" className="char-input" value={letters} placeholder="אל" onChange={(e) => setLetters(e.target.value)} />
              <select value={ligFeature} onChange={(e) => setLigFeature(e.target.value)}>
                {LIGATURE_FEATURES.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
          )}

          {problem ? (
            <p className="warn-text small">{problem}</p>
          ) : (
            <p>
              → <strong className="mono">{target}</strong> {takenGlyph?.char}
            </p>
          )}

          {taken && (
            <div className="duplicate">
              {takenGlyph?.auto ? (
                <span>{target} is made automatically and can't be swapped.</span>
              ) : (
                <label>
                  <input type="checkbox" checked={swap} onChange={(e) => setSwap(e.target.checked)} />{' '}
                  {target} already exists. <strong>Swap the two</strong> (it becomes {glyph.name})
                </label>
              )}
            </div>
          )}
          {alternates.length > 0 && identity === 'char' && (
            <label className="small">
              <input type="checkbox" checked={moveAlternates} onChange={(e) => setMoveAlternates(e.target.checked)} />{' '}
              Move its alternates along ({alternates.map((a) => a.name).join(', ')})
            </label>
          )}
          {roleChanges && (
            <p className="muted small">
              It becomes {becomesMark ? 'a niqqud mark' : 'a letter'}, so its anchors are reset for the new role.
            </p>
          )}
          {error && <p className="error small">{error}</p>}
        </div>
        <footer>
          <span className="muted small">A snapshot is taken first, so this can be undone from the Project tab.</span>
          <span className="spacer" />
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="primary" disabled={blocked || busy} onClick={() => void submit()}>
            {busy ? 'Reassigning…' : taken ? 'Swap' : 'Reassign'}
          </button>
        </footer>
      </div>
    </div>
  )
}
