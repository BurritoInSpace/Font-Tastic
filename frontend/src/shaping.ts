import bidiFactory from 'bidi-js'
import * as hb from 'harfbuzzjs'

const bidi = bidiFactory()

export interface ShapedGlyph {
  gid: number
  name: string
  cluster: number
  /** pen position + offset, in font units, left-to-right visual order */
  x: number
  y: number
  advance: number
  path: string
}

export interface ShapedRun {
  glyphs: ShapedGlyph[]
  width: number
  /** the line's base direction (from its first letter, unless given) */
  rtl: boolean
}

/** A stretch of a line in one direction, [start, end) in UTF-16 units. */
interface DirectionRun {
  start: number
  end: number
  level: number
}

/**
 * Split a line into runs by bidi embedding level and put them in visual
 * (left-to-right on screen) order: rule L2 of the Unicode Bidirectional
 * Algorithm, reversing every sequence of runs at or above each odd level.
 */
function visualRuns(text: string, base: 'auto' | 'rtl' | 'ltr'): { runs: DirectionRun[]; rtl: boolean } {
  const { levels, paragraphs } = bidi.getEmbeddingLevels(text, base)
  const runs: DirectionRun[] = []
  for (let i = 0; i < text.length; i++) {
    const last = runs[runs.length - 1]
    if (last && last.level === levels[i]) last.end = i + 1
    else runs.push({ start: i, end: i + 1, level: levels[i] })
  }
  const odd = runs.map((r) => r.level).filter((l) => l % 2 === 1)
  if (odd.length) {
    const highest = Math.max(...runs.map((r) => r.level))
    for (let level = highest; level >= Math.min(...odd); level--) {
      for (let i = 0; i < runs.length; i++) {
        if (runs[i].level < level) continue
        let j = i
        while (j + 1 < runs.length && runs[j + 1].level >= level) j++
        runs.splice(i, j - i + 1, ...runs.slice(i, j + 1).reverse())
        i = j
      }
    }
  }
  return { runs, rtl: (paragraphs[0]?.level ?? 0) % 2 === 1 }
}

/** A compiled font loaded into HarfBuzz — the same shaper browsers and OSes use. */
export class ShapingFont {
  private font: hb.Font
  private paths = new Map<number, string>()

  constructor(data: ArrayBuffer) {
    const blob = new hb.Blob(data)
    const face = new hb.Face(blob, 0)
    this.font = new hb.Font(face)
  }

  /** Set variable-font axes, e.g. { wght: 550 }. Outlines are re-read after this. */
  setVariations(axes: Record<string, number>) {
    this.font.setVariations(Object.entries(axes).map(([tag, value]) => new hb.Variation(tag, value)))
    this.paths.clear()
  }

  /**
   * Shape one line of text, which may mix directions (Hebrew with Latin,
   * digits in Hebrew...). The Unicode Bidirectional Algorithm splits it into
   * right-to-left and left-to-right runs; each is shaped by HarfBuzz in its
   * own direction (with the whole line as context) and the runs are laid out
   * in visual order. The line's base direction comes from its first letter
   * unless ``base`` says otherwise.
   */
  shape(text: string, features: Record<string, boolean> = {}, base: 'auto' | 'rtl' | 'ltr' = 'auto'): ShapedRun {
    const feats = Object.entries(features)
      .map(([tag, on]) => hb.Feature.fromString(on ? tag : `-${tag}`))
      .filter((f): f is hb.Feature => f !== undefined)
    const { runs, rtl } = visualRuns(text, base)
    const glyphs: ShapedGlyph[] = []
    let pen = 0
    for (const run of runs) {
      const buffer = new hb.Buffer()
      buffer.addText(text, run.start, run.end - run.start)
      buffer.guessSegmentProperties()
      buffer.setDirection(run.level % 2 === 1 ? hb.Direction.RTL : hb.Direction.LTR)
      hb.shape(this.font, buffer, feats)
      const positions = buffer.getGlyphPositions()
      buffer.getGlyphInfos().forEach((info, i) => {
        const pos = positions[i]
        glyphs.push({
          gid: info.codepoint,
          name: this.font.glyphName(info.codepoint),
          cluster: info.cluster,
          x: pen + pos.xOffset,
          y: pos.yOffset,
          advance: pos.xAdvance,
          path: this.path(info.codepoint),
        })
        pen += pos.xAdvance
      })
    }
    return { glyphs, width: pen, rtl }
  }

  private path(gid: number): string {
    let p = this.paths.get(gid)
    if (p === undefined) {
      p = this.font.glyphToPath(gid)
      this.paths.set(gid, p)
    }
    return p
  }
}
