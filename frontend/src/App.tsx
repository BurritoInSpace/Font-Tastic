import { useCallback, useEffect, useRef, useState } from 'react'
import { api, readBase64, type ChangeEvent, type ImportReport, type Project } from './api'
import { GlyphEditor } from './components/GlyphEditor'
import { GlyphGrid } from './components/GlyphGrid'
import { HomeScreen } from './components/HomeScreen'
import { ImportDialog, type Upload } from './components/ImportDialog'
import { InfoPanel } from './components/InfoPanel'
import { KerningPanel } from './components/KerningPanel'
import { LigaturesPanel } from './components/LigaturesPanel'
import { Preview } from './components/Preview'

type Tab = 'glyph' | 'kerning' | 'ligatures' | 'project'

export default function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(() => decodeURIComponent(location.hash.slice(1)) || null)
  const [tab, setTab] = useState<Tab>('glyph')
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [uploads, setUploads] = useState<Upload[] | null>(null)
  const [watching, setWatching] = useState(false)
  const revision = useRef<number | null>(null)
  revision.current = project?.revision ?? null

  const refresh = useCallback(async () => {
    const { project } = await api.project()
    setProject(project)
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
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

  const exportOtf = async () => {
    try {
      const res = await api.exportOtf()
      setMessage({ text: `Exported ${res.path} (${Math.round(res.bytes / 1024)} KB)` })
    } catch (e) {
      onError(String(e))
    }
  }

  if (loading) return <div className="splash">Loading…</div>
  if (!project) return <HomeScreen onOpened={opened} message={message} />

  const glyph = project.glyphs.find((g) => g.name === selected) ?? null

  return (
    <div className="app">
      <header className="toolbar">
        <div className="title">
          <strong>{project.name}</strong>{' '}
          <span className="muted">
            {project.info.familyName !== project.name && `${project.info.familyName} `}{project.info.styleName}
          </span>
        </div>
        <nav className="tabs">
          {(['glyph', 'kerning', 'ligatures', 'project'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {{ glyph: 'Glyphs', kerning: 'Kerning', ligatures: 'Ligatures', project: 'Project' }[t]}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <span className={`live${watching ? ' on' : ''}`}
          title={watching ? 'Watching glyphs/: SVGs saved in Illustrator update here automatically'
            : 'Not watching for changes; use Re-import'}>
          {watching ? 'Live' : 'Not live'}
        </span>
        {message && (
          <span className={`message${message.error ? ' error' : ''}`} onClick={() => setMessage(null)}>
            {message.text}
          </span>
        )}
        <button onClick={(e) => void reimport(e.shiftKey)}
          title="Re-read SVGs changed since the last import (Shift-click: re-read all)">
          Re-import
        </button>
        <button onClick={() => void exportOtf()}>Export OTF</button>
        <button onClick={() => void closeProject()} title="Close this project and go to the project list">
          Switch project
        </button>
      </header>

      <main className="workspace">
        <GlyphGrid glyphs={project.glyphs} info={project.info} selected={selected}
          onSelect={(n) => { setSelected(n); setTab('glyph') }} onImport={(files) => void importFiles(files)} />
        <div className="center">
          {tab === 'glyph' &&
            (glyph ? (
              <GlyphEditor project={project} glyph={glyph} onChanged={refresh} onError={onError}
                onMessage={(text) => setMessage({ text })} onOpenGlyph={setSelected} onProject={setProject} />
            ) : (
              <div className="empty">Pick a glyph on the left to place its anchors.</div>
            ))}
          {tab === 'kerning' && <KerningPanel project={project} onChanged={refresh} onError={onError} />}
          {tab === 'ligatures' && <LigaturesPanel project={project} onChanged={refresh} onError={onError} />}
          {tab === 'project' && (
            <InfoPanel project={project} onError={onError} onRestored={setProject}
              onChanged={(reimportAll) => (reimportAll ? reimport(true) : refresh())} />
          )}
        </div>
      </main>

      <Preview project={project} onSelectGlyph={(n) => { setSelected(n); setTab('glyph') }} />

      {uploads && (
        <ImportDialog project={project} uploads={uploads} onCancel={() => setUploads(null)} onDone={finishImport} />
      )}
    </div>
  )
}
