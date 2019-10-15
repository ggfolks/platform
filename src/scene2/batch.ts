import {dim2, mat2d, vec2} from "../core/math"
import {Color} from "../core/color"
import {Disposable} from "../core/util"
import {GLC, Program, Renderer, Texture, Tile, checkError} from "./gl"

/** Manages the delivery of groups of drawing calls to the GPU. It is usually a combination of a
  * [[Program]] and one or more buffers. */
export class Batch implements Disposable {
  private begun = false // for sanity checking

  constructor (readonly glc :GLC) {}

  begin (fbufSize :dim2, flip :boolean) {
    if (this.begun) throw new Error(`${this.constructor.name} mismatched begin()`)
    this.begun = true
  }

  flush () {
    if (!this.begun) throw new Error(`${this.constructor.name} flush() without begin()`)
  }

  end () {
    if (!this.begun) throw new Error(`${this.constructor.name} mismatched end()`)
    try {
      this.flush()
    } finally {
      this.begun = false
    }
  }

  dispose () {
    if (this.begun) throw new Error(`${this.constructor.name} dispose() without end()`)
  }
}


const FRAGMENT_PREAMBLE = [
  "precision lowp float;"
]

/** Provides some standard bits for a shader program that uses a tint and a texture. */
export class TexturedBatchSource {

  /** Returns the source of the texture fragment shader program. Note that this program _must_
    * preserve the use of the existing varying attributes. You can add new varying attributes, but
    * you cannot remove or change the defaults. */
  fragment () :string[] {
    return FRAGMENT_PREAMBLE.
      concat(this.textureUniforms()).
      concat(this.textureVaryings()).
      concat("void main(void) {").
      concat(this.textureColor()).
      concat(this.textureTint()).
      concat(this.textureAlpha()).
      concat("  gl_FragColor = textureColor;",
             "}")
  }

  protected textureUniforms () {
    return ["uniform lowp sampler2D u_Texture;"]
  }
  protected textureVaryings () {
    return ["varying mediump vec2 v_TexCoord;",
            "varying lowp vec4 v_Color;"]
  }
  protected textureColor () {
    return ["  vec4 textureColor = texture2D(u_Texture, v_TexCoord);"]
  }
  protected textureTint () {
    return ["  textureColor.rgb *= v_Color.rgb;"]
  }
  protected textureAlpha () {
    return ["  textureColor *= v_Color.a;"]
  }
}

/** A batch that renders (optionally tinted) textured primitives. */
export class TexturedBatch extends Batch {
  protected curTex :Texture|void = undefined

  /** Prepares this batch to render using the supplied texture. If pending operations have been
    * added to this batch for a different texture, this call will trigger a [[flush]].
    *
    * Note: if you call `add` methods that take a texture, you need not call this method manually.
    * It is needed only if you're adding bare primitives. */
  setTexture (tex :Texture) {
    if (this.curTex && this.curTex !== tex) this.flush()
    this.curTex = tex
  }

  flush () {
    super.flush()
    this.bindTexture()
  }

  end () {
    super.end()
    this.curTex = undefined
  }

  protected bindTexture () {
    const tex = this.curTex
    if (tex) {
      this.glc.bindTexture(GLC.TEXTURE_2D, tex.tex)
      checkError(this.glc, "Batch bindTexture")
    }
  }
}

/** A batch which can render textured quads. Since that's a common thing to do in 2D, we factor out
  * this API, and allow for different implementations. */
export abstract class QuadBatch extends TexturedBatch {

  /** Adds `tile` as a transformed axis-aligned quad to this batch.
    * `pos, size` define the size and position of the quad. */
  addTile (tile :Tile, tint :Color, trans :mat2d, pos :vec2, size :dim2) {
    this.setTexture(tile.texture)
    const dx = pos[0], dy = pos[1], dw = size[0], dh = size[1]
    const sl = tile.s[0], sr = tile.s[1], st = tile.t[0], sb = tile.t[1]
    // TODO: we should probably support repeat for tiles that are the whole texture
    this.addQuad(tint, trans, dx, dy, dx+dw, dy+dh, sl, st, sr, sb)
  }

  /** Adds `tex` as a transformed axis-aligned quad to this batch.
    * `pos, size` define the size and position of the quad. */
  addTexQuad (tex :Texture, tint :Color, trans :mat2d, pos :vec2, size :dim2) {
    this.setTexture(tex)
    const x = pos[0], y = pos[1], w = size[0], h = size[1]
    const sr = tex.config.repeatX ? w/tex.size[0] : 1
    const sb = tex.config.repeatY ? h/tex.size[1] : 1
    this.addQuad(tint, trans, x, y, x+w, y+h, 0, 0, sr, sb)
  }

  /** Adds a transformed axis-aligned quad to this batch.
    * `left, top, right, bottom` define the bounds of the quad.
    * `sl, st, sr, sb` define the texture coordinates. */
  addQuad (tint :Color, trans :mat2d,
           left :number, top :number, right :number, bottom :number,
           sl :number, st :number, sr :number, sb :number) {
    this.addQuadVerts(tint, trans,
                      left, top, sl, st,
                      right, top, sr, st,
                      left, bottom, sl, sb,
                      right, bottom, sr, sb)
  }

  /** Adds a transformed quad to this batch.
    * `a, b, c, d, tx, ty` define the affine transform applied to the quad.
    * `x1, y1, .., x4, y4` define the corners of the quad.
    * `sx1, sy1, .., sx4, sy4` define the texture coordinate of the quad. */
  abstract addQuadVerts (tint :Color, trans :mat2d,
                         x1 :number, y1 :number, s1 :number, t1 :number,
                         x2 :number, y2 :number, s2 :number, t2 :number,
                         x3 :number, y3 :number, s3 :number, t3 :number,
                         x4 :number, y4 :number, s4 :number, t4 :number) :void
}

/** The source for the stock triangle batch shader program. */
export class TriangleBatchSource extends TexturedBatchSource {

  /** Declares the uniform variables for our shader. */
  static VERT_UNIFS = [
    "uniform vec2 u_HScreenSize;",
    "uniform float u_Flip;"]

  /** The same-for-all-verts-in-a-quad attribute variables for our shader. */
  static VERT_ATTRS = [
    "attribute vec4 a_Matrix;",
    "attribute vec2 a_Translation;",
    "attribute vec2 a_Color;"]

  /** The varies-per-vert attribute variables for our shader. */
  static PER_VERT_ATTRS = [
    "attribute vec2 a_Position;",
    "attribute vec2 a_TexCoord;"]

  /** Declares the varying variables for our shader. */
  static VERT_VARS = [
    "varying vec2 v_TexCoord;",
    "varying vec4 v_Color;"]

  /** The shader code that computes {@code gl_Position}. */
  static VERT_SETPOS = [
    // Transform the vertex.
    "mat3 transform = mat3(",
    "  a_Matrix[0],      a_Matrix[1],      0,",
    "  a_Matrix[2],      a_Matrix[3],      0,",
    "  a_Translation[0], a_Translation[1], 1);",
    "gl_Position = vec4(transform * vec3(a_Position, 1.0), 1);",
    // Scale from screen coordinates to [0, 2].
    "gl_Position.xy /= u_HScreenSize.xy;",
    // Offset to [-1, 1].
    "gl_Position.xy -= 1.0;",
    // If requested, flip the y-axis.
    "gl_Position.y *= u_Flip;\n"]

  /** The shader code that computes {@code v_TexCoord}. */
  static VERT_SETTEX = [
    "v_TexCoord = a_TexCoord;"]

  /** The shader code that computes {@code v_Color}. */
  static VERT_SETCOLOR = [
    // tint is encoded as two floats A*256+R and G*256+B where A, R, G, B are (0 - 255)
    "float red = mod(a_Color.x, 256.0);",
    "float alpha = (a_Color.x - red) / 256.0;",
    "float blue = mod(a_Color.y, 256.0);",
    "float green = (a_Color.y - blue) / 256.0;",
    "v_Color = vec4(red / 255.0, green / 255.0, blue / 255.0, alpha / 255.0);"]

  /** Returns the source of the vertex shader program. */
  vertex () {
    const TBS = TriangleBatchSource
    return TBS.VERT_UNIFS.
      concat(TBS.VERT_ATTRS).
      concat(TBS.PER_VERT_ATTRS).
      concat(TBS.VERT_VARS).
      concat("void main(void) {").
      concat(TBS.VERT_SETPOS).
      concat(TBS.VERT_SETTEX).
      concat(TBS.VERT_SETCOLOR).
      concat("}")
  }
}

const FLOAT_SIZE_BYTES = 4
const QUAD_INDICES = [0, 1, 2, 1, 3, 2]

function copy (into :Float32Array, offset :number, stables :Float32Array) {
  into.set(stables, offset)
  return offset + stables.length
}

function add (into :Float32Array, offset :number, x :number, y :number, sx :number, sy :number) {
  into[offset++] = x
  into[offset++] = y
  into[offset++] = sx
  into[offset++] = sy
  return offset
}

export type TriangleBatchConfig = {
  source :TriangleBatchSource,
  startQuads :number
  expandQuads :number
  maxQuads :number
}

export const DefaultTriangleBatchConfig :TriangleBatchConfig = {
  source: new TriangleBatchSource(),
  startQuads: 64,
  expandQuads: 128,
  maxQuads: 1024
}

export class TriangleBatch extends QuadBatch {
  readonly program :Program
  readonly uTexture :WebGLUniformLocation
  readonly uHScreenSize :WebGLUniformLocation
  readonly uFlip :WebGLUniformLocation
  // stable (same for whole quad)
  readonly aMatrix :number
  readonly aTranslation :number
  readonly aColor :number
  // changing (varies per quad vertex)
  readonly aPosition :number
  readonly aTexCoord :number

  readonly stableAttrs :Float32Array
  private vertices :Float32Array
  private elements :Uint16Array

  readonly vertBuffer :WebGLBuffer
  readonly elemBuffer :WebGLBuffer

  private vertPos = 0
  private elemPos = 0

  constructor (readonly renderer :Renderer, readonly config = DefaultTriangleBatchConfig) {
    super(renderer.glc)

    const glc = renderer.glc
    const vsrc = config.source.vertex().join("\n"), fsrc = config.source.fragment().join("\n")
    const prog = this.program = new Program(glc, vsrc, fsrc)

    this.uTexture     = prog.getUniformLocation("u_Texture")
    this.uHScreenSize = prog.getUniformLocation("u_HScreenSize")
    this.uFlip        = prog.getUniformLocation("u_Flip")
    this.aMatrix      = prog.getAttribLocation("a_Matrix")
    this.aTranslation = prog.getAttribLocation("a_Translation")
    this.aColor       = prog.getAttribLocation("a_Color")
    this.aPosition    = prog.getAttribLocation("a_Position")
    this.aTexCoord    = prog.getAttribLocation("a_TexCoord")

    // create our vertex and index buffers
    this.stableAttrs = new Float32Array(this.stableAttrsSize)
    this.vertices    = new Float32Array(config.startQuads * 4 * this.vertexSize)
    this.elements    = new Uint16Array(config.startQuads * 6)

    // create our GL buffers
    const vertBuffer = glc.createBuffer()
    if (vertBuffer) this.vertBuffer = vertBuffer
    else throw new Error(`Failed to create vertex buffer ${glc.getError()}`)
    const elemBuffer = glc.createBuffer()
    if (elemBuffer) this.elemBuffer = elemBuffer
    else throw new Error(`Failed to create element buffer ${glc.getError()}`)

    checkError(glc, "TriangleBatch end ctor")
  }

  /** Prepares to add primitives with the specified tint and transform. This configures
    * [[stableAttrs]] with all of the attributes that are the same for every vertex. */
  prepare (tint :Color, xf :mat2d) {
    const stables = this.stableAttrs
    stables.set(xf, 0)
    stables[6] = Color.toAR(tint)
    stables[7] = Color.toGB(tint)
    this.addExtraStableAttrs(stables, 8)
  }

  /** Adds a collection of textured triangles to the current render operation.
    *
    * @param xys a list of x/y coordinates as: `[x1, y1, x2, y2, ...]`.
    * @param xysOffset the offset of the coordinates array, must not be negative and no greater
    * than `xys.length`. Note: this is an absolute offset; since `xys` contains pairs of values,
    * this will be some multiple of two.
    * @param xysLen the number of coordinates to read, must be no less than zero and no greater
    * than `xys.length - xysOffset`. Note: this is an absolute length; since `xys` contains
    * pairs of values, this will be some multiple of two.
    * @param tw the width of the texture for which we will auto-generate texture coordinates.
    * @param th the height of the texture for which we will auto-generate texture coordinates.
    * @param indices the index of the triangle vertices in the `xys` array. Because this
    * method renders a slice of `xys`, one must also specify `indexBase` which tells us
    * how to interpret indices. The index into `xys` will be computed as:
    * `2*(indices[ii] - indexBase)`, so if your indices reference vertices relative to the
    * whole array you should pass `xysOffset/2` for `indexBase`, but if your indices
    * reference vertices relative to _the slice_ then you should pass zero.
    * @param indicesOffset the offset of the indices array, must not be negative and no greater
    * than `indices.length`.
    * @param indicesLen the number of indices to read, must be no less than zero and no greater
    * than `indices.length - indicesOffset`.
    * @param indexBase the basis for interpreting `indices`. See the docs for `indices`
    * for details.
    */
  addTexTris (tex :Texture, tint :Color, xf :mat2d,
              xys :number[], xysOffset :number, xysLen :number, tw :number, th :number,
              indices :number[], indicesOffset :number, indicesLen :number, indexBase :number) {
    this.setTexture(tex)
    this.prepare(tint, xf)
    this.addTris(xys, xysOffset, xysLen, tw, th, indices, indicesOffset, indicesLen, indexBase)
  }

  /** Adds a collection of textured triangles to the current render operation. See [[addTris]] for
    * parameter documentation.
    * @param sts a list of s/t texture coordinates as: `[s1, t1, s2, t2, ...]`. This must be of the
    * same length as `xys`. */
  addTexTrisST (tex :Texture, tint :Color, xf :mat2d,
                xys :number[], sts :number[], xysOffset :number, xysLen :number,
                indices :number[], indicesOffset :number, indicesLen :number, indexBase :number) {
    this.setTexture(tex)
    this.prepare(tint, xf)
    this.addTrisST(xys, sts, xysOffset, xysLen, indices, indicesOffset, indicesLen, indexBase)
  }

  /** Adds triangle primitives to a prepared batch. This must be preceded by calls to [[setTexture]]
    * and [[prepare]] to configure the texture and stable attributes. */
  addTris (xys :number[], xysOffset :number, xysLen :number, tw :number, th :number,
           indices :number[], indicesOffset :number, indicesLen :number, indexBase :number) {
    const vertIdx = this.beginPrimitive(xysLen/2, indicesLen)
    const verts = this.vertices, stables = this.stableAttrs
    let offset = this.vertPos
    for (let ii = xysOffset, ll = ii+xysLen; ii < ll; ii += 2) {
      const x = xys[ii], y = xys[ii+1]
      offset = copy(verts, offset, stables)
      offset = add(verts, offset, x, y, x/tw, y/th)
    }
    this.vertPos = offset
    this.addElems(vertIdx, indices, indicesOffset, indicesLen, indexBase)
  }

  /**
   * Adds triangle primitives to a prepared batch. This must be preceded by calls to [[setTexture]]
   * and [[prepare]] to configure the texture and stable attributes.
   */
  addTrisST (xys :number[], sts :number[], xysOffset :number, xysLen :number,
             indices :number[], indicesOffset :number, indicesLen :number, indexBase :number) {
    const vertIdx = this.beginPrimitive(xysLen/2, indicesLen)
    const verts = this.vertices, stables = this.stableAttrs
    let offset = this.vertPos
    for (let ii = xysOffset, ll = ii+xysLen; ii < ll; ii += 2) {
      offset = copy(verts, offset, stables)
      offset = add(verts, offset, xys[ii], xys[ii+1], sts[ii], sts[ii+1])
    }
    this.vertPos = offset
    this.addElems(vertIdx, indices, indicesOffset, indicesLen, indexBase)
  }

  addQuadVerts (tint :Color, trans :mat2d,
                x1 :number, y1 :number, s1 :number, t1 :number,
                x2 :number, y2 :number, s2 :number, t2 :number,
                x3 :number, y3 :number, s3 :number, t3 :number,
                x4 :number, y4 :number, s4 :number, t4 :number) {
    this.prepare(tint, trans)
    const vertIdx = this.beginPrimitive(4, 6)
    let offset = this.vertPos
    const verts = this.vertices, stables = this.stableAttrs
    offset = add(verts, copy(verts, offset, stables), x1, y1, s1, t1)
    offset = add(verts, copy(verts, offset, stables), x2, y2, s2, t2)
    offset = add(verts, copy(verts, offset, stables), x3, y3, s3, t3)
    offset = add(verts, copy(verts, offset, stables), x4, y4, s4, t4)
    this.vertPos = offset
    this.addElems(vertIdx, QUAD_INDICES, 0, QUAD_INDICES.length, 0)
  }

  begin (fbufSize :dim2, flip :boolean) {
    super.begin(fbufSize, flip)
    this.program.activate()
    // account for the logical to physical pixel scale
    const hfbw = this.renderer.scale.inv.scaled(fbufSize[0]/2)
    const hfbh = this.renderer.scale.inv.scaled(fbufSize[1]/2)
    this.glc.uniform2f(this.uHScreenSize, hfbw, hfbh)
    this.glc.uniform1f(this.uFlip, flip ? -1 : 1)

    // TODO: avoid rebinding if this buffer is already bound?
    this.glc.bindBuffer(GLC.ARRAY_BUFFER, this.vertBuffer)

    // bind our stable vertex attributes
    const stride = this.vertexStride
    this.glBindVertAttrib(this.aMatrix, 4, GLC.FLOAT, stride, 0)
    this.glBindVertAttrib(this.aTranslation, 2, GLC.FLOAT, stride, 16)
    this.glBindVertAttrib(this.aColor, 2, GLC.FLOAT, stride, 24)

    // bind our changing vertex attributes
    const offset = this.stableAttrsSize*FLOAT_SIZE_BYTES
    this.glBindVertAttrib(this.aPosition, 2, GLC.FLOAT, stride, offset)
    this.glBindVertAttrib(this.aTexCoord, 2, GLC.FLOAT, stride, offset+8)

    // TODO: ditto re: avoid rebinding...
    this.glc.bindBuffer(GLC.ELEMENT_ARRAY_BUFFER, this.elemBuffer)
    this.glc.activeTexture(GLC.TEXTURE0)
    this.glc.uniform1i(this.uTexture, 0)
    checkError(this.glc, "TriangleBatch begin");
  }

  flush () {
    super.flush()
    if (this.vertPos > 0) {
      this.bindTexture()

      const verts = this.vertices.subarray(0, this.vertPos)
      this.glc.bufferData(GLC.ARRAY_BUFFER, verts, GLC.STREAM_DRAW)

      const elems = this.elements.subarray(0, this.elemPos)
      this.glc.bufferData(GLC.ELEMENT_ARRAY_BUFFER, elems, GLC.STREAM_DRAW)
      checkError(this.glc, "TriangleBatch.flush BufferData")

      this.glc.drawElements(GLC.TRIANGLES, this.elemPos, GLC.UNSIGNED_SHORT, 0)
      checkError(this.glc, "TriangleBatch.flush DrawElements")

      this.vertPos = 0
      this.elemPos = 0
    }
  }

  end () {
    super.end()
    this.glc.disableVertexAttribArray(this.aMatrix)
    this.glc.disableVertexAttribArray(this.aTranslation)
    this.glc.disableVertexAttribArray(this.aColor)
    this.glc.disableVertexAttribArray(this.aPosition)
    this.glc.disableVertexAttribArray(this.aTexCoord)
    checkError(this.glc, "TriangleBatch end")
  }

  dispose () {
    super.dispose()
    this.program.dispose()
    this.glc.deleteBuffer(this.vertBuffer)
    this.glc.deleteBuffer(this.elemBuffer)
    checkError(this.glc, "TriangleBatch close")
  }

  toString () { return `tris/${this.elements.length/QUAD_INDICES.length}` }

  protected get stableAttrsSize () :number { return 8 }
  protected get vertexSize () :number { return this.stableAttrsSize + 4 }
  protected get vertexStride () :number { return this.vertexSize * FLOAT_SIZE_BYTES }

  protected addExtraStableAttrs (buf :Float32Array, sidx :number) {
    return sidx
  }

  protected beginPrimitive (vertexCount :number, elemCount :number) :number {
    // check whether we have enough room to hold this primitive
    const vertSize = this.vertexSize, vertIdx = this.vertPos / vertSize
    const verts = vertIdx + vertexCount, elems = this.elemPos + elemCount
    const availVerts = this.vertices.length / vertSize, availElems = this.elements.length
    if (verts <= availVerts && elems <= availElems) return vertIdx

    // otherwise, flush and expand our buffers if needed (and possible)
    this.flush()
    const canExpand = this.vertices.length < this.config.maxQuads * 4 * this.vertexSize
    if (canExpand && verts > availVerts) this.expandVerts(verts)
    if (canExpand && elems > availElems) this.expandElems(elems)
    return 0
  }

  protected glBindVertAttrib (loc :number, size :number,
                              type :number, stride :number, offset :number) {
    this.glc.enableVertexAttribArray(loc)
    this.glc.vertexAttribPointer(loc, size, type, false, stride, offset)
  }

  protected addElems (vertIdx :number, indices :number[],
                      indicesOffset :number, indicesLen :number, indexBase :number) {
    const data = this.elements
    let offset = this.elemPos
    for (let ii = indicesOffset, ll = ii+indicesLen; ii < ll; ii++) {
      data[offset++] = (vertIdx+indices[ii]-indexBase)
    }
    this.elemPos = offset
  }

  private expandVerts (vertCount :number) {
    let newVerts = this.vertices.length / this.vertexSize
    while (newVerts < vertCount) newVerts += 4*this.config.expandQuads
    this.vertices = new Float32Array(newVerts*this.vertexSize)
  }

  private expandElems (elemCount :number) {
    let newElems = this.elements.length
    while (newElems < elemCount) newElems += 6*this.config.expandQuads
    this.elements = new Uint16Array(newElems)
  }
}

/** The source for the stock quad batch shader program. */
export class UniformQuadBatchSource extends TexturedBatchSource {

  /** Declares the uniform variables for our shader. */
  static VERT_UNIFS = [
    "uniform vec2 u_HScreenSize;",
    "uniform float u_Flip;",
    "uniform vec4 u_Data[_VEC4S_PER_QUAD_*_MAX_QUADS_];"
  ]

  /** Declares the attribute variables for our shader. */
  static VERT_ATTRS = [
    "attribute vec3 a_Vertex;"
  ]

  /** Declares the varying variables for our shader. */
  static VERT_VARS = [
    "varying vec2 v_TexCoord;",
    "varying vec4 v_Color;"
  ]

  /** Extracts the values from our data buffer. */
  static VERT_EXTRACTDATA = [
    "int index = _VEC4S_PER_QUAD_*int(a_Vertex.z);",
    "vec4 mat = u_Data[index+0];",
    "vec4 txc = u_Data[index+1];",
    "vec4 tcs = u_Data[index+2];"
  ]

  /** The shader code that computes {@code gl_Position}. */
  static VERT_SETPOS = [
    // Transform the vertex.
    "mat3 transform = mat3(",
    "  mat.x, mat.y, 0,",
    "  mat.z, mat.w, 0,",
    "  txc.x, txc.y, 1);",
    "gl_Position = vec4(transform * vec3(a_Vertex.xy, 1.0), 1.0);",
    // Scale from screen coordinates to [0, 2].
    "gl_Position.xy /= u_HScreenSize.xy;",
    // Offset to [-1, 1].
    "gl_Position.xy -= 1.0;",
    // If requested, flip the y-axis.
    "gl_Position.y *= u_Flip;"
  ]

  /** The shader code that computes {@code v_TexCoord}. */
  static VERT_SETTEX = [
    "v_TexCoord = a_Vertex.xy * tcs.xy + txc.zw;"
  ]

  /** The shader code that computes {@code v_Color}. */
  static VERT_SETCOLOR = [
    // tint is encoded as two floats A*R and G*B where A, R, G, B are (0 - 255)
    "float red = mod(tcs.z, 256.0);",
    "float alpha = (tcs.z - red) / 256.0;",
    "float blue = mod(tcs.w, 256.0);",
    "float green = (tcs.w - blue) / 256.0;",
    "v_Color = vec4(red / 255.0, green / 255.0, blue / 255.0, alpha / 255.0);"
  ]

  /** Returns the source to the vertex shader program. */
  vertex (batch :UniformQuadBatch) {
    return this.rawVertex().map(line => line.
                                replace("_MAX_QUADS_", ""+batch.maxQuads).
                                replace("_VEC4S_PER_QUAD_", ""+batch.vec4sPerQuad))
  }

  /** Returns the raw vertex source, which will have some parameters subbed into it. */
  protected rawVertex () :string[] {
    const UQBS = UniformQuadBatchSource
    return UQBS.VERT_UNIFS.
      concat(UQBS.VERT_ATTRS).
      concat(UQBS.VERT_VARS).
      concat("void main(void) {").
      concat(UQBS.VERT_EXTRACTDATA).
      concat(UQBS.VERT_SETPOS).
      concat(UQBS.VERT_SETTEX).
      concat(UQBS.VERT_SETCOLOR).
      concat("}")
  }
}

const VERTS_PER_QUAD = 4
const ELEMS_PER_QUAD = 6
const VERT_SIZE = 3 // 3 floats per vertex
const BASE_VEC4S_PER_QUAD = 3 // 3 vec4s per matrix

export type UniformQuadBatchConfig = {
  source :UniformQuadBatchSource
}

export const DefaultUniformQuadBatchConfig :UniformQuadBatchConfig = {
  source: new UniformQuadBatchSource()
}

/** A batch which renders quads by stuffing them into a big(ish) GLSL uniform variable. This turns
  * out to work pretty well for 2D rendering as we rarely render more than a modest number of quads
  * before flushing the shader and it allows us to avoid sending a lot of duplicated data as is
  * necessary when rendering quads via a batch of triangles. */
export class UniformQuadBatch extends QuadBatch {

  /**
   * Returns false if the GL context doesn't support sufficient numbers of vertex uniform vectors
   * to allow this shader to run with good performance, true otherwise.
   */
  static isLikelyToPerform (glc :GLC) :boolean {
    const maxVecs = UniformQuadBatch.usableMaxUniformVectors(glc)
    // assume we're better off with indexed tris if we can't push at least 16 quads at a time
    return (maxVecs >= 16*BASE_VEC4S_PER_QUAD)
  }

  readonly maxQuads :number

  readonly program :Program
  readonly uTexture :WebGLUniformLocation
  readonly uHScreenSize :WebGLUniformLocation
  readonly uFlip :WebGLUniformLocation
  readonly uData :WebGLUniformLocation
  readonly aVertex :number

  private vertBuffer :WebGLBuffer
  private elemBuffer :WebGLBuffer
  private data :Float32Array
  private quadCounter = 0

  /** Creates a uniform quad batch with the supplied custom shader program builder. */
  constructor (readonly renderer :Renderer, readonly config = DefaultUniformQuadBatchConfig) {
    super(renderer.glc)

    const glc = renderer.glc
    const maxVecs = UniformQuadBatch.usableMaxUniformVectors(glc) - this.extraVec4s
    const v4s = this.vec4sPerQuad
    if (maxVecs < v4s) throw new Error(
      `GL_MAX_VERTEX_UNIFORM_VECTORS too low: have ${maxVecs}, need at least ${v4s}`)
    const maxQuads = this.maxQuads = Math.floor(maxVecs / v4s)

    const vsrc = config.source.vertex(this).join("\n"), fsrc = config.source.fragment().join("\n")
    const prog = this.program = new Program(glc, vsrc, fsrc)
    this.uTexture = prog.getUniformLocation("u_Texture")
    this.uHScreenSize = prog.getUniformLocation("u_HScreenSize")
    this.uFlip = prog.getUniformLocation("u_Flip")
    this.uData = prog.getUniformLocation("u_Data")
    this.aVertex = prog.getAttribLocation("a_Vertex")

    // create our stock supply of unit quads and stuff them into our buffers
    const verts = new Uint16Array(maxQuads*VERTS_PER_QUAD*VERT_SIZE)
    const elems = new Uint16Array(maxQuads*ELEMS_PER_QUAD)
    let vv = 0, ee = 0
    for (let ii = 0; ii < maxQuads; ii += 1) {
      verts[vv++] = 0; verts[vv++] = 0; verts[vv++] = ii
      verts[vv++] = 1; verts[vv++] = 0; verts[vv++] = ii
      verts[vv++] = 0; verts[vv++] = 1; verts[vv++] = ii
      verts[vv++] = 1; verts[vv++] = 1; verts[vv++] = ii
      const base = ii * VERTS_PER_QUAD
      elems[ee++] = base  ; elems[ee++] = base+1; elems[ee++] = base+2
      elems[ee++] = base+1; elems[ee++] = base+3; elems[ee++] = base+2
    }

    this.data = new Float32Array(maxQuads*v4s*4)

    // create our GL buffers
    const vertBuffer = glc.createBuffer()
    if (vertBuffer) this.vertBuffer = vertBuffer
    else throw new Error(`Failed to create vertex buffer ${glc.getError()}`)
    const elemBuffer = glc.createBuffer()
    if (elemBuffer) this.elemBuffer = elemBuffer
    else throw new Error(`Failed to create element buffer ${glc.getError()}`)

    glc.bindBuffer(GLC.ARRAY_BUFFER, this.vertBuffer)
    glc.bufferData(GLC.ARRAY_BUFFER, verts, GLC.STATIC_DRAW)

    glc.bindBuffer(GLC.ELEMENT_ARRAY_BUFFER, this.elemBuffer)
    glc.bufferData(GLC.ELEMENT_ARRAY_BUFFER, elems, GLC.STATIC_DRAW)

    checkError(glc, "UniformQuadBatch end ctor");
  }

  get vec4sPerQuad () :number { return BASE_VEC4S_PER_QUAD }

  addQuadVerts (tint :Color, trans :mat2d,
                x1 :number, y1 :number, s1 :number, t1 :number,
                x2 :number, y2 :number, s2 :number, t2 :number,
                x3 :number, y3 :number, s3 :number, t3 :number,
                x4 :number, y4 :number, s4 :number, t4 :number) {
    const dw = x2 - x1, dh = y3 - y1
    const data = this.data
    let pos = this.quadCounter * this.vec4sPerQuad*4
    const m00 = trans[0], m01 = trans[1], m10 = trans[2], m11 = trans[3]
    const tx = trans[4], ty = trans[5]
    data[pos++] = m00*dw
    data[pos++] = m01*dw
    data[pos++] = m10*dh
    data[pos++] = m11*dh
    data[pos++] = tx + m00*x1 + m10*y1
    data[pos++] = ty + m01*x1 + m11*y1
    data[pos++] = s1
    data[pos++] = t1
    data[pos++] = s2 - s1
    data[pos++] = t3 - t1
    data[pos++] = Color.toAR(tint)
    data[pos++] = Color.toGB(tint)
    pos = this.addExtraQuadData(data, pos)
    this.quadCounter += 1

    if (this.quadCounter >= this.maxQuads) this.flush()
  }

  begin (fbufSize :dim2, flip :boolean) {
    super.begin(fbufSize, flip)
    this.program.activate()
    // TODO: apparently we can avoid glUniform calls because they're part of the program state; so
    // we can cache the last set values for all these glUniform calls and only set them anew if
    // they differ...
    const glc = this.glc
    // account for the logical to physical pixel scale
    const hfbw = this.renderer.scale.inv.scaled(fbufSize[0]/2)
    const hfbh = this.renderer.scale.inv.scaled(fbufSize[1]/2)
    glc.uniform2f(this.uHScreenSize, hfbw, hfbh)
    glc.uniform1f(this.uFlip, flip ? -1 : 1)
    glc.bindBuffer(GLC.ARRAY_BUFFER, this.vertBuffer)
    glc.enableVertexAttribArray(this.aVertex)
    glc.vertexAttribPointer(this.aVertex, VERT_SIZE, GLC.SHORT, false, 0, 0)
    glc.bindBuffer(GLC.ELEMENT_ARRAY_BUFFER, this.elemBuffer)
    glc.activeTexture(GLC.TEXTURE0)
    glc.uniform1i(this.uTexture, 0)
    checkError(glc, "UniformQuadBatch begin")
  }

  flush () {
    super.flush()
    if (this.quadCounter > 0) {
      this.bindTexture()
      const quads = this.quadCounter, vec4s = quads*this.vec4sPerQuad
      const data = this.data.length === vec4s ? this.data : this.data.subarray(0, vec4s*4)
      this.glc.uniform4fv(this.uData, data)
      this.glc.drawElements(GLC.TRIANGLES, quads*ELEMS_PER_QUAD, GLC.UNSIGNED_SHORT, 0)
      checkError(this.glc, "UniformQuadBatch flush")
      this.quadCounter = 0
    }
  }

  end () {
    super.end()
    this.glc.disableVertexAttribArray(this.aVertex)
    checkError(this.glc, "UniformQuadBatch end")
  }

  dispose () {
    super.dispose()
    this.program.dispose()
    this.glc.deleteBuffer(this.vertBuffer)
    this.glc.deleteBuffer(this.elemBuffer)
    checkError(this.glc, "UniformQuadBatch close")
  }

  toString () { return `uquad/${this.maxQuads}` }

  /** Returns how many vec4s this shader uses above and beyond those in the base implementation. If
    * you add any extra attributes or uniforms, your subclass will need to account for them here. */
  protected get extraVec4s () :number { return 0 }

  protected addExtraQuadData (data :Float32Array, pos :number) :number { return pos }

  private static usableMaxUniformVectors (glc :GLC) :number {
    // this returns the maximum number of vec4s; then we subtract one vec2 to account for the
    // uHScreenSize uniform, and two more because some GPUs seem to need one for our vec3 attr
    const maxVecs = glc.getParameter(GLC.MAX_VERTEX_UNIFORM_VECTORS) - 3
    // we have to check errors always in this case, because if GL failed to return a value we would
    // otherwise return the value of uninitialized memory which could be some huge number which we
    // might turn around and try to compile into a shader causing GL to crash (you might think from
    // such a careful description that such a thing has in fact come to pass, and you would not be
    // incorrect)
    const glErr = glc.getError()
    if (glErr != GLC.NO_ERROR) throw new Error(
      `Unable to query GL_MAX_VERTEX_UNIFORM_VECTORS,  error ${glErr}`)
    return maxVecs
  }
}
