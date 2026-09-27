import type { Glyph, Project } from './api'

/** Anchor names offered for a glyph: Hebrew has dagesh and the shin/sin dots too. */
export function standardAnchors(script: string | null): string[] {
  return script === 'Hebr' ? ['top', 'bottom', 'dagesh', 'shindot', 'sindot'] : ['top', 'bottom']
}

const SCRIPT_NAMES: Record<string, string> = { Hebr: 'Hebrew', Latn: 'Latin', Grek: 'Greek', Cyrl: 'Cyrillic' }
const SCRIPT_ORDER = ['Hebr', 'Latn', 'Grek', 'Cyrl']
export const scriptName = (code: string) => SCRIPT_NAMES[code] ?? code

/** Unicode's "common" (digits, punctuation, space) and "inherited" (combining accents) scripts. */
const COMMON = 'Zyyy'
const INHERITED = 'Zinh'

/** The glyph grid section a glyph goes in: one per script (letters, then its marks), then shared ones. */
export function sectionOf(g: Glyph): string {
  if (g.category === 'ligature' || (g.unicode === null && g.name.includes('.') && !g.name.startsWith('.')))
    return 'Alternates & ligatures'
  const s = g.script
  if (g.category === 'mark') return !s || s === INHERITED ? 'Accents' : `${scriptName(s)} marks`
  if (s === COMMON) return 'Numbers & punctuation'
  if (s && s !== INHERITED) return scriptName(s)
  return 'Other'
}

/** Section order: Hebrew, Latin, Greek, Cyrillic, other scripts, then the shared sections. */
export function sectionRank(section: string): [number, string] {
  const tail = ['Accents', 'Numbers & punctuation', 'Alternates & ligatures', 'Other']
  if (tail.includes(section)) return [1000 + tail.indexOf(section), section]
  const script = section.replace(/ marks$/, '')
  const code = Object.entries(SCRIPT_NAMES).find(([, n]) => n === script)?.[0] ?? script
  const i = SCRIPT_ORDER.indexOf(code)
  return [(i === -1 ? 100 : i) * 2 + (section.endsWith(' marks') ? 1 : 0), section]
}

export function glyphLabel(g: Glyph): string {
  if (g.unicode === null) return g.name
  return `U+${g.unicode.toString(16).toUpperCase().padStart(4, '0')}`
}

/** Map typed characters to glyph names through the font's cmap. */
export function charsToGlyphs(project: Project, text: string): string[] | null {
  const byCp = new Map(project.glyphs.filter((g) => g.unicode !== null).map((g) => [g.unicode!, g.name]))
  const names: string[] = []
  for (const ch of text) {
    if (ch.trim() === '') continue
    const name = byCp.get(ch.codePointAt(0)!)
    if (!name) return null
    names.push(name)
  }
  return names
}

/**
 * Whether a mark belongs with a base: the same script, or a shared base (digits...).
 * Combining accents (U+0300 block) are shared by Latin, Greek and Cyrillic, not by Hebrew.
 */
function sameScript(base: Glyph, mark: Glyph): boolean {
  if (!base.script || base.script === COMMON || !mark.script) return true
  if (mark.script === INHERITED) return base.script !== 'Hebr'
  return base.script === mark.script
}

/** Marks that attach to a given base anchor name (`top` -> marks with `_top`), of the base's script. */
export function marksFor(project: Project, anchorName: string, base?: Glyph): Glyph[] {
  return project.glyphs.filter((g) =>
    g.anchors.some((a) => a.name === `_${anchorName}`) && (!base || sameScript(base, g)))
}

/** Bases that offer an anchor a mark attaches to (`_top` -> bases with `top`), of the mark's script. */
export function basesFor(project: Project, markAnchor: string, mark?: Glyph): Glyph[] {
  const name = markAnchor.replace(/^_/, '')
  return project.glyphs.filter(
    (g) => g.category !== 'mark' && g.anchors.some((a) => a.name === name) && (!mark || sameScript(g, mark)),
  )
}
