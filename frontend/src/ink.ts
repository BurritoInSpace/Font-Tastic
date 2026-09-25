/**
 * Horizontal extent of a glyph's ink within a height band, e.g. between the
 * baseline and cap height. Unlike the bounding box, this ignores parts
 * outside the band (a lamed's ascender, a final letter's descender), which is
 * what spacing is judged on.
 *
 * Paths are in font units, y up. Measured by sampling points along the
 * outline with the browser's SVG geometry, so curves count exactly as drawn.
 */

export interface Extent {
  xMin: number
  xMax: number
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const cache = new Map<string, Extent | null>()
let host: SVGSVGElement | null = null

function measuringPath(d: string): SVGPathElement {
  if (!host) {
    host = document.createElementNS(SVG_NS, 'svg')
    host.setAttribute('aria-hidden', 'true')
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden'
    document.body.appendChild(host)
  }
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', d)
  host.appendChild(path)
  return path
}

export function inkExtent(d: string, yLow: number, yHigh: number): Extent | null {
  const key = `${yLow}|${yHigh}|${d}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  let result: Extent | null = null
  if (d) {
    const path = measuringPath(d)
    try {
      const total = path.getTotalLength()
      const step = Math.max(total / 4000, 0.5)
      let xMin = Infinity
      let xMax = -Infinity
      for (let l = 0; l <= total + step; l += step) {
        const p = path.getPointAtLength(Math.min(l, total))
        if (p.y >= yLow && p.y <= yHigh) {
          if (p.x < xMin) xMin = p.x
          if (p.x > xMax) xMax = p.x
        }
      }
      if (xMin <= xMax) result = { xMin, xMax }
    } finally {
      path.remove()
    }
  }
  cache.set(key, result)
  return result
}
