import {clamp, mat2, mat2d, dim2, rect, vec2, vec2zero} from "../core/math"
import {Color} from "../core/color"
import {GLC, RenderTarget, Texture, Tile, checkError, createTexture, imageToTexture} from "./gl"
import {QuadBatch} from "./batch"

function makeColorTex (glc :GLC) :Texture {
  const scaled = document.createElement("canvas")
  scaled.width = 1
  scaled.height = 1
  const ctx = scaled.getContext("2d")
  if (!ctx) console.warn(`Failed to obtain Canvas2DContext`)
  else {
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, 1, 1)
  }
  const tcfg = Texture.DefaultConfig
  return imageToTexture(glc, scaled, tcfg, createTexture(glc, tcfg))
}

const tmpmat = mat2d.create(), tmpdim = dim2.create()

/** Provides a simple drawing API to a GPU accelerated render target. This can be either the main
  * frame buffer, or a frame buffer bound to a texture.
  *
  * Note: all rendering operations to a surface must be enclosed in calls to [[Surface.begin]] and
  * [[Surface.end]]. This ensures that the batch into which the surface is rendering is properly
  * flushed to the GPU at the right times. */
export class Surface {
  private readonly transformStack :mat2d[] = []
  private nextTxPos = 0
  private batch :QuadBatch

  private scissors :rect[] = []
  private scissorDepth = 0
  private fillColor = Color.fromRGB(0, 0, 0)
  private tempColor = Color.fromRGB(0, 0, 0)
  private patternTex :Texture|null = null
  private _colorTex :Texture|null = null

  private checkIntersection = false
  private intersectionTestPoint = vec2.create()
  private intersectionTestSize = vec2.create()

  /** The current transform. */
  readonly tx = mat2d.create()

  /** Creates a surface which will render to `target` using `defaultBatch` as its default quad
    * renderer. */
  constructor (readonly target :RenderTarget, defaultBatch :QuadBatch) {
    this.batch = defaultBatch
  }

  /** A tint applied to all textured or filled quads (and lines). The tint color is combined with the color from the
    * texture or the fill color for a filled shape. Defaults to white which results in no tint. */
  readonly tint = Color.fromRGB(1, 1, 1)

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

  /** Saves the current transform. */
  saveTx () :Surface {
    const ts = this.transformStack, ntp = this.nextTxPos++
    const saveTx = ts[ntp] || (ts[ntp] = mat2d.create())
    mat2d.copy(saveTx, this.tx)
    return this
  }

  /** Restores the transform previously stored by [[saveTx]]. */
  restoreTx () :Surface {
    const ntp = this.nextTxPos
    if (ntp === 0) throw new Error("Unbalanced save/restore")
    this.nextTxPos -= 1
    mat2d.copy(this.tx, this.transformStack[ntp-1])
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
    const sfx = this.target.scale[0], sfy = this.target.scale[1]
    const sx = x*sfx, sy = y*sfy, swidth = width*sfx, sheight = height*sfy
    const fy = this.target.flip ? this.target.size[1]-sy-sheight : sy
    const r = this.pushScissorState(sx, fy, swidth, sheight)
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

  /** Concatenates `xf` onto this surface's transform, accounting for the `origin` if supplied. */
  concatenate (xf :mat2d, origin? :vec2) :Surface {
    mat2d.multiply(this.tx, this.tx, xf)
    if (origin) {
      vec2.negate(origin, origin)
      mat2d.translate(this.tx, this.tx, origin)
      vec2.negate(origin, origin)
    }
    return this
  }

  /** Pre-concatenates `xf` onto this surface's transform. */
  preConcatenate (xf :mat2d) :Surface {
    mat2d.multiply(this.tx, xf, this.tx)
    return this
  }

  /** Returns the currently configured alpha. */
  get alpha () :number {
    return this.tint[0]
  }

  /** Set the alpha component of this surface's current tint.
    * @param alpha value in range `[0,1]` where 0 is transparent and 1 is opaque. Values outside the range `[0,1]`
    * will be clamped to the range `[0,1]`. */
  setAlpha (alpha :number) :Surface {
    this.tint[0] = clamp(alpha, 0, 1)
    return this
  }

  /** Sets the color to be used for fill operations. This replaces any existing fill color or
    * pattern. */
  setFillColor (color :Color) :Surface {
    // TODO: add this to state stack
    Color.copy(this.fillColor, color)
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

    const ix = pt[0], iy = pt[1], iw = ps[0], ih = ps[1]
    const ts = this.target.size, tw = ts[0], th = ts[1]
    return (ix + iw > 0) && (ix < tw) && (iy + ih > 0) && (iy < th)
  }

  /** Clears the entire surface to transparent blackness. */
  clearToBlack () :Surface { return this.clearTo(0, 0, 0, 0) }

  /** Clears the entire surface to the specified color.
    * The channels are values in the range `[0,1]`. */
  clearTo (red :number, green :number, blue :number, alpha :number) :Surface {
    this.glc.clearColor(red, green, blue, alpha)
    this.glc.clear(GLC.COLOR_BUFFER_BIT)
    return this
  }

  /** Draws a tile at the specified `pos`. */
  drawAt (tile :Tile, pos :vec2) :Surface {
    return this.draw(tile, pos, tile.size)
  }

  /** Draws `tile` at the specified `pos` and `size`. */
  draw (tile :Tile, pos :vec2, size :dim2) :Surface {
    if (!this.checkIntersection || this.intersects(pos, size)) {
      this.batch.addTile(tile, this.tint, this.tx, pos, size)
    }
    return this
  }

  /** Draws `tile`, centered at the specified `pos`. */
  drawCentered (tile :Tile, pos :vec2) :Surface {
    const hsize = dim2.scale(dim2.create(), tile.size, 0.5)
    return this.drawAt(tile, vec2.sub(hsize as vec2, pos, hsize as vec2))
  }

  /** Fills a line between `a` and `b`, with the specified (display unit) `width`. */
  drawLine (a :vec2, b :vec2, width :number) :Surface {
    // swap the line end points if bx is less than x0
    const swap = b[0] < a[0], sa = swap ? b : a, sb = swap ? a : b
    const ax = sa[0], ay = sa[1], bx = sb[0], by = sb[1]

    const dx = bx - ax, dy = by - ay
    const length = Math.sqrt(dx * dx + dy * dy)
    const wx = dx * (width / 2) / length
    const wy = dy * (width / 2) / length

    const xf = mat2d.fromRotation(tmpmat, Math.atan2(dy, dx))
    xf[4] = ax + wy
    xf[5] = ay - wx
    mat2d.multiply(xf, this.tx, xf)

    const patTex = this.patternTex
    const tex = patTex == null ? this.colorTex : patTex
    const tint = patTex == null ?
      Color.combine(Color.copy(this.tempColor, this.fillColor), this.tint) : this.tint
    this.batch.addTexQuad(tex, tint, xf, vec2zero, dim2.set(tmpdim, length, width))
    return this
  }

  /** Fills the specified rectangle. */
  fillRect (pos :vec2, size :dim2) :Surface {
    const patTex = this.patternTex
    const tex = patTex == null ? this.colorTex : patTex
    const tint = patTex == null ?
      Color.combine(Color.copy(this.tempColor, this.fillColor), this.tint) : this.tint
    this.batch.addTexQuad(tex, tint, this.tx, pos, size)
    return this
  }

  private get colorTex () {
    if (this._colorTex != null) return this._colorTex
    return this._colorTex = makeColorTex(this.glc)
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
