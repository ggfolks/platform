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

/** Makes and strokes a simple arc path between three points. */
export function strokeArcPath (canvas :CanvasRenderingContext2D,
                               x1 :number, y1 :number,
                               x2 :number, y2 :number,
                               x3 :number, y3 :number,
                               radius :number, lineWidth :number) {
  if (lineWidth === 0) return
  canvas.lineWidth = lineWidth
  canvas.beginPath()
  canvas.moveTo(x1, y1)
  canvas.arcTo(x2, y2, x3, y3, radius)
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
