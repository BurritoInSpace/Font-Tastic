import type { Project, UploadAnalysis } from './api'
import { charsToGlyphs } from './glyphs'

export const ALTERNATE_FEATURES = ['salt', ...Array.from({ length: 20 }, (_, i) => `ss${String(i + 1).padStart(2, '0')}`)]
export const LIGATURE_FEATURES = ['liga', 'dlig', ...ALTERNATE_FEATURES.slice(1)]

/** What the user said about one file. */
export interface Decision {
  /** what the file is: as its name says, a typed character, an alternate, a ligature */
  identity: 'named' | 'char' | 'alternate' | 'ligature' | 'skip'
  char: string
  base: string
  feature: string
  letters: string
  ligFeature: string
  /** what to do when the glyph already exists; null until the user answers */
  onDuplicate: 'replace' | 'alternate' | 'skip' | null
  dupFeature: string
}

export type Resolution =
  | { kind: 'add'; glyphName: string; note: string }
  | { kind: 'replace'; glyphName: string; note: string }
  | { kind: 'skip'; note: string }
  | { kind: 'incomplete'; note: string }

export interface Planned {
  resolution: Resolution
  /** set when the target glyph already exists and the user must choose */
  duplicateOf: string | null
  /** duplicates of another file in this same import can't be "replaced" */
  duplicateInBatch: boolean
  /** ligatures can't become stylistic alternates */
  canAlternate: boolean
}

export function initialDecision(a: UploadAnalysis): Decision {
  return {
    identity: a.status === 'invalid' ? 'skip' : a.status === 'unknown' ? 'char' : 'named',
    char: '',
    base: '',
    feature: 'salt',
    letters: '',
    ligFeature: 'liga',
    onDuplicate: null,
    dupFeature: 'salt',
  }
}

export function canonicalName(cp: number): string {
  const hex = cp.toString(16).toUpperCase()
  return cp <= 0xffff ? `uni${hex.padStart(4, '0')}` : `u${hex.padStart(5, '0')}`
}

/** "א", "U+05D0", "05D0" or "0x05D0" -> code point */
export function parseChar(input: string): number | null {
  const t = input.trim()
  if (!t) return null
  const chars = [...t]
  if (chars.length === 1) return chars[0].codePointAt(0)!
  const m = /^(?:u\+?|0x|uni)?([0-9a-f]{4,6})$/i.exec(t)
  if (m) {
    const cp = parseInt(m[1], 16)
    return cp <= 0x10ffff ? cp : null
  }
  return null
}

export function nextAlternateName(base: string, feature: string, taken: Set<string>): string {
  let name = `${base}.${feature}`
  for (let n = 2; taken.has(name); n++) name = `${base}.${feature}.${n}`
  return name
}

/**
 * Resolve every file in order. Names claimed by earlier files count as taken,
 * so two files can't silently land on the same glyph.
 */
export function plan(project: Project, analyses: UploadAnalysis[], decisions: Decision[]): Planned[] {
  const inFont = new Set(project.glyphs.map((g) => g.name))
  const cmap = new Map(project.glyphs.filter((g) => g.unicode !== null).map((g) => [g.unicode!, g.name]))
  const claimed = new Set<string>()
  const taken = () => new Set([...inFont, ...claimed])

  return analyses.map((a, i) => {
    const d = decisions[i]
    const out = (resolution: Resolution, extra: Partial<Planned> = {}): Planned => {
      if (resolution.kind === 'add' || resolution.kind === 'replace') claimed.add(resolution.glyphName)
      return { resolution, duplicateOf: null, duplicateInBatch: false, canAlternate: true, ...extra }
    }

    if (a.status === 'invalid') return out({ kind: 'skip', note: 'Will be skipped' })
    if (d.identity === 'skip') return out({ kind: 'skip', note: 'Skipped' })

    let target: string
    let isLigature = false
    switch (d.identity) {
      case 'named':
        target = a.glyphName!
        isLigature = target.split('.')[0].includes('_')
        break
      case 'char': {
        const cp = parseChar(d.char)
        if (cp === null) return out({ kind: 'incomplete', note: 'Type the character (or its code, like U+05D0)' })
        target = cmap.get(cp) ?? canonicalName(cp)
        break
      }
      case 'alternate': {
        if (!d.base) return out({ kind: 'incomplete', note: 'Pick the glyph this is an alternate of' })
        const name = nextAlternateName(d.base.split('.')[0], d.feature, taken())
        return out({ kind: 'add', glyphName: name, note: `New ${d.feature} alternate` })
      }
      case 'ligature': {
        const comps = charsToGlyphs(project, d.letters)
        if (!comps || comps.length < 2)
          return out({ kind: 'incomplete', note: 'Type two or more letters that are already in the font' })
        target = `${comps.join('_')}.${d.ligFeature}`
        isLigature = true
        break
      }
    }

    const inBatch = claimed.has(target)
    if (!inFont.has(target) && !inBatch) return out({ kind: 'add', glyphName: target, note: 'New glyph' })

    // The glyph already exists: the user decides.
    const extra = { duplicateOf: target, duplicateInBatch: inBatch, canAlternate: !isLigature }
    const choice = d.onDuplicate === 'replace' && inBatch ? null : d.onDuplicate
    if (choice === 'replace') {
      return out({ kind: 'replace', glyphName: target, note: 'Replaces the outline; anchors and spacing are kept' }, extra)
    }
    if (choice === 'alternate' && !isLigature) {
      const name = nextAlternateName(target.split('.')[0], d.dupFeature, taken())
      return out({ kind: 'add', glyphName: name, note: `New ${d.dupFeature} alternate` }, extra)
    }
    if (choice === 'skip') return out({ kind: 'skip', note: 'Skipped' }, extra)
    return out(
      {
        kind: 'incomplete',
        note: inBatch
          ? 'Another file in this import is the same glyph: add it as an alternate, or skip it'
          : 'Replace the existing glyph, or keep both as a stylistic alternate?',
      },
      extra,
    )
  })
}
