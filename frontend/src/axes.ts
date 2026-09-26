import type { AxisDef } from './api'

export type Location = Record<string, number>

/** OpenType weight classes and their usual names (matches the backend). */
export const WEIGHT_NAMES: [number, string][] = [
  [100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'],
  [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black'],
]

/** Common values to offer per axis: [value, name]. */
export const SUGGESTED: Record<string, [number, string][]> = {
  wght: WEIGHT_NAMES,
  wdth: [[50, 'UltraCondensed'], [62.5, 'ExtraCondensed'], [75, 'Condensed'], [87.5, 'SemiCondensed'],
    [100, 'Normal'], [112.5, 'SemiExpanded'], [125, 'Expanded'], [150, 'ExtraExpanded'], [200, 'UltraExpanded']],
  opsz: [[6, 'Caption'], [9, 'Small'], [12, 'Text'], [18, 'Subhead'], [36, 'Display'], [72, 'Poster']],
  slnt: [[-15, 'Slanted'], [-12, 'Slanted'], [-8, 'Slanted'], [0, 'Upright']],
  ital: [[0, 'Upright'], [1, 'Italic']],
  GRAD: [[-50, 'Lighter grade'], [0, 'Normal'], [100, 'Heavier grade']],
}

/** e.g. "700, wdth 75": weight bare, the other axes by tag. */
export function describeLocation(axes: AxisDef[], location: Location): string {
  return axes
    .filter((a) => location[a.tag] !== undefined)
    .map((a) => (a.tag === 'wght' ? `${location[a.tag]}` : `${a.tag} ${location[a.tag]}`))
    .join(', ')
}

export function sameLocation(axes: AxisDef[], a: Location, b: Location): boolean {
  return axes.every((x) => a[x.tag] === b[x.tag])
}

/**
 * A style name for a master at ``location``, e.g. "BoldCondensed" or
 * "Regular-opsz36". Weight and width use their standard names; other axes
 * away from their usual default add "-<tag><value>".
 */
export function suggestName(axes: AxisDef[], location: Location, defaults: Location): string {
  const named = (tag: string) => SUGGESTED[tag]?.find(([v]) => v === location[tag])?.[1]
  let base = ''
  const width = location.wdth !== undefined && location.wdth !== 100 ? named('wdth') ?? `Width${location.wdth}` : ''
  const weight = named('wght') ?? `W${location.wght}`
  base = width && location.wght === 400 ? width : `${weight}${width}`
  if (location.ital === 1) base += 'Italic'
  for (const a of axes) {
    if (['wght', 'wdth', 'ital'].includes(a.tag)) continue
    const v = location[a.tag]
    if (v === undefined || v === defaults[a.tag]) continue
    base += `-${a.tag}${String(v).replace('.', '_')}`
  }
  return base
}
