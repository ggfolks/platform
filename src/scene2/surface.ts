import {mat2, mat2d, vec2, dim2, rect} from "../core/math"
import {DefaultTexConfig, GLC, RenderTarget, Texture, Tint, Tile, QuadBatch, checkError,
        createTexture, imageToTexture} from "./gl"

let _colorTex :Texture|null = null

function colorTex (glc :GLC) :Texture {
  if (_colorTex == null) {
    const scaled = new HTMLCanvasElement()
    scaled.width = 1
    scaled.height = 1
    const ctx = scaled.getContext("2d")
    if (!ctx) console.warn(`Failed to obtain Canvas2DContext`)
    else {
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, 1, 1)
    }
    _colorTex = imageToTexture(glc, scaled, DefaultTexConfig, createTexture(glc, DefaultTexConfig))
  }
  return _colorTex
}

/** Provides a simple drawing API to a GPU accelerated render target. This can be either the main
  * frame buffer, or a frame buffer bound to a texture.
  *
  * Note: all rendering operations to a surface must be enclosed in calls to [[Surface.begin]] and
  * [[Surface.end]]. This ensures that the batch into which the surface is rendering is properly
  * flushed to the GPU at the right times. */
export class Surface {
  private lastTrans = new mat2d()
  private readonly transformStack :mat2d[] = [this.lastTrans]
  private batch :QuadBatch

  private scissors :rect[] = []
  private scissorDepth = 0
  private _tint = Tint.NOOP_TINT
  private fillColor = 0
  private patternTex :Texture|null = null

  private checkIntersection = false
  private intersectionTestPoint = vec2.create()
  private intersectionTestSize = vec2.create()

  /** Creates a surface which will render to `target` using `defaultBatch` as its default quad
    * renderer. */
  constructor (readonly target :RenderTarget, defaultBatch :QuadBatch) {
    this.scale(target.scale)
    this.batch = defaultBatch
  }

  get glc () :GLC { return this.batch.glc }

  /** Configures this surface to check the bounds of drawn [[Tile]]s to ensure that they intersect
    * our visible bounds before adding them to our GPU batch. If you draw a lot of totally out of
    * bounds images, this may increase your draw performance. */
  setCheckIntersection (checkIntersection :boolean) {
    this.checkIntersection = checkIntersection
  }

  /** Starts a series of drawing commands to this surface. */
  begin () :Surface {
    this.target.bind()
    this.beginBatch(this.batch)
    return this
  }

  /** Completes a series of drawing commands to this surface. */
  end () :Surface {
    this.batch.end()
    return this
  }

  /** Configures this surface to use `batch`.
    * @return a batch to pass to [[popBatch]] when rendering is done with this batch. */
  pushBatch (newBatch :QuadBatch) :QuadBatch {
    const oldBatch = this.batch
    oldBatch.end()
    this.batch = this.beginBatch(newBatch)
    return oldBatch
  }

  /** Restores the batch that was in effect prior to a [[pushBatch]] call. */
  popBatch (oldBatch :QuadBatch) {
    if (oldBatch != null) {
      this.batch.end()
      this.batch = this.beginBatch(oldBatch)
    }
  }

  /** The current transform. */
  get tx () :mat2d {
    return this.lastTrans
  }

  /** Saves the current transform. */
  saveTx () :Surface {
    this.transformStack.push(this.lastTrans = mat2d.clone(this.lastTrans))
    return this
  }

  /** Restores the transform previously stored by [[saveTx]]. */
  restoreTx () :Surface {
    if (this.transformStack.length <= 1) throw new Error("Unbalanced save/restore")
    this.transformStack.pop()
    this.lastTrans = this.transformStack[this.transformStack.length-1]
    return this
  }

  /** Starts a series of drawing commands that are clipped to the specified rectangle (in view
    * coordinates, not OpenGL coordinates). Thus must be followed by a call to [[endClipped]] when
    * the clipped drawing commands are done.
    *
    * @return whether the resulting clip rectangle is non-empty. _Note:_ the caller may wish to skip
    * their drawing if this returns false, but they must still call [[endClipped]]. */
  startClipped (x :number, y :number, width :number, height :number) :boolean {
    const batch = this.batch
    batch.flush() // flush any pending unclipped calls
    const sy = this.target.flip ? this.target.size[1]-y-height : y
    const r = this.pushScissorState(x, sy, width, height)
    batch.glc.scissor(r[0], r[1], r[2], r[3])
    if (this.scissorDepth == 1) batch.glc.enable(GLC.SCISSOR_TEST)
    checkError(batch.glc, "startClipped")
    return !rect.isEmpty(r)
  }

  /** Ends a series of drawing commands that were clipped per a call to [[startClipped]]. */
  endClipped () {
    const batch = this.batch
    batch.flush() // flush our clipped calls with SCISSOR_TEST still enabled
    const r = this.popScissorState()
    if (r == null) batch.glc.disable(GLC.SCISSOR_TEST)
    else batch.glc.scissor(r[0], r[1], r[2], r[3])
    checkError(batch.glc, "endClipped")
  }

  /** Translates the current transformation matrix by the given amount. */
  translate (v :vec2) :Surface {
    mat2d.translate(this.tx, this.tx, v)
    return this
  }

  /** Scales the current transformation matrix by the specified amount on each axis. */
  scale (sv :vec2) :Surface {
    mat2d.scale(this.tx, this.tx, sv)
    return this
  }

  /** Rotates the current transformation matrix by the specified angle in radians. */
  rotate (angle :number) :Surface {
    mat2d.rotate(this.tx, this.tx, angle)
    return this
  }

  /** Multiplies the current transformation matrix by the given matrix. */
  transform (xf :mat2d) :Surface {
    mat2d.multiply(this.tx, this.tx, xf)
    return this
  }

  /** Concatenates `xf` onto this surface's transform, accounting for the `origin`. */
  concatenate (xf :mat2d, origin :vec2) :Surface {
    mat2d.multiply(this.tx, this.tx, xf)
    vec2.negate(origin, origin)
    mat2d.translate(this.tx, this.tx, origin)
    vec2.negate(origin, origin)
    return this
  }

  /** Pre-concatenates `xf` onto this surface's transform. */
  preConcatenate (xf :mat2d) :Surface {
    mat2d.multiply(this.tx, xf, this.tx)
    return this
  }

  /** Returns the currently configured alpha. */
  get alpha () :number {
    return Tint.getAlpha(this._tint)
  }

  /** Set the alpha component of this surface's current tint. Note that this value will be quantized
    * to an integer between 0 and 255. Also see [setTint]]. Values outside the range `[0,1]` will be
    * clamped to the range `[0,1]`.
    * @param alpha value in range `[0,1]` where 0 is transparent and 1 is opaque.
    */
  setAlpha (alpha :number) :Surface {
    this._tint = Tint.setAlpha(this._tint, alpha)
    return this
  }

  /** Returns the currently configured tint. */
  get tint () :number {
    return this._tint
  }

  /** Sets the tint to be applied to draw operations, as `ARGB`. _NOTE:_ this will overwrite any
    * value configured via [[setAlpha]]. Either include your desired alpha in the high bits of
    * `tint` or call [[setAlpha]] after calling this method. */
  setTint (tint :number) :Surface {
    this._tint = tint
    return this
  }

  /** Combines `tint` with the current tint via [[Tint.combine]].
    * @return the tint prior to combination. */
  combineTint (tint :number) :number {
    const otint = this._tint
    if (tint != Tint.NOOP_TINT) this._tint = Tint.combine(tint, otint)
    return otint
  }

  /** Sets the color to be used for fill operations. This replaces any existing fill color or
    * pattern. */
  setFillColor (color :number) :Surface {
    // TODO: add this to state stack
    this.fillColor = color
    this.patternTex = null
    return this
  }

  /** Sets the texture to be used for fill operations. This replaces any existing fill color or
    * pattern. */
  setFillPattern (texture :Texture) :Surface {
    // TODO: add fill pattern to state stack
    this.patternTex = texture
    return this
  }

  /** Returns whether the given rectangle intersects the render target area of this surface. */
  intersects (pos :vec2, size :dim2) :boolean {
    // scale, rotate, translate
    const pt = vec2.transformMat2d(this.intersectionTestPoint, pos, this.tx)
    // scale & rotate only
    const ps = vec2.transformMat2(this.intersectionTestSize, size as vec2, this.tx as any as mat2)

    if (this.scissorDepth > 0) {
      const scissor = this.scissors[this.scissorDepth - 1]
      return rect.intersectsPS(scissor, pt, ps)
    }

    const [ix, iy] = pt, [iw, ih] = ps, [tw, th] = this.target.size
    return (ix + iw > 0) && (ix < tw) && (iy + ih > 0) && (iy < th)
  }

  /** Clears the entire surface to transparent blackness. */
  clearToBlack () :Surface { return this.clearTo(0, 0, 0, 0) }

  /** Clears the entire surface to the specified color.
    * The channels are values in the range `[0,1]`. */
  clearTo (red :number, green :number, blue :number, alpha :number) :Surface {
    const glc = this.batch.glc
    glc.clearColor(red, green, blue, alpha)
    glc.clear(GLC.COLOR_BUFFER_BIT)
    return this
  }

  /** Draws `tile` at the specified `pos` and `size`. */
  draw (tile :Tile, pos :vec2, size :dim2) :Surface {
    return this.drawTint(tile, this.tint, pos, size)
  }

  /** Draws `tile` at the specified `pos` and `size`, with `tint`. _Note:_ this will override any
    * tint and alpha currently configured on this surface. */
  drawTint (tile :Tile, tint :number, pos :vec2, size :dim2) {
    if (!this.checkIntersection || this.intersects(pos, size)) {
      tile.addToBatch(this.batch, tint, this.tx, pos, size)
    }
    return this
  }

  /** Draws a region of `tile` (defined by `spos` and `ssize`) scaled to fit into `size`
    * at `pos`. */
  drawSub (tile :Tile, pos :vec2, size :dim2, spos :vec2, ssize :dim2) :Surface {
    if (!this.checkIntersection || this.intersects(pos, size)) {
      tile.addSubToBatch(this.batch, this.tint, this.tx, pos, size, spos, ssize)
    }
    return this
  }

  /**
   * Draws a scaled subset of an image (defined by {@code (sx, sy)} and {@code (w x h)}) at the
   * specified location {@code (dx, dy)} and size {@code (dw x dh)}, with tint {@code tint}.
   * <em>Note:</em> this will override any tint and alpha currently configured on this surface.
   */
  drawSubTint (tile :Tile, tint :number, pos :vec2, size :dim2, spos :vec2, ssize :dim2) :Surface {
    if (!this.checkIntersection || this.intersects(pos, size)) {
      tile.addSubToBatch(this.batch, tint, this.tx, pos, size, spos, ssize)
    }
    return this
  }

  /** Draws a tile at the specified `pos`. */
  drawAt (tile :Tile, pos :vec2) :Surface {
    return this.draw(tile, pos, tile.size)
  }

  /** Draws `tile`, centered at the specified `pos`. */
  drawCentered (tile :Tile, pos :vec2) :Surface {
    const hsize = dim2.scale(dim2.create(), tile.size, 0.5)
    return this.drawAt(tile, vec2.sub(hsize as vec2, pos, hsize as vec2))
  }

  /** Fills a line between `a` and `b`, with the specified (display unit) `width`. */
  drawLine (a :vec2, b :vec2, width :number) :Surface {
  // drawLineXY (float x0, float y0, float bx, float y1, float width) {
    // swap the line end points if bx is less than x0
    const swap = b[0] < a[0]
    const [ax, ay] = swap ? b : a, [bx, by] = swap ? a : b

    const dx = bx - ax, dy = by - ay
    const length = Math.sqrt(dx * dx + dy * dy)
    const wx = dx * (width / 2) / length
    const wy = dy * (width / 2) / length

    const xf = mat2d.fromRotation(mat2d.create(), Math.atan2(dy, dx))
    mat2d.translate(xf, xf, vec2.fromValues(ax + wy, ay - wx))
    mat2d.multiply(xf, this.tx, xf)

    const [tex, tint] = this.patternTex == null ?
      [colorTex(this.glc), Tint.combine(this.fillColor, this.tint)] :
      [this.patternTex, this.tint]
    this.batch.addTexQuad(tex, tint, xf, 0, 0, length, width)
    return this
  }

  /** Fills the specified rectangle. */
  fillRect (pos :vec2, size :dim2) :Surface {
    const [tex, tint] = this.patternTex == null ?
      [colorTex(this.glc), Tint.combine(this.fillColor, this.tint)] :
      [this.patternTex, this.tint]
    this.batch.addTexQuad(tex, tint, this.tx, pos[0], pos[1], size[0], size[1])
    return this
  }

  private beginBatch (batch :QuadBatch) :QuadBatch {
    batch.begin(this.target.size, this.target.flip)
    return batch
  }

  private pushScissorState (x :number, y :number, width :number, height :number) :rect {
    // grow the scissors buffer if necessary
    const {scissors, scissorDepth} = this
    if (scissorDepth == scissors.length) scissors.push(rect.create())

    const r = scissors[scissorDepth]
    if (scissorDepth == 0) rect.set(r, x, y, width, height)
    else {
      // intersect current with previous
      const pr = scissors[scissorDepth - 1]
      rect.set(r, Math.max(pr[0], x), Math.max(pr[1], y),
               Math.max(Math.min(rect.right(pr), x + width - 1) - r[0], 0),
               Math.max(Math.min(rect.bottom(pr), y + height - 1) - r[1], 0))
    }
    this.scissorDepth += 1
    return r
  }

  private popScissorState () :rect|null {
    this.scissorDepth -= 1
    return this.scissorDepth == 0 ? null : this.scissors[this.scissorDepth - 1]
  }
}
