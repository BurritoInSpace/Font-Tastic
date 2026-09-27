import { useEffect, useState } from 'react'
import { api, type CompositeCandidate, type Project } from '../api'

interface Props {
  onCancel: () => void
  onDone: (project: Project, added: string[], errors: Record<string, string>) => void
}

/** Pick accented letters to build from the base letters and marks the font already has. */
export function AccentsDialog({ onCancel, onDone }: Props) {
  const [candidates, setCandidates] = useState<CompositeCandidate[] | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.compositeCandidates()
      .then((r) => {
        setCandidates(r.candidates)
        setChosen(new Set(r.candidates.filter((c) => !c.problem).map((c) => c.unicode)))
      })
      .catch((e) => setError(String(e)))
  }, [])

  const byBase = new Map<string, CompositeCandidate[]>()
  for (const c of candidates ?? []) byBase.set(c.base, [...(byBase.get(c.base) ?? []), c])
  const available = (candidates ?? []).filter((c) => !c.problem)
  const blocked = (candidates ?? []).length - available.length

  const toggle = (cp: number) => {
    const next = new Set(chosen)
    if (next.has(cp)) next.delete(cp)
    else next.add(cp)
    setChosen(next)
  }

  const submit = async () => {
    setBusy(true)
    try {
      const res = await api.addComposites([...chosen])
      onDone(res.project, res.added, res.errors)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal accents-dialog" role="dialog" aria-label="Accented letters">
        <header>
          <h2>Accented letters</h2>
          <span className="muted small">
            Built from letters and accents you've drawn: each accent sits on the letter's matching anchor (its _top on
            the letter's top). They're rebuilt whenever you redraw a part or move an anchor, in every weight.
          </span>
        </header>
        <div className="accents-body">
          {candidates === null ? (
            <p className="muted">{error ?? 'Looking…'}</p>
          ) : candidates.length === 0 ? (
            <p className="muted">
              Nothing to build yet. Draw base letters (e, a, o…) and combining accents (U+0301 acute, U+0308 diaeresis…)
              first; accented letters already in the font aren't listed.
            </p>
          ) : (
            <>
              <div className="row">
                <button onClick={() => setChosen(new Set(available.map((c) => c.unicode)))}>
                  Select all ({available.length})
                </button>
                <button onClick={() => setChosen(new Set())}>Clear</button>
                {blocked > 0 && (
                  <span className="muted small">
                    {blocked} greyed out need an accent or anchor that isn't there yet (hover to see which).
                  </span>
                )}
              </div>
              <div className="accent-groups">
                {[...byBase].map(([base, list]) => (
                  <div key={base} className="accent-group">
                    <span className="accent-base">{base}</span>
                    {list.map((c) => (
                      <button key={c.unicode} disabled={!!c.problem}
                        className={`accent-chip${chosen.has(c.unicode) ? ' on' : ''}`}
                        title={c.problem ?? `${c.char} (${c.name}) = ${c.base} + ${c.marks.map((m) => `◌${m}`).join(' + ')}`}
                        onClick={() => toggle(c.unicode)}>
                        {c.char}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
          {error && candidates !== null && <p className="error small">{error}</p>}
        </div>
        <footer>
          <span className="spacer" />
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="primary" disabled={chosen.size === 0 || busy} onClick={() => void submit()}>
            {busy ? 'Building…' : `Build ${chosen.size}`}
          </button>
        </footer>
      </div>
    </div>
  )
}
