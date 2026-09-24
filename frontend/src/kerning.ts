import type { Glyph, Project } from './api'

/**
 * Kerning pairs are in reading order: `first` is the right-hand glyph in
 * Hebrew. Either side can be a glyph or a group of that side:
 * side 1 groups ("public.kern1.x") hold first glyphs, side 2 groups second.
 */
export type Side = 1 | 2

export const groupKey = (side: Side, name: string) => `public.kern${side}.${name}`

export function parseGroupKey(key: string): { side: Side; name: string } | null {
  const m = /^public\.kern([12])\.(.+)$/.exec(key)
  return m ? { side: Number(m[1]) as Side, name: m[2] } : null
}

export const pairKey = (first: string, second: string) => `${first} ${second}`

/** The group a glyph belongs to on one side, if any. */
export function groupOf(project: Project, side: Side, glyph: string): string | null {
  for (const [name, members] of Object.entries(project.kernGroups[`${side}`])) {
    if (members.includes(glyph)) return name
  }
  return null
}

export interface Resolved {
  value: number
  /** the stored pair the value comes from, or null when the pair isn't kerned */
  source: [string, string] | null
}

/**
 * The value the compiled font uses for a glyph pair: the most specific stored
 * pair wins (glyph+glyph, glyph+group, group+glyph, group+group), matching
 * how ufo2ft compiles UFO kerning.
 */
export function resolveKern(
  project: Project,
  table: Map<string, number>,
  first: string,
  second: string,
): Resolved {
  const g1 = groupOf(project, 1, first)
  const g2 = groupOf(project, 2, second)
  const candidates: [string, string][] = [[first, second]]
  if (g2) candidates.push([first, groupKey(2, g2)])
  if (g1) candidates.push([groupKey(1, g1), second])
  if (g1 && g2) candidates.push([groupKey(1, g1), groupKey(2, g2)])
  for (const c of candidates) {
    const v = table.get(pairKey(c[0], c[1]))
    if (v !== undefined) return { value: v, source: c }
  }
  return { value: 0, source: null }
}

/** Glyphs a pair side covers: one glyph, or every member of a group. */
export function membersOf(project: Project, key: string): string[] {
  const g = parseGroupKey(key)
  return g ? project.kernGroups[`${g.side}`][g.name] ?? [] : [key]
}

/** Short label for a pair side: "@round" for groups, the character for glyphs. */
export function sideLabel(byName: Map<string, Glyph>, key: string): string {
  const g = parseGroupKey(key)
  if (g) return `@${g.name}`
  const glyph = byName.get(key)
  return glyph?.char || key
}

/** Default name for a new group started from a glyph: "bet", else the glyph name. */
export function defaultGroupName(project: Project, side: Side, glyph: Glyph): string {
  const base = (glyph.niceName ?? glyph.name).replace(/[^A-Za-z0-9_.-]/g, '_')
  const taken = project.kernGroups[`${side}`]
  let name = base
  for (let n = 2; name in taken; n++) name = `${base}${n}`
  return name
}
