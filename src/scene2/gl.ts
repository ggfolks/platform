import {mat2d} from "gl-matrix"
import {Disposable} from "../core/util"
import {Mutable, Subject} from "../core/react"

//
// Basic GL machinery: shader programs, render targets, etc.

type GLC = WebGLRenderingContext
const GLC = WebGLRenderingContext

const checkErrors = true

/** Checks `glc` for any unreported errors iff error checking is enabled. If any errors are found,
  * they are logged, tagged with the supplied `op` string (which should generally be the GL call
  * that immediately preceded this call to `checkError`).
  * @return `true` if one or more errors were found and logged, `false` if no errors were found. */
export function checkError (glc :GLC, op :string) :boolean {
  let errorsReported = 0
  if (checkErrors) {
    let error :number
    while ((error = glc.getError()) !== glc.NO_ERROR) {
      errorsReported += 0
      console.warn(`${op}: glError ${error}`)
    }
  }
  return errorsReported > 0
}

/** Combines a GL context, shader program, vertex shader and fragment shader into one easy to use
  * package. Simply create a program with the necessary ingredients, then `activate` it prior to
  * sending drawing commands.
  */
export class Program implements Disposable {
  prog :WebGLProgram
  vertShader :WebGLShader
  fragShader :WebGLShader

  /** Creates a new shader program with the supplied GL context, and vertex & fragment shader
    * source.
    * @throws Error if anything goes wrong when creating the program. */
  constructor (readonly glc :GLC, vertSource :string, fragSource :string) {
    const prog = glc.createProgram()
    if (prog == null) throw new Error(`Failed to create program: ${glc.getError()}`)
    checkError(glc, "glCreateProgram")
    this.prog = prog

    function compileShader (type :number, source :string) :WebGLShader {
      const shader = glc.createShader(type)
      if (!shader) throw new Error(`Failed to create shader (${type}): ${glc.getError()}`)
      glc.shaderSource(shader, source)
      glc.compileShader(shader)
      if (!glc.getShaderParameter(shader, glc.COMPILE_STATUS)) {
        const log = glc.getShaderInfoLog(shader)
        glc.deleteShader(shader)
        throw new Error(`Failed to compile shader (${type}): ${log}`)
      }
      return shader
    }

    const vertShader = this.vertShader = compileShader(glc.VERTEX_SHADER, vertSource)
    glc.attachShader(prog, vertShader)
    checkError(glc, "glAttachShader / vertex")

    const fragShader = this.fragShader = compileShader(glc.FRAGMENT_SHADER, fragSource)
    glc.attachShader(prog, fragShader)
    checkError(glc, "glAttachShader / fragment")

    glc.linkProgram(prog)
    if (!glc.getProgramParameter(prog, glc.LINK_STATUS)) {
      const log = glc.getProgramInfoLog(prog)
      glc.deleteShader(vertShader)
      glc.deleteShader(fragShader)
      glc.deleteProgram(prog)
      throw new Error(`Failed to link program: ${log}`)
    }
  }

  /** Returns the uniform location with the specified `name`.
    * @throws Error if no uniform exists with the supplied name. */
  getUniformLocation (name :string) :WebGLUniformLocation {
    const loc = this.glc.getUniformLocation(this.prog, name)
    if (loc) return loc
    throw new Error(`Failed to get ${name} uniform.`)
  }

  /** Returns the attribute location with the specified `name`.
    * @throws Error if no attribute exists with the supplied name. */
  getAttribLocation (name :string) :number {
    const loc = this.glc.getAttribLocation(this.prog, name)
    if (loc) return loc
    throw new Error(`Failed to get ${name} attribute.`)
  }

  /** Binds this shader program to the GL context it was created with. */
  activate () {
    this.glc.useProgram(this.prog)
  }

  /** Disposes this shader program, freeing its GL context resources. */
  dispose () {
    this.glc.deleteShader(this.vertShader)
    this.glc.deleteShader(this.fragShader)
    this.glc.deleteProgram(this.prog)
  }
}

/** Reprenents a GL render target (i.e. frame buffer). */
export interface RenderTarget extends Disposable {
  /** The width of this render target in pixels. */
  width :number
  /** The height of this render target in pixels. */
  height :number
  /** The x-scale between display units and pixels for this target. */
  xscale :number
  /** The y-scale between display units and pixels for this target. */
  yscale :number
  /** Whether or nmot to flip the y-axis when rendering to this target. When rendering to textures
    * we do not want to flip the y-axis, when rendering to the screen we do (so that the origin is
    * at the upper left). */
  flip :boolean
  /** Binds this render target. Subsequent drawing commands will be rendered to it. */
  bind () :void
}

//
// Textures and images

/** Represents the scale factor for a HiDPI display. Provides methods useful for doing the
  * calculations needed to create scale-independent interfaces. */
export class Scale {

  /** An unscaled (1.0) scale factor singleton. */
  static ONE = new Scale(1)

  constructor (readonly factor :number) {
    if (factor <= 0) throw new Error(`Scale factor must be > 0 (got ${factor}`)
  }

  /** Returns `length` scaled by this scale factor. */
  scaled (length :number) :number { return length * this.factor }
  /** Returns `length` scaled by our scale factor and rounded up. */
  scaledCeil (length :number) :number { return Math.ceil(this.scaled(length)) }
  /** Returns `length` scaled by our scale factor and rounded down. */
  scaledFloor (length :number) :number { return Math.floor(this.scaled(length)) }

  /** Returns `length` inverse scaled by this scale factor. */
  invScaled (length :number) :number { return length / this.factor }
  /** Returns `length` inverse scaled by this scale factor, then rounded up. */
  invScaledCeil (length :number) :number { return Math.ceil(this.invScaled(length)) }
  /** Returns `length` inverse scaled by this scale factor, then rounded down. */
  invScaledFloor (length :number) :number { return Math.floor(this.invScaled(length)) }

  /** Rounds the supplied length to the nearest length that corresponds to an integer pixel length
    * after this scale factor is applied. For example, for a scale factor of 3,
    * `roundToNearestPixel(8.4) == 8.33`, which corresponds to exactly (8.33 * 3) = 25 pixels. */
  roundToNearestPixel (length :number) :number {
    return Math.round(length * this.factor) / this.factor
  }
}

/** Config data used when creating textures. */
export type TextureConfig = {
  /** Whether or not this texture's lifecycle is automatically managed via reference counting. If
    * the texture will be used in a `Layer`, it should be reference counted unless you are doing
    * something special. If you are using it as part of custom rendering code, you can decide
    * whether or not you want to use the reference counting mechanism or dispose manually. */
  managed :boolean
  /** Whether the texture repeat's in the x-direction. */
  repeatX :boolean
  /** Whether the texture repeat's in the y-direction. */
  repeatY :boolean
  /** The GL filter to use when the texture is scaled down: `LINEAR` or `NEAREST`. */
  minFilter :number
  /** The GL filter to use when the texture is scaled up: `LINEAR` or `NEAREST`. */
  magFilter :number
  /** Whether or not to generate mipmaps for this texture. */
  mipmaps :boolean,
  /** The DPI scale to use for this texture. Its display dimensions will be computed as the inverse
    * scale of its pixel dimensions. */
  scale :Scale
}

export const DefaultTexConfig :TextureConfig = Object.freeze({
  managed: true,
  repeatX: false, repeatY: false,
  minFilter: GLC.LINEAR, magFilter: GLC.LINEAR,
  mipmaps: false,
  scale: Scale.ONE
})

export const UnmanagedTexConfig :TextureConfig = Object.freeze({
  ...DefaultTexConfig,
  managed: false
})

/** Wraps up  a GL context, texture, and config. */
export class Texture {

  constructor (
    /** The GL context in which this texture resides. */
    readonly glc :GLC,
    /** The underlying GL texture. */
    readonly tex :WebGLTexture,
    /** The configuration of this texture. */
    readonly config :TextureConfig,
    /** The pixel width of the underlying GL texture. */
    readonly pixWidth :number,
    /** The pixel height of the underlying GL texture. */
    readonly pixHeight :number,
    /** The display width of this texture in display units (not pixels). */
    readonly width :number = config.scale.invScaled(pixWidth),
    /** The display height of this texture in display units (not pixels). */
    readonly height :number = config.scale.invScaled(pixHeight)
  ) {}
}

/** Returns next largest power of two, or `value` if `value` is already a POT. Note: this is limited
  * to values less than `0x10000`. */
export function nextPOT (value :number) :number {
  if (value >= 0x10000) throw new Error(`Value out of range ${value}`)
  let bit = 0x8000, highest = -1, count = 0
  for (let ii = 15; ii >= 0; ii--, bit >>= 1) {
    if ((value & bit) == 0) continue
    count++
    if (highest == -1) highest = ii
  }
  return (count > 1) ? (1 << (highest+1)) : value
}

/** Returns `sourceWidth` rounded up to a POT if necessary (per `config`). */
export function toTexWidth (config :TextureConfig, sourceWidth :number) :number {
  return (config.repeatX || config.mipmaps) ? nextPOT(sourceWidth) : sourceWidth
}

/** Returns `sourceHeight` rounded up to a POT if necessary (per `config`). */
export function toTexHeight (config :TextureConfig, sourceHeight :number) :number {
  return (config.repeatY || config.mipmaps) ? nextPOT(sourceHeight) : sourceHeight
}

/** Creates a GL texture based on the supplied `config`.
  * @throw Error if the texture creation fails. */
export function createTexture (glc :GLC, config :TextureConfig) :WebGLTexture {
  const tex = glc.createTexture()
  if (!tex) throw new Error(`Unable to create GL texture: ${glc.getError()}`)
  glc.bindTexture(GLC.TEXTURE_2D, tex)
  function mipmapify (filter :number, mipmaps :boolean) {
    if (!mipmaps) return filter
    // we don't do trilinear filtering (i.e. GL_LINEAR_MIPMAP_LINEAR);
    // it's expensive and not super useful when only rendering in 2D
    switch (filter) {
    case GLC.NEAREST: return GLC.NEAREST_MIPMAP_NEAREST
    case  GLC.LINEAR: return GLC.LINEAR_MIPMAP_NEAREST
    default:          return filter
    }
  }
  const minFilter = mipmapify(config.minFilter, config.mipmaps)
  glc.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_MIN_FILTER, minFilter)
  glc.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_MAG_FILTER, config.magFilter)
  const repeatX = config.repeatX ? GLC.REPEAT : GLC.CLAMP_TO_EDGE
  glc.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_WRAP_S, repeatX)
  const repeatY = config.repeatY ? GLC.REPEAT : GLC.CLAMP_TO_EDGE
  glc.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_WRAP_T, repeatY)
  return tex
}

function imageToTexture (
  glc :GLC, source :TexImageSource, config :TextureConfig, tex :WebGLTexture
) :Texture {
  // if we're a repeating texture (or we want mipmaps) and this image is non-POT on the relevant
  // axes, we need to scale it before we upload it; we'll just do this on the CPU since creating
  // a second texture, a frame buffer to render into it, sending a GPU batch and doing all the
  // blah blah blah seems likely to be more expensive overall
  const {repeatX, repeatY, mipmaps, scale} = config
  const pixWidth = source.width, pixHeight = source.height
  const potWidth = toTexWidth(config, pixWidth), potHeight = toTexWidth(config, pixHeight)
  function texImage2D (image :TexImageSource) {
    glc.bindTexture(GLC.TEXTURE_2D, tex)
    glc.texImage2D(GLC.TEXTURE_2D, 0, GLC.RGBA, GLC.RGBA, GLC.UNSIGNED_BYTE, image)
    if (mipmaps) glc.generateMipmap(GLC.TEXTURE_2D)
  }
  if ((repeatX || repeatY || mipmaps) && (potWidth != pixWidth && potHeight != pixHeight)) {
    const scaled = new HTMLCanvasElement()
    scaled.width = potWidth
    scaled.height = potHeight
    const ctx = scaled.getContext("2d")
    if (!ctx) console.warn(`Failed to obtain Canvas2DContext`)
    else {
      if (source instanceof ImageData) {
        // TODO: how to properly handle ImageData?
        console.warn(`Cannot currently handle non-POT ImageData sources.`)
      } else {
        ctx.drawImage(source, 0, 0, potWidth, potHeight)
        texImage2D(scaled)
      }
    }
    return new Texture(glc, tex, config, potWidth, potHeight,
                       scale.invScaled(pixWidth), scale.invScaled(pixHeight))
  } else {
    texImage2D(source) // fast path, woo!
    return new Texture(glc, tex, config, pixWidth, pixHeight)
  }
}

function makeErrorTexture (
  glc :GLC, config :TextureConfig, tex :WebGLTexture, width = 100, height = 50
) :Texture {
  const error = new HTMLCanvasElement()
  error.width = width
  error.height = height
  const ctx = error.getContext("2d")
  if (!ctx) console.warn(`Failed to obtain Canvas2DContext`) // ffs
  else {
    ctx.fillStyle = "red"
    ctx.fillRect(0, 0, width, height)
    ctx.textAlign = "center"
    ctx.fillStyle = "white"
    ctx.fillText("!ERROR!", width/2, height/2)
  }
  return imageToTexture(glc, error, config, tex)
}

export type ImageSource = TexImageSource | Error

export function makeTexture (
  glc :GLC, image :Subject<ImageSource>, config :Subject<TextureConfig>
) :Subject<Texture> {
  let tex :WebGLTexture|void = undefined
  return Subject.join2(image, config).mapTrace(() => {
    // nothing to do in onWake, we'll create our texture when we have our first `cfg`
  }, ([img, cfg]) => {
    if (!tex) tex = createTexture(glc, cfg)
    if (img instanceof Error) return makeErrorTexture(glc, cfg, tex)
    else return imageToTexture(glc, img, cfg, tex)
  }, _ => {
    if (tex) glc.deleteTexture(tex)
  })
}

/** A [[RenderTarget]] that renders to a [[Texture]]. */
export class TextureRenderTarget implements RenderTarget, Disposable {
  readonly fb :WebGLFramebuffer

  constructor (readonly tex :Texture) {
    const glc = tex.glc
    const fb = glc.createFramebuffer()
    if (!fb) throw new Error(`Failed to create frame buffer: ${glc.getError()}`)
    this.fb = fb
    glc.bindFramebuffer(GLC.FRAMEBUFFER, fb)
    glc.framebufferTexture2D(GLC.FRAMEBUFFER, GLC.COLOR_ATTACHMENT0, GLC.TEXTURE_2D, tex, 0)
    checkError(glc, "framebufferTexture2D")
  }

  get width () :number { return this.tex.pixWidth }
  get height () :number { return this.tex.pixHeight }
  get xscale () :number { return this.tex.config.scale.factor }
  get yscale () :number { return this.tex.config.scale.factor }
  get flip () :boolean { return false }

  bind () :void {
    this.tex.glc.bindFramebuffer(GLC.FRAMEBUFFER, this.fb)
    this.tex.glc.viewport(0, 0, this.width, this.height)
  }

  dispose () {
    this.tex.glc.deleteFramebuffer(this.fb)
  }
}

/** Manages the delivery of groups of drawing calls to the GPU. It is usually a combination of a
  * [[Program]] and one or more buffers. */
export class Batch implements Disposable {
  private begun = false // for sanity checking

  constructor (readonly glc :GLC) {}

  begin (fbufWidth :number, fbufHeight :number, flip :boolean) {
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
  "#ifdef GL_ES",
  "precision lowp float;",
  "#else",
  // Not all versions of regular OpenGL supports precision qualifiers, define placeholders
  "#define lowp",
  "#define mediump",
  "#define highp",
  "#endif"]

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

export type Color = number

/** A batch which can render textured quads. Since that's a common thing to do in 2D, we factor out
  * this API, and allow for different implementations. */
export abstract class QuadBatch extends TexturedBatch {

  /** Adds `tex` as a transformed axis-aligned quad to this batch.
    * `x, y, w, h` define the size and position of the quad. */
  addTexQuad (tex :Texture, tint :Color, xf :mat2d, x :number, y :number, w :number, h :number) {
    this.setTexture(tex)
    const sr = tex.config.repeatX ? w/tex.width : 1
    const sb = tex.config.repeatY ? h/tex.height : 1
    this.addQuad(tint, xf, x, y, x+w, y+h, 0, 0, sr, sb)
  }

  /** Adds `tex` as a transformed axis-aligned quad to this batch.
    * `dx, dy, dw, dh` define the size and position of the quad.
    * `sx, sy, sw, sh` define region of the texture which will be displayed in the quad. */
  addSubTexQuad (tex :Texture, tint :Color, xf :mat2d,
                 dx :number, dy :number, dw :number, dh :number,
                 sx :number, sy :number, sw :number, sh :number) {
    this.setTexture(tex)
    const texWidth = tex.width, texHeight = tex.height
    this.addQuad(tint, xf, dx, dy, dx+dw, dy+dh,
                 sx/texWidth, sy/texHeight, (sx+sw)/texWidth, (sy+sh)/texHeight)
  }

  /** Adds a transformed axis-aligned quad to this batch.
    * `left, top, right, bottom` define the bounds of the quad.
    * `sl, st, sr, sb` define the texture coordinates. */
  addQuad (tint :Color, xf :mat2d,
           left :number, top :number, right :number, bottom :number,
           sl :number, st :number, sr :number, sb :number) {
    this.addQuadCoords(tint, xf[0], xf[1], xf[2], xf[3], xf[4], xf[5],
                       left, top, sl, st,
                       right, top, sr, st,
                       left, bottom, sl, sb,
                       right, bottom, sr, sb)
  }

  /** Adds a transformed axis-aligned quad to this batch.
    * `a, b, c, d, tx, ty` define the affine transform applied to the quad.
    * `left, top, right, bottom` define the bounds of the quad.
    * `sl, st, sr, sb` define the texture coordinates. */
  addQuadXf (tint :Color,
             a :number, b :number, c :number, d :number, tx :number, ty :number,
             left :number, top :number, right :number, bottom :number,
             sl :number, st :number, sr :number, sb :number) {
    this.addQuadCoords(tint, a, b, c, d, tx, ty,
                       left,  top,    sl, st,
                       right, top,    sr, st,
                       left,  bottom, sl, sb,
                       right, bottom, sr, sb)
  }

  /** Adds a transformed axis-aligned quad to this batch.
    * `a, b, c, d, tx, ty` define the affine transform applied to the quad.
    * `x1, y1, .., x4, y4` define the corners of the quad.
    * `sx1, sy1, .., sx4, sy4` define the texture coordinate of the quad. */
  abstract addQuadCoords (tint :Color,
                          a :number, b :number, c :number, d :number, tx :number, ty :number,
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
    // tint is encoded as two floats A*R and G*B where A, R, G, B are (0 - 255)
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

const START_VERTS = 16*4
const EXPAND_VERTS = 16*4
const START_ELEMS = 6*START_VERTS/4
const EXPAND_ELEMS = 6*EXPAND_VERTS/4
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
  private elements :Int16Array

  readonly vertBuffer :WebGLBuffer
  readonly elemBuffer :WebGLBuffer

  private vertPos = 0
  private elemPos = 0

  constructor (glc :GLC, source :TriangleBatchSource) {
    super(glc)

    const prog = this.program = new Program(
      glc, source.vertex().join("\n"), source.fragment().join("\n"))

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
    this.vertices    = new Float32Array(START_VERTS * this.vertexSize)
    this.elements    = new Int16Array(START_ELEMS)

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
    stables.set(xf)
    stables[6] = (tint >> 16) & 0xFFFF // ar
    stables[7] = (tint >>  0) & 0xFFFF // gb
    this.addExtraStableAttrs(stables, 8)
  }

  /** Prepares to add primitives with the specified tint and transform. This configures
    * [[stableAttrs]] with all of the attributes that are the same for every vertex. */
  prepareXf (tint :Color, a :number, b :number, c :number, d :number, tx :number, ty :number) {
    const stables = this.stableAttrs
    stables[0] = a
    stables[1] = b
    stables[2] = c
    stables[3] = d
    stables[4] = tx
    stables[5] = ty
    stables[6] = (tint >> 16) & 0xFFFF // ar
    stables[7] = (tint >>  0) & 0xFFFF // gb
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
    * reference vertices relative to <em>the slice</em> then you should pass zero.
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
   * Adds triangle primitives to a prepared batch. This must be preceded by calls to
   * {@link #setTexture} and {@link #prepare} to configure the texture and stable attributes.
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

  addQuadCoords (tint :Color,
                 m00 :number, m01 :number, m10 :number, m11 :number, tx :number, ty :number,
                 x1 :number, y1 :number, s1 :number, t1 :number,
                 x2 :number, y2 :number, s2 :number, t2 :number,
                 x3 :number, y3 :number, s3 :number, t3 :number,
                 x4 :number, y4 :number, s4 :number, t4 :number) {
    this.prepareXf(tint, m00, m01, m10, m11, tx, ty)
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

  begin (fbufWidth :number, fbufHeight :number, flip :boolean) {
    super.begin(fbufWidth, fbufHeight, flip)
    this.program.activate()
    this.glc.uniform2f(this.uHScreenSize, fbufWidth/2, fbufHeight/2)
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
  protected get vertexSize () :number { return this.stableAttrsSize * 4 }
  protected get vertexStride () :number { return this.vertexSize * FLOAT_SIZE_BYTES }

  protected addExtraStableAttrs (buf :Float32Array, sidx :number) {
    return sidx
  }

  protected beginPrimitive (vertexCount :number, elemCount :number) :number {
    // check whether we have enough room to hold this primitive
    const vertIdx = this.vertPos / this.vertexSize
    const verts = vertIdx + vertexCount, elems = this.elemPos + elemCount
    const availVerts = this.vertices.length / this.vertexSize, availElems = this.elements.length
    if (verts <= availVerts && elems <= availElems) return vertIdx

    // otherwise, flush and expand our buffers if needed
    this.flush()
    if (verts > availVerts) this.expandVerts(verts)
    if (elems > availElems) this.expandElems(elems)
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
    while (newVerts < vertCount) newVerts += EXPAND_VERTS
    this.vertices = new Float32Array(newVerts*this.vertexSize)
  }

  private expandElems (elemCount :number) {
    let newElems = this.elements.length
    while (newElems < elemCount) newElems += EXPAND_ELEMS
    this.elements = new Int16Array(newElems)
  }
}

// TODO:
// UniformQuadBatch?
// Surface - immediate mode drawing API atop batches
// core - ?.ts : Clock (for frame timing?)

export type RendererConfig = {
  width? :number,
  height? :number,
  scaleFactor? :number,
  gl? :WebGLContextAttributes
}

export class Renderer {
  readonly canvas :HTMLCanvasElement
  readonly glc :GLC
  readonly target :RenderTarget
  readonly scale :Scale // TODO: support change in scale factor?
  readonly size :Mutable<[number, number]>

  constructor (attrs :RendererConfig = {}) {
    const canvas = this.canvas = document.createElement("canvas")
    const glc = this.canvas.getContext("webgl", attrs.gl)
    if (!glc) throw new Error(`Unable to create WebGL rendering context.`)
    this.glc = glc

    const rend = this
    class DefaultRenderTarget implements RenderTarget {
      pixelWidth :number = 0
      pixelHeight :number = 0
      get width () :number { return this.pixelWidth }
      get height () :number { return this.pixelHeight }
      get xscale () :number { return rend.scale.factor }
      get yscale () :number { return rend.scale.factor }
      get flip () :boolean { return true }
      bind () { rend.glc.bindFramebuffer(GLC.FRAMEBUFFER, null) }
      dispose () {}
    }
    const target = this.target = new DefaultRenderTarget()
    const scale = this.scale = new Scale(attrs.scaleFactor || window.devicePixelRatio)

    const size = this.size = Mutable.local<[number, number]>(
      [attrs.width || window.innerWidth, attrs.height || window.innerHeight])
    size.onValue(([width, height]) => {
      // the frame buffer may be larger (or smaller) than the logical size, depending on whether
      // we're on a HiDPI display, or how the game has configured things (maybe they're scaling down
      // from native resolution to improve performance)
      canvas.width = target.pixelWidth = scale.scaledCeil(width)
      canvas.height = target.pixelHeight = scale.scaledCeil(height)
      // set the canvas's CSS size to the logical size; the browser works in logical pixels
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    })
  }

  setSize (width :number, height :number) {
    this.size.update([width, height])
  }
}
