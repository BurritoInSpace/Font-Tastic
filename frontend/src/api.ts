export interface Anchor {
  name: string
  x: number
  y: number
}

export type Category = 'base' | 'mark' | 'ligature'

export interface Glyph {
  name: string
  unicode: number | null
  char: string
  /** readable ASCII name for Hebrew letters (e.g. "bet"), used for default group names */
  niceName: string | null
  category: Category
  width: number
  source: string | null
  /** the glyph came from an SVG that has since been deleted or moved */
  sourceMissing: boolean
  auto: boolean
  warnings: string[]
  widthOverride: boolean
  anchors: Anchor[]
  path: string
  bounds: [number, number, number, number] | null
}

export interface FontInfo {
  familyName: string
  styleName: string
  unitsPerEm: number
  ascender: number
  descender: number
  capHeight: number
  xHeight: number
}

export interface LigatureRule {
  components: string[]
  glyph: string
  feature: string
}

/** A kerning pair in reading order: for Hebrew, `first` is the right-hand glyph. */
export interface KernPair {
  first: string
  second: string
  value: number
}

export interface ProjectSettings {
  previewText?: string
}

export interface Project {
  root: string
  /** the .fonttastic file */
  file: string
  name: string
  settings: ProjectSettings
  revision: number
  info: FontInfo
  glyphs: Glyph[]
  ligatures: LigatureRule[]
  /** pairs; `first`/`second` are glyph names or group keys like "public.kern1.round" */
  kerning: KernPair[]
  /** kerning groups by side: "1" = first glyph of a pair (right-hand in Hebrew), "2" = second */
  kernGroups: Record<'1' | '2', Record<string, string[]>>
  /** the core niqqud marks the app knows, with the anchor class each attaches to */
  niqqud: { unicode: number; name: string; anchor: string }[]
}

export interface ImportReport {
  imported: string[]
  unchanged: number
  errors: Record<string, string>
  missingSource: string[]
}

export interface UploadAnalysis {
  filename: string
  status: 'new' | 'duplicate' | 'unknown' | 'invalid'
  glyphName: string | null
  unicode: number | null
  path?: string
  advance?: number
  warnings?: string[]
  error?: string
}

export interface AddFile {
  data: string // base64
  glyphName: string
  replace: boolean
}

export interface RecentProject {
  path: string
  name: string
  opened: string
  exists: boolean
}

export interface Snapshot {
  id: string
  reason: string
  created: string
  files: string[]
}

/** What the server pushes on /api/events when the project changes. */
export interface ChangeEvent {
  revision: number
  /** true when the change came from files on disk (the watcher), not from the UI */
  external: boolean
  imported?: string[]
  errors?: Record<string, string>
  missingSource?: string[]
}

export class ApiError extends Error {
  /** machine-readable reason, e.g. "needs-conversion" */
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let detail: unknown = res.statusText
    try {
      detail = (await res.json()).detail ?? detail
    } catch {
      /* not JSON */
    }
    if (detail && typeof detail === 'object' && 'message' in detail) {
      const d = detail as { message: string; code?: string }
      throw new ApiError(d.message, d.code)
    }
    throw new ApiError(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return res.json()
}

export const api = {
  project: () => call<{ project: Project | null }>('GET', '/api/project'),
  open: (path: string) => call<{ project: Project; import: ImportReport }>('POST', '/api/project/open', { path }),
  convert: (path: string) =>
    call<{ project: Project; import: ImportReport }>('POST', '/api/project/convert', { path }),
  newProject: (parent: string, name: string) =>
    call<{ project: Project; import: ImportReport }>('POST', '/api/project/new', { parent, name }),
  close: () => call<{ project: null }>('POST', '/api/project/close'),
  saveSettings: (values: ProjectSettings) => call<{ settings: ProjectSettings }>('PUT', '/api/project/settings', values),
  recent: () => call<{ recent: RecentProject[] }>('GET', '/api/recent'),
  removeRecent: (path: string) => call<{ recent: RecentProject[] }>('POST', '/api/recent/remove', { path }),
  snapshots: () => call<{ snapshots: Snapshot[] }>('GET', '/api/snapshots'),
  restore: (id: string) =>
    call<{ project: Project; snapshots: Snapshot[] }>('POST', `/api/snapshots/${encodeURIComponent(id)}/restore`),
  reimport: (force = false) =>
    call<{ project: Project; import: ImportReport }>('POST', '/api/project/import', { force }),
  analyzeUploads: (files: { filename: string; data: string }[]) =>
    call<{ files: UploadAnalysis[] }>('POST', '/api/import/analyze', { files }),
  addGlyphFiles: (files: AddFile[]) =>
    call<{ project: Project; added: string[]; errors: Record<string, string> }>('POST', '/api/import/add', { files }),
  editGlyph: (glyph: string) =>
    call<{ path: string; app: string; created: boolean; project: Project }>(
      'POST', `/api/glyphs/${encodeURIComponent(glyph)}/edit`),
  duplicateGlyph: (glyph: string, unicode: number) =>
    call<{ name: string; project: Project }>('POST', `/api/glyphs/${encodeURIComponent(glyph)}/duplicate`, { unicode }),
  revealGlyph: (glyph: string) => call<{ path: string }>('POST', `/api/glyphs/${encodeURIComponent(glyph)}/reveal`),
  setAnchors: (glyph: string, anchors: Anchor[]) =>
    call<Glyph>('PUT', `/api/glyphs/${encodeURIComponent(glyph)}/anchors`, { anchors }),
  setWidth: (glyph: string, width: number | null) =>
    call<Glyph>('PUT', `/api/glyphs/${encodeURIComponent(glyph)}/width`, { width }),
  setInfo: (info: Partial<FontInfo>) => call<Project>('PUT', '/api/info', info),
  setLigatures: (rules: LigatureRule[]) => call<Project>('PUT', '/api/ligatures', { rules }),
  setKern: (first: string, second: string, value: number) =>
    call<Project>('PUT', '/api/kerning', { first, second, value }),
  setKernGroup: (side: 1 | 2, name: string, glyphs: string[], renameFrom?: string) =>
    call<Project>('PUT', '/api/kerning/groups', { side, name, glyphs, renameFrom }),
  deleteKernGroup: (side: 1 | 2, name: string) =>
    call<Project>('POST', '/api/kerning/groups/delete', { side, name }),
  exportOtf: () => call<{ path: string; bytes: number }>('POST', '/api/export'),
  fontBinary: async (): Promise<ArrayBuffer> => {
    const res = await fetch('/api/font.otf')
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: res.statusText }))
      throw new ApiError(detail.detail ?? res.statusText)
    }
    return res.arrayBuffer()
  },
}

export function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Native helpers when running inside the pywebview window. */
interface Bridge {
  pick_folder(): Promise<string | null>
  pick_project_file(): Promise<string | null>
}

export function nativeBridge(): Bridge | null {
  const w = window as unknown as { pywebview?: { api?: Bridge } }
  return w.pywebview?.api ?? null
}
