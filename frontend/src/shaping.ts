import * as hb from 'harfbuzzjs'

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
   * Shape one line. Direction is guessed from the text (Hebrew -> RTL), and
   * HarfBuzz returns RTL runs already in visual (left-to-right) order.
   */
  shape(text: string, features: Record<string, boolean> = {}): ShapedRun {
    const buffer = new hb.Buffer()
    buffer.addText(text)
    buffer.guessSegmentProperties()
    const feats = Object.entries(features)
      .map(([tag, on]) => hb.Feature.fromString(on ? tag : `-${tag}`))
      .filter((f): f is hb.Feature => f !== undefined)
    hb.shape(this.font, buffer, feats)

    const infos = buffer.getGlyphInfos()
    const positions = buffer.getGlyphPositions()
    const glyphs: ShapedGlyph[] = []
    let pen = 0
    infos.forEach((info, i) => {
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
    return { glyphs, width: pen }
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
