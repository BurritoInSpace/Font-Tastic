import type { PointContour, PointOrder } from '../api'

/** One colour per contour, so the same contour is easy to find in both weights. */
export const CONTOUR_COLOURS = ['#5a76d2', '#e0685c', '#3f9e6e', '#c9912a', '#a45ac9', '#2f9fb5']
const colour = (i: number) => CONTOUR_COLOURS[i % CONTOUR_COLOURS.length]

/** Where the contour heads from its first point: toward the next point that isn't on top of it. */
function heading(c: PointContour): { x: number; y: number } | null {
  const [x0, y0] = c.points[0]
  for (const [x, y] of c.points.slice(1)) {
    const len = Math.hypot(x - x0, y - y0)
    if (len > 0.5) return { x: (x - x0) / len, y: (y - y0) / len }
  }
  return null
}

/** Markers, in the canvas's flipped (y-up) group. Clicking an on-curve point makes it the start point. */
export function PointMarks({ contours, scale = 1, onPick }: {
  contours: PointContour[]
  scale?: number
  onPick?: (contour: number, point: number) => void
}) {
  return (
    <g className="point-marks">
      {contours.map((c, ci) => {
        const dir = heading(c)
        const [sx, sy] = c.points[0] ?? [0, 0]
        const arrow = 70 * scale
        return (
          <g key={ci} style={{ color: colour(ci) }}>
            <polygon className="point-path" points={c.points.map(([x, y]) => `${x},${y}`).join(' ')} />
            {dir && (
              <g className="start-arrow">
                <line x1={sx} y1={sy} x2={sx + dir.x * arrow} y2={sy + dir.y * arrow} />
                <polygon points={[
                  [sx + dir.x * arrow, sy + dir.y * arrow],
                  [sx + dir.x * (arrow - 22 * scale) - dir.y * 12 * scale, sy + dir.y * (arrow - 22 * scale) + dir.x * 12 * scale],
                  [sx + dir.x * (arrow - 22 * scale) + dir.y * 12 * scale, sy + dir.y * (arrow - 22 * scale) - dir.x * 12 * scale],
                ].map((p) => p.join(',')).join(' ')} />
              </g>
            )}
            <circle className="start-ring" cx={sx} cy={sy} r={26 * scale} />
            {c.points.map(([x, y, kind], pi) => kind === null
              ? <circle key={pi} className="off-point" cx={x} cy={y} r={7 * scale} />
              : (
                <circle key={pi} className={`on-point${onPick && c.closed && pi > 0 ? ' pickable' : ''}`}
                  cx={x} cy={y} r={12 * scale}
                  onPointerDown={onPick ? (e) => e.stopPropagation() : undefined}
                  onClick={onPick && c.closed && pi > 0 ? () => onPick(ci, pi) : undefined}>
                  <title>{`Contour ${ci + 1}, point ${pi + 1}${pi === 0 ? ' (start)' : c.closed ? ': click to start here' : ''}`}</title>
                </circle>
              ))}
          </g>
        )
      })}
    </g>
  )
}

/**
 * Numbers, drawn outside the flipped group so text reads upright. Each contour's on-curve
 * points are counted from 1 at its start point, which also gets a contour tag (C1, C2...).
 */
export function PointLabels({ contours, offset = { x: 0, y: 0 }, scale = 1 }: {
  contours: PointContour[]
  offset?: { x: number; y: number }
  scale?: number
}) {
  return (
    <g className="point-labels">
      {contours.map((c, ci) => {
        let n = 0
        return (
          <g key={ci} style={{ fill: colour(ci) }}>
            {c.points.map(([x, y, kind], pi) => {
              if (kind === null) return null
              n += 1
              const label = (
                <text key={pi} className={pi === 0 ? 'start' : ''} fontSize={30 * scale}
                  x={x + offset.x + 16 * scale} y={-(y + offset.y) - 16 * scale}>
                  {n}
                </text>
              )
              if (pi !== 0) return label
              // The start point counts as 1 like any other; which contour it is goes in
              // its own tag on the other side, so it isn't read as a point number.
              return (
                <g key={pi}>
                  {label}
                  <text className="contour-tag" fontSize={24 * scale} textAnchor="end"
                    x={x + offset.x - 30 * scale} y={-(y + offset.y) + 34 * scale}>
                    C{ci + 1}
                  </text>
                </g>
              )
            })}
          </g>
        )
      })}
    </g>
  )
}

/** The default weight's version, small, with its contour numbers and start points to copy. */
export function ReferenceView({ reference }: { reference: NonNullable<PointOrder['reference']> }) {
  const [x0, y0, x1, y1] = reference.bounds ?? [0, 0, 100, 100]
  const pad = 60
  const w = x1 - x0 + pad * 2
  const h = y1 - y0 + pad * 2
  const scale = Math.max(w, h) / 500
  return (
    <svg className="reference-view" viewBox={`${x0 - pad} ${-y1 - pad} ${w} ${h}`}>
      <g transform="scale(1,-1)">
        <path className="outline" d={reference.path} />
        <PointMarks contours={reference.contours} scale={scale} />
      </g>
      <PointLabels contours={reference.contours} scale={scale} />
    </svg>
  )
}
