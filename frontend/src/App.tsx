import { useCallback, useEffect, useRef, useState } from 'react'
import { api, readBase64, type ChangeEvent, type CompatReport, type EditorsInfo, type ImportReport, type Project } from './api'
import { logo, tabIcons } from './assets'
import { describeLocation } from './axes'
import { GlyphEditor } from './components/GlyphEditor'
import { GlyphGrid } from './components/GlyphGrid'
import { HomeScreen } from './components/HomeScreen'
import { AccentsDialog } from './components/AccentsDialog'
import { ActionsMenu, AnchorsDialog, SideBearingsDialog, type BulkAction } from './components/ActionsMenu'
import { ExportDialog } from './components/ExportDialog'
import { ImportDialog, type Upload } from './components/ImportDialog'
import { InfoPanel } from './components/InfoPanel'
import { NewWeightDialog } from './components/NewWeightDialog'
import { KerningPanel } from './components/KerningPanel'
import { LigaturesPanel } from './components/LigaturesPanel'
import { Preview } from './components/Preview'
import { VariablePanel } from './components/VariablePanel'

type Tab = 'glyph' | 'kerning' | 'ligatures' | 'variable' | 'project'

const TABS: { id: Tab; label: string }[] = [
  { id: 'glyph', label: 'glyphs' },
  { id: 'kerning', label: 'kerning' },
  { id: 'ligatures', label: 'ligatures' },
  { id: 'variable', label: 'variable' },
  { id: 'project', label: 'project' },
]

export default function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(() => decodeURIComponent(location.hash.slice(1)) || null)
  const [tab, setTab] = useState<Tab>('glyph')
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [uploads, setUploads] = useState<Upload[] | null>(null)
  const [watching, setWatching] = useState(false)
  const [newWeight, setNewWeight] = useState(false)
  const [compat, setCompat] = useState<CompatReport | null>(null)
  const [exporting, setExporting] = useState(false)
  const [showPoints, setShowPoints] = useState(false)
  const [accenting, setAccenting] = useState(false)
  const [bulk, setBulk] = useState<BulkAction | null>(null)
  const [compare, setCompare] = useState('')
  const [editors, setEditors] = useState<EditorsInfo | null>(null)
  const revision = useRef<number | null>(null)
  revision.current = project?.revision ?? null

  const refresh = useCallback(async () => {
    const { project } = await api.project()
    setProject(project)
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
    api.editors().then(setEditors).catch(() => {})
  }, [refresh])

  // Live updates: the server watches glyphs/ and says when the project changed.
  const projectFile = project?.file
  useEffect(() => {
    if (!projectFile) return
    const source = new EventSource('/api/events')
    source.addEventListener('hello', (e) => setWatching(JSON.parse((e as MessageEvent).data).watching))
    source.addEventListener('change', (e) => {
      const change: ChangeEvent = JSON.parse((e as MessageEvent).data)
      if (revision.current !== null && change.revision <= revision.current) return // our own edit, already shown
      void refresh()
      if (!change.external) return
      const errors = Object.entries(change.errors ?? {})
      if (errors.length) {
        setMessage({ text: `Couldn't read ${errors.map(([f, e]) => `${f} (${e})`).join('; ')}`, error: true })
      } else if (change.imported?.length) {
        setMessage({ text: `Updated from disk: ${change.imported.join(', ')}` })
      }
    })
    source.onerror = () => setWatching(false)
    return () => source.close()
  }, [projectFile, refresh])

  // With several weights, keep a fresh report of what won't interpolate.
  const multiWeight = (project?.weights.length ?? 0) > 1
  const projectRevision = project?.revision
  useEffect(() => {
    if (!multiWeight) {
      setCompat(null)
      return
    }
    const t = window.setTimeout(() => api.compat().then(setCompat).catch(() => {}), 400)
    return () => window.clearTimeout(t)
  }, [multiWeight, projectRevision])

  // App-wide shortcuts: Ctrl+S flips to the master edited before, Ctrl+I imports SVGs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || !project) return
      const key = e.key.toLowerCase()
      if (key !== 's' && key !== 'i') return
      e.preventDefault() // not the webview's "save page" / italics
      if (document.querySelector('.modal-backdrop')) return
      if (key === 'i') {
        importInput.current?.click()
        return
      }
      const names = project.weights.map((w) => w.name)
      if (names.length < 2) {
        setMessage({ text: 'Only one master: add one from the menu at the top left to switch between them' })
        return
      }
      const last = lastWeight.current
      const target = last && last !== project.weight && names.includes(last)
        ? last
        : names[(names.indexOf(project.weight) + 1) % names.length]
      void switchWeight(target)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  // Keep the selection in the URL so reloads (and dev hot-reloads) keep it.
  useEffect(() => {
    history.replaceState(null, '', selected ? `#${encodeURIComponent(selected)}` : location.pathname)
  }, [selected])

  useEffect(() => {
    if (!message || message.error) return
    const t = window.setTimeout(() => setMessage(null), 4000)
    return () => window.clearTimeout(t)
  }, [message])

  const onError = (text: string) => setMessage({ text: text.replace(/^Error: /, ''), error: true })

  const describe = (r: ImportReport) => {
    const errors = Object.entries(r.errors)
    if (errors.length) return { text: `Import errors: ${errors.map(([f, e]) => `${f}: ${e}`).join('; ')}`, error: true }
    const parts = [`${r.imported.length} imported`, `${r.unchanged} unchanged`]
    if (r.missingSource.length) parts.push(`${r.missingSource.length} missing SVG (${r.missingSource.join(', ')})`)
    return { text: parts.join(' · ') }
  }

  const opened = (next: Project, report: ImportReport) => {
    setProject(next)
    setSelected(null)
    setTab('glyph')
    setMessage(describe(report))
  }

  const closeProject = async () => {
    try {
      await api.close()
      setProject(null)
      setSelected(null)
      setMessage(null)
    } catch (e) {
      onError(String(e))
    }
  }

  const reimport = async (force = false) => {
    try {
      const res = await api.reimport(force)
      setProject(res.project)
      setMessage(describe(res.import))
    } catch (e) {
      onError(String(e))
    }
  }

  const importFiles = async (files: File[]) => {
    try {
      const data = await Promise.all(files.map(readBase64))
      const { files: analyses } = await api.analyzeUploads(files.map((f, i) => ({ filename: f.name, data: data[i] })))
      setUploads(analyses.map((analysis, i) => ({ analysis, data: data[i] })))
    } catch (e) {
      onError(String(e))
    }
  }

  const finishImport = (next: Project, added: string[], errors: Record<string, string>) => {
    setUploads(null)
    setProject(next)
    const failed = Object.entries(errors)
    if (failed.length) onError(`Not imported: ${failed.map(([n, e]) => `${n} (${e})`).join('; ')}`)
    else setMessage({ text: `Imported ${added.join(', ')}` })
    if (added.length) {
      setSelected(added[0])
      setTab('glyph')
    }
  }

  // The master edited before this one, for Ctrl+S.
  const lastWeight = useRef<string | null>(null)
  const importInput = useRef<HTMLInputElement>(null)

  const switchWeight = async (name: string) => {
    try {
      if (project && project.weight !== name) lastWeight.current = project.weight
      const res = await api.switchWeight(name)
      setProject(res.project)
      setMessage({ text: `Editing ${name}` })
    } catch (e) {
      onError(String(e))
    }
  }

  const matchAll = async () => {
    try {
      const res = await api.fixAll()
      setProject(res.project)
      setCompat(res.compat)
      const failed = Object.entries(res.errors)
      if (failed.length) onError(`Couldn't match ${failed.map(([g, m]) => `${g} (${m})`).join('; ')}`)
      else setMessage({ text: res.fixed.length ? `Matched ${res.fixed.join(', ')} to the default master` : 'Nothing to fix' })
    } catch (e) {
      onError(String(e))
    }
  }

  const bulkDone = (next: Project, text: string) => {
    setBulk(null)
    setProject(next)
    setMessage({ text })
  }

  const exported = (res: { paths: string[]; bytes: number; variableNote: string | null }) => {
    setExporting(false)
    const names = res.paths.map((p) => p.split(/[\\/]/).pop())
    setMessage({
      text: (names.length ? `Exported ${names.join(', ')} to build/ (${Math.round(res.bytes / 1024)} KB)` : 'Nothing exported') +
        (res.variableNote ? `. ${res.variableNote}` : ''),
      error: !!res.variableNote,
    })
  }

  if (loading) return <div className="splash">Loading…</div>
  if (!project) return <HomeScreen onOpened={opened} message={message} />

  const glyph = project.glyphs.find((g) => g.name === selected) ?? null

  return (
    <div className="app">
      <header className="topbar">
        <ActionsMenu project={project} logo={logo} onAction={(a) => {
          if (a === 'accents') setAccenting(true)
          else if (a === 'reimport') void reimport(true)
          else if (a === 'match') void matchAll()
          else setBulk(a)
        }} />
        <div className="topbar-title">
          <div className="font-name" title={project.file}>{project.name}</div>
          <select className="weight-menu" value={project.weight} title="Master being edited (Ctrl+S: switch to the one before)"
            onChange={(e) => e.target.value === '+new' ? setNewWeight(true) : void switchWeight(e.target.value)}>
            {project.weights.map((w) => (
              <option key={w.name} value={w.name}>{w.name} · {describeLocation(project.axes, w.location)}</option>
            ))}
            <option value="+new">+ New master…</option>
          </select>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              <img src={tabIcons[t.id]} alt="" />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-status">
          {message && (
            <span className={`message${message.error ? ' error' : ''}`} onClick={() => setMessage(null)} title={message.text}>
              {message.text}
            </span>
          )}
          <span className={`live${watching ? ' on' : ''}`}
            title={watching ? 'Watching the glyph folders: SVGs saved in your drawing app update here automatically'
              : 'Not watching for changes; use Reimport'}>
            {watching ? 'Live' : 'Not live'}
          </span>
        </div>
        <div className="topbar-actions">
          <button className="primary" onClick={(e) => void reimport(e.shiftKey)}
            title="Re-read SVGs changed since the last import (Shift-click: re-read all)">
            Reimport
          </button>
          <button className="primary" onClick={() => setExporting(true)}
            title="Choose which weights and formats to write into build/">
            Export
          </button>
          <button className="primary" onClick={() => void closeProject()} title="Close this project and go to the home screen">
            Home
          </button>
        </div>
      </header>

      <input ref={importInput} type="file" accept=".svg,image/svg+xml" multiple hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])].filter((f) => f.name.toLowerCase().endsWith('.svg'))
          e.target.value = ''
          if (files.length) void importFiles(files)
        }} />

      <main className="workspace">
        <GlyphGrid glyphs={project.glyphs} info={project.info} selected={selected} compat={compat}
          onSelect={(n) => { setSelected(n); setTab('glyph') }} onImport={(files) => void importFiles(files)}
          onAccents={project.scripts.some((s) => s.direction === 'ltr') ? () => setAccenting(true) : undefined} />
        <div className="center">
          {tab === 'glyph' &&
            (glyph ? (
              <GlyphEditor project={project} glyph={glyph} onChanged={refresh} onError={onError}
                onMessage={(text) => setMessage({ text })} onOpenGlyph={setSelected} onProject={setProject}
                showPoints={showPoints} onShowPoints={setShowPoints} compat={compat}
                compare={compare} onCompare={setCompare} editorLabel={editors?.label} />
            ) : (
              <div className="empty">Pick a glyph on the left to place its anchors.</div>
            ))}
          {tab === 'kerning' && <KerningPanel key={project.weight} project={project} onChanged={refresh} onError={onError} />}
          {tab === 'ligatures' && (
            <div className="panel-page">
              <LigaturesPanel project={project} onChanged={refresh} onError={onError} />
            </div>
          )}
          {tab === 'variable' && (
            <VariablePanel project={project} compat={compat} onError={onError}
              onOpenGlyph={(n, points) => { setSelected(n); setTab('glyph'); if (points) setShowPoints(true) }}
              onNewWeight={() => setNewWeight(true)} onProject={setProject} onCompat={setCompat}
              onMessage={(text) => setMessage({ text })} />
          )}
          {tab === 'project' && (
            <div className="panel-page">
            <InfoPanel project={project} onError={onError} onRestored={setProject} editors={editors} onEditors={setEditors}
              onDeleteWeight={async (name) => {
                try {
                  const res = await api.deleteWeight(name)
                  setProject(res.project)
                  setMessage({ text: `Removed ${name}; its files were moved to snapshots/removed-weights/` })
                } catch (e) {
                  onError(String(e))
                }
              }}
              onChanged={(reimportAll) => (reimportAll ? reimport(true) : refresh())} />
            </div>
          )}
        </div>
      </main>

      <Preview project={project} onSelectGlyph={(n) => { setSelected(n); setTab('glyph') }} />

      {newWeight && (
        <NewWeightDialog project={project} onCancel={() => setNewWeight(false)}
          onDone={(next, name) => {
            setNewWeight(false)
            lastWeight.current = project.weight
            setProject(next)
            setMessage({ text: `Added ${name}, a copy to redraw. Editing it now.` })
          }} />
      )}

      {exporting && (
        <ExportDialog project={project} compat={compat} onCancel={() => setExporting(false)} onDone={exported}
          onError={(m) => { setExporting(false); onError(m) }} />
      )}

      {bulk === 'sidebearings' && (
        <SideBearingsDialog project={project} onCancel={() => setBulk(null)} onDone={bulkDone}
          onError={(m) => { setBulk(null); onError(m) }} />
      )}
      {bulk === 'anchors' && (
        <AnchorsDialog project={project} onCancel={() => setBulk(null)} onDone={bulkDone}
          onError={(m) => { setBulk(null); onError(m) }} />
      )}

      {accenting && (
        <AccentsDialog onCancel={() => setAccenting(false)}
          onDone={(next, added, errors) => {
            setAccenting(false)
            setProject(next)
            const failed = Object.entries(errors)
            if (failed.length) onError(`Built ${added.length}; not built: ${failed.map(([c, e]) => `${c} (${e})`).join('; ')}`)
            else setMessage({ text: `Built ${added.length} accented letter${added.length === 1 ? '' : 's'}` })
            if (added.length) {
              setSelected(added[0])
              setTab('glyph')
            }
          }} />
      )}

      {uploads && (
        <ImportDialog project={project} uploads={uploads} onCancel={() => setUploads(null)} onDone={finishImport} />
      )}
    </div>
  )
}
