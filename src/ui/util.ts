/** Creates a rectangle path in `canvas` given the supplied config. */
export function makeRectPath (canvas :CanvasRenderingContext2D,
                              x :number, y :number, w :number, h :number) {
  canvas.beginPath()
  canvas.rect(x, y, w, h)
}

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
