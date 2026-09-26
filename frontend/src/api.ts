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

/** Kerning gap marker for one side of a pair ("1" = right-hand letter, "2" = left-hand). */
export interface GapMarker {
  on: boolean
  /** the target gap, in font units */
  width: number
  /** shift of the marker, font units, positive = to the right */
  offset: number
}

export interface ProjectSettings {
  previewText?: string
  /** height of the preview strip, px */
  previewHeight?: number
  /** what Export writes, remembered per project */
  export?: { staticFormats: string[]; weights: string[] | null; variableFormats: string[] }
  opticalGap?: Record<'1' | '2', GapMarker>
}

export interface WeightInfo {
  name: string
  /** OpenType weight class, 1-1000 */
  weight: number
  /** SVG folder, relative to the project */
  glyphs: string
  active: boolean
}

export interface Project {
  root: string
  /** the weight being edited */
  weight: string
  weights: WeightInfo[]
  /** single weight still directly in glyphs/ + font.ufo (moves to glyphs/<Weight>/ when a second is added) */
  flatLayout: boolean
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

/** One way a glyph differs between weights (see fonttastic/compat.py). */
export interface CompatProblem {
  type: string
  /** error: can't build; fixable: re-sequencing fixes it; warning: builds, may look off */
  severity: 'error' | 'fixable' | 'warning'
  message: string
  [detail: string]: unknown
}

export interface CompatReport {
  glyphs: Record<string, CompatProblem[]>
  errors: number
  fixable: number
  warnings: number
}

export interface VariableSetup {
  available: boolean
  default?: string
  min?: number
  max?: number
  masters?: { name: string; weight: number }[]
  instances?: { name: string; weight: number }[]
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
  recentPreview: (path: string) =>
    call<{ preview: { name: string; path: string; bounds: [number, number, number, number] | null } | null }>(
      'GET', `/api/recent/preview?path=${encodeURIComponent(path)}`),
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
  deleteGlyph: (glyph: string) =>
    call<{ removed: { kerning: number; groups: number; ligatures: number }; project: Project }>(
      'POST', `/api/glyphs/${encodeURIComponent(glyph)}/delete`),
  renameGlyph: (glyph: string, newName: string, swap = false, moveAlternates = true) =>
    call<{ renamed: Record<string, string>; project: Project }>(
      'POST', `/api/glyphs/${encodeURIComponent(glyph)}/rename`, { newName, swap, moveAlternates }),
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
  compat: () => call<CompatReport>('GET', '/api/compat'),
  variable: () => call<VariableSetup>('GET', '/api/variable'),
  setVariable: (values: { default?: string; instances?: { name: string; weight: number }[] }) =>
    call<VariableSetup>('PUT', '/api/variable', values),
  variableFont: async (): Promise<ArrayBuffer> => {
    const res = await fetch('/api/variable.otf')
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: res.statusText }))
      throw new ApiError(detail.detail ?? res.statusText)
    }
    return res.arrayBuffer()
  },
  exportFonts: (choice: { staticFormats: string[]; weights: string[] | null; variableFormats: string[] }) =>
    call<{ paths: string[]; bytes: number; variableNote: string | null }>('POST', '/api/export', choice),
  addWeight: (name: string, weight: number, copyFrom: string) =>
    call<{ project: Project; import: ImportReport }>('POST', '/api/weights', { name, weight, copyFrom }),
  switchWeight: (name: string) =>
    call<{ project: Project; import: ImportReport }>('POST', '/api/weights/switch', { name }),
  deleteWeight: (name: string) =>
    call<{ project: Project; import: ImportReport }>('POST', '/api/weights/delete', { name }),
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
