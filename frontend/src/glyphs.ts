import type { Glyph, Project } from './api'

export const STANDARD_ANCHORS = ['top', 'bottom', 'dagesh', 'shindot', 'sindot']

export type Section = 'Letters' | 'Marks' | 'Alternates & ligatures' | 'Other'

export function sectionOf(g: Glyph): Section {
  if (g.category === 'mark') return 'Marks'
  if (g.category === 'ligature' || (g.unicode === null && g.name.includes('.') && !g.name.startsWith('.')))
    return 'Alternates & ligatures'
  if (g.unicode !== null && g.unicode >= 0x05d0 && g.unicode <= 0x05ea) return 'Letters'
  return 'Other'
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

/** Marks that attach to a given base anchor name (`top` -> marks with `_top`). */
export function marksFor(project: Project, anchorName: string): Glyph[] {
  return project.glyphs.filter((g) => g.anchors.some((a) => a.name === `_${anchorName}`))
}

/** Bases that offer an anchor a mark attaches to (`_top` -> bases with `top`). */
export function basesFor(project: Project, markAnchor: string): Glyph[] {
  const name = markAnchor.replace(/^_/, '')
  return project.glyphs.filter(
    (g) => g.category !== 'mark' && g.anchors.some((a) => a.name === name),
  )
}
