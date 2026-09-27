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
  /** Unicode script: Hebr, Latn, Grek, Cyrl...; Zyyy for shared digits and punctuation, Zinh for combining accents */
  script: string | null
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
  /** an accented letter built from parts: its base letter and marks (glyph names) */
  composite: { base: string; marks: string[] } | null
}

/** The drawing apps: which are installed, the user's choice, and the one that will open. */
export interface EditorsInfo {
  /** auto, illustrator, inkscape or default */
  choice: string
  /** id -> name, e.g. { illustrator: "Adobe Illustrator 2026", inkscape: "Inkscape", default: "..." } */
  installed: Record<string, string>
  active: string
  /** short name for buttons: Illustrator, Inkscape or default app */
  label: string
}

/** An accented letter the font could build from letters and marks it has. */
export interface CompositeCandidate {
  unicode: number
  char: string
  name: string
  base: string
  marks: string[]
  /** what's missing, or null when it can be built */
  problem: string | null
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

/** An extra horizontal line in the glyph editor, e.g. the height Hebrew letters share. */
export interface Guide {
  name: string
  y: number
}

export interface ProjectSettings {
  previewText?: string
  /** extra guide lines (shared by every master) */
  guides?: Guide[]
  /** height of the preview strip, px */
  previewHeight?: number
  /** what Export writes, remembered per project */
  export?: { staticFormats: string[]; weights: string[] | null; variableFormats: string[] }
  opticalGap?: Record<'1' | '2', GapMarker>
}

/** An axis the project varies along. */
export interface AxisDef {
  tag: string
  name: string
}

/** A master ("weight"): one drawing of the font at one location on the axes. */
export interface WeightInfo {
  name: string
  /** OpenType weight class, 1-1000 (the same as location.wght) */
  weight: number
  /** axis tag -> value */
  location: Record<string, number>
  /** SVG folder, relative to the project */
  glyphs: string
  active: boolean
}

export interface Project {
  root: string
  /** the weight being edited */
  weight: string
  weights: WeightInfo[]
  axes: AxisDef[]
  /** the scripts in the font, Hebrew first */
  scripts: { code: string; name: string; direction: 'rtl' | 'ltr' | null }[]
  /** OpenType languagesystem statements, e.g. [["DFLT","dflt"],["hebr","dflt"]] */
  languageSystems: [string, string][]
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

export interface PointContour {
  /** [x, y, segment type]; type null is an off-curve point */
  points: [number, number, string | null][]
  closed: boolean
  clockwise: boolean
}

/** A glyph's points in order, plus the default weight's to compare with. */
export interface PointOrder {
  contours: PointContour[]
  /** a saved point order fix is applied to this weight's drawing */
  fixed: boolean
  defaultWeight: string | null
  reference: { contours: PointContour[]; path: string; bounds: [number, number, number, number] | null } | null
}

export interface CompatReport {
  glyphs: Record<string, CompatProblem[]>
  errors: number
  fixable: number
  warnings: number
}

/** An axis with the range its masters span. Inactive: every master is at the same value, so it isn't in the font yet. */
export interface AxisRange extends AxisDef {
  unit: string
  min: number
  default: number
  max: number
  active: boolean
}

export interface AxisPreset {
  name: string
  min: number
  max: number
  default: number
  unit: string
  about: string
}

export interface VariableInstance {
  name: string
  location: Record<string, number>
}

export interface VariableSetup {
  /** two or more masters */
  available: boolean
  presets: Record<string, AxisPreset>
  axes: AxisRange[]
  /** the default master's name */
  default: string
  masters: { name: string; weight: number; location: Record<string, number> }[]
  instances: VariableInstance[]
  /** extremes of two or more axes with no master drawn there */
  missingCorners: Record<string, number>[]
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
  glyphPoints: (glyph: string) => call<PointOrder>('GET', `/api/glyphs/${encodeURIComponent(glyph)}/points`),
  editPoints: (glyph: string, op: 'start' | 'move' | 'reverse' | 'reset', contour = 0, value = 0) =>
    call<{ points: PointOrder; project: Project }>(
      'POST', `/api/glyphs/${encodeURIComponent(glyph)}/points`, { op, contour, value }),
  matchGlyph: (glyph: string) =>
    call<{ changed: string[]; errors: Record<string, string>; points: PointOrder; project: Project }>(
      'POST', `/api/glyphs/${encodeURIComponent(glyph)}/match`),
  fixAll: () =>
    call<{ fixed: string[]; errors: Record<string, string>; compat: CompatReport; project: Project }>(
      'POST', '/api/compat/fix'),
  compositeCandidates: () => call<{ candidates: CompositeCandidate[] }>('GET', '/api/composites'),
  addComposites: (unicodes: number[]) =>
    call<{ added: string[]; errors: Record<string, string>; project: Project }>('POST', '/api/composites', { unicodes }),
  drawInstead: (glyph: string) =>
    call<{ path: string; app: string; project: Project }>('POST', `/api/glyphs/${encodeURIComponent(glyph)}/draw-instead`),
  bulkMetrics: (req: { glyphs: string[]; lsb?: number; rsb?: number; allMasters: boolean }) =>
    call<{ changed: string[]; skipped: Record<string, string>; project: Project }>('POST', '/api/bulk/metrics', req),
  bulkAnchors: (req: { anchor: string; glyphs: string[]; x?: number | 'center'; y?: number; allMasters: boolean }) =>
    call<{ changed: string[]; project: Project }>('POST', '/api/bulk/anchors', req),
  version: () => call<{ version: string }>('GET', '/api/version'),
  editors: () => call<EditorsInfo>('GET', '/api/editors'),
  setEditor: (choice: string) => call<EditorsInfo>('PUT', '/api/editors', { choice }),
  revealGlyph: (glyph: string) => call<{ path: string }>('POST', `/api/glyphs/${encodeURIComponent(glyph)}/reveal`),
  setAnchors: (glyph: string, anchors: Anchor[]) =>
    call<Glyph>('PUT', `/api/glyphs/${encodeURIComponent(glyph)}/anchors`, { anchors }),
  /** Side bearings / width: moves the edges of the glyph's SVG artboard (width only for glyphs without one). */
  setMetrics: (glyph: string, values: { lsb?: number; rsb?: number; width?: number }) =>
    call<Glyph>('PUT', `/api/glyphs/${encodeURIComponent(glyph)}/metrics`, values),
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
  setVariable: (values: { default?: string; instances?: VariableInstance[] }) =>
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
  addWeight: (name: string, copyFrom: string, location: Record<string, number>) =>
    call<{ project: Project; import: ImportReport }>('POST', '/api/weights', { name, copyFrom, location }),
  moveMaster: (name: string, location: Record<string, number>) =>
    call<{ project: Project; variable: VariableSetup }>('POST', '/api/weights/location', { name, location }),
  addAxis: (tag: string, name: string, value: number) =>
    call<{ project: Project; variable: VariableSetup }>('POST', '/api/axes', { tag, name, value }),
  deleteAxis: (tag: string) =>
    call<{ project: Project; variable: VariableSetup }>('POST', '/api/axes/delete', { tag }),
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
