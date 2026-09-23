import { useEffect, useState } from 'react'
import { api, type LigatureRule, type Project } from '../api'
import { charsToGlyphs } from '../glyphs'

const FEATURES = ['liga', 'dlig', ...Array.from({ length: 20 }, (_, i) => `ss${String(i + 1).padStart(2, '0')}`)]

interface Props {
  project: Project
  onChanged: () => void
  onError: (msg: string) => void
}

export function LigaturesPanel({ project, onChanged, onError }: Props) {
  const [rules, setRules] = useState<LigatureRule[]>(project.ligatures)
  const [input, setInput] = useState('')
  useEffect(() => setRules(project.ligatures), [project.ligatures])

  const byName = new Map(project.glyphs.map((g) => [g.name, g]))
  const outputs = project.glyphs.filter((g) => g.unicode === null && !g.name.startsWith('.'))
  const dirty = JSON.stringify(rules) !== JSON.stringify(project.ligatures)

  const save = async () => {
    try {
      await api.setLigatures(rules)
      onChanged()
    } catch (e) {
      onError(String(e))
    }
  }

  const add = () => {
    const comps = charsToGlyphs(project, input)
    if (!comps || comps.length < 2) {
      onError('Type at least two characters that exist in the font')
      return
    }
    const guess = outputs.find((g) => g.name.split('.')[0] === comps.join('_'))
    setRules([...rules, { components: comps, glyph: guess?.name ?? outputs[0]?.name ?? '', feature: 'liga' }])
    setInput('')
  }

  const update = (i: number, patch: Partial<LigatureRule>) =>
    setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="panel">
      <h2>Ligatures</h2>
      <p className="muted">
        GSUB type 4: a sequence of glyphs becomes one. <code>liga</code> is always on; <code>dlig</code> and{' '}
        <code>ss01</code>–<code>ss20</code> are opt-in. Ligature SVGs named like <code>uni05D0_uni05DC.liga.svg</code>{' '}
        get a rule automatically on import.
      </p>
      <table className="rules">
        <thead>
          <tr><th>Input</th><th></th><th>Output glyph</th><th>Feature</th><th></th></tr>
        </thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={i}>
              <td>
                <span className="seq" dir="rtl">{r.components.map((c) => byName.get(c)?.char ?? '?').join('')}</span>
                <span className="muted small"> {r.components.join(' ')}</span>
              </td>
              <td>→</td>
              <td>
                <select value={r.glyph} onChange={(e) => update(i, { glyph: e.target.value })}>
                  {outputs.map((g) => <option key={g.name}>{g.name}</option>)}
                </select>
              </td>
              <td>
                <select value={r.feature} onChange={(e) => update(i, { feature: e.target.value })}>
                  {FEATURES.map((f) => <option key={f}>{f}</option>)}
                </select>
              </td>
              <td><button className="icon" onClick={() => setRules(rules.filter((_, j) => j !== i))}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <input dir="rtl" value={input} placeholder="type the input letters, e.g. אל" onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button onClick={add}>Add rule</button>
        <span className="spacer" />
        <button className="primary" disabled={!dirty} onClick={() => void save()}>Save</button>
      </div>
    </div>
  )
}
