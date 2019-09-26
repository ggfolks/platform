/** Creates a rounded rectangle path in `canvas` given the supplied config. */
export function makeRoundRectPath (canvas :CanvasRenderingContext2D,
                                   x :number, y :number, w :number, h :number,
                                   radius :number|number[]) {
  const midx = x+w/2, midy = y+h/2, maxx = x+w, maxy = y+h
  canvas.beginPath()
  canvas.moveTo(x, midy)
  const r = Array.isArray(radius) ? radius : [radius, radius, radius, radius]
  canvas.arcTo(x, y, midx, y, r[0])
  canvas.arcTo(maxx, y, maxx, midy, r[1])
  canvas.arcTo(maxx, maxy, midx, maxy, r[2])
  canvas.arcTo(x, maxy, x, midy, r[3])
  canvas.closePath()
}

/** Makes and strokes one side of a rounded rectangle. */
export function strokeRoundRectSide (canvas :CanvasRenderingContext2D,
                                     x1 :number, y1 :number, x2 :number, y2 :number,
                                     r1 :number, r2 :number, lineWidth :number) {
  if (lineWidth === 0) return
  canvas.lineWidth = lineWidth
  canvas.beginPath()
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const cosa = Math.cos(angle)
  const sina = Math.sin(angle)
  const sx = x1 + cosa * r1
  const sy = y1 + sina * r1
  canvas.arc(sx - sina * r1, sy + cosa * r1, r1, angle - 3 * Math.PI / 4, angle - Math.PI / 2)
  canvas.moveTo(sx, sy)
  const ex = x2 - cosa * r2
  const ey = y2 - sina * r2
  canvas.lineTo(ex, ey)
  canvas.arc(ex - sina * r2, ey + cosa * r2, r2, angle - Math.PI / 2, angle - Math.PI / 4)
  canvas.stroke()
}

/** Makes and strokes a simple line path from one point to another. */
export function strokeLinePath (canvas :CanvasRenderingContext2D,
                                x1 :number, y1 :number, x2 :number, y2 :number,
                                lineWidth :number) {
  if (lineWidth === 0) return
  canvas.lineWidth = lineWidth
  canvas.beginPath()
  canvas.moveTo(x1, y1)
  canvas.lineTo(x2, y2)
  canvas.stroke()
}
