/** Creates a rectangle path in `canvas` given the supplied config. */
export function makeRectPath (canvas :CanvasRenderingContext2D,
                              x :number, y :number, w :number, h :number) {
  canvas.beginPath()
  canvas.moveTo(x, y)
  canvas.lineTo(x+w, y)
  canvas.lineTo(x+w, y+h)
  canvas.lineTo(x, y+h)
  canvas.closePath()
}

/** Creates a rounded rectangle path in `canvas` given the supplied config. */
export function makeRoundRectPath (canvas :CanvasRenderingContext2D,
                                   x :number, y :number, w :number, h :number,
                                   radius :number) {
  const midx = x+w/2, midy = y+h/2, maxx = x+w, maxy = y+h
  canvas.beginPath()
  canvas.moveTo(x, midy)
  canvas.arcTo(x, y, midx, y, radius)
  canvas.arcTo(maxx, y, maxx, midy, radius)
  canvas.arcTo(maxx, maxy, midx, maxy, radius)
  canvas.arcTo(x, maxy, x, midy, radius)
  canvas.closePath()
}
