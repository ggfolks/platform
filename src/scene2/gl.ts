import {dim2, vec2} from "../core/math"
import {Scale} from "../core/ui"
import {Disposable} from "../core/util"
import {Value, Mutable, Subject} from "../core/react"

//
// Basic GL machinery: shader programs, render targets, etc.

export type GLC = WebGLRenderingContext
export const GLC = WebGLRenderingContext

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
    if (loc >= 0) return loc
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
  /** The size of this render target in pixels. */
  size :dim2
  /** The scale between display units and pixels for this target. */
  scale :vec2
  /** Whether or not to flip the y-axis when rendering to this target. When rendering to textures
    * we do not want to flip the y-axis, when rendering to the screen we do (so that the origin is
    * at the upper left). */
  flip :boolean
  /** Binds this render target. Subsequent drawing commands will be rendered to it. */
  bind () :void
}

//
// Textures and images

/** Config data used when creating textures. */
export type TextureConfig = {
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

/** A square region of a texture. Simplifies rendering tiles from texture atlases. */
export interface Tile {
  /** The texture which contains this tile. */
  texture :Texture
  /** The display size of this tile (in display units, not pixels). */
  size :dim2
  /** The `s` texture coordinate. */
  s :vec2
  /** The `t` texture coordinate. */
  t :vec2
}

// used for default ST coords
const zeroOne = vec2.fromValues(0, 1)

/** Wraps up  a GL context, texture, and config. */
export class Texture implements Tile {

  /** The default texture config. */
  static DefaultConfig :TextureConfig = Object.freeze({
    repeatX: false, repeatY: false,
    minFilter: GLC.LINEAR, magFilter: GLC.LINEAR,
    mipmaps: false,
    scale: Scale.ONE
  })

  constructor (
    /** The GL context in which this texture resides. */
    readonly glc :GLC,
    /** The underlying GL texture. */
    readonly tex :WebGLTexture,
    /** The configuration of this texture. */
    readonly config :TextureConfig,
    /** The pixel size of the underlying GL texture. */
    readonly pixSize :dim2,
    /** The display size of this texture (in display units, not pixels). */
    readonly size :dim2 = config.scale.inv.scaledDim(pixSize)
  ) {}

  get texture () :Texture { return this }
  get s () :vec2 { return zeroOne }
  get t () :vec2 { return zeroOne }

  /** Creates a tile that renders a region of this texture.
    * `x, y, width, height` define the bounds of the region (in display units). */
  tile (x :number, y :number, width :number, height :number) :Tile {
    const size = dim2.fromValues(width, height)
    const tw = this.size[0], th = this.size[1]
    const s = vec2.fromValues(x/tw, (x+width)/tw), t = vec2.fromValues(y/th, (y+height)/th)
    return {texture: this, size, s, t}
  }
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

/** Returns `sourceSize` rounded up to a POT if necessary (per `config`). */
export function toTexSize (config :TextureConfig, sourceSize :dim2) :dim2 {
  return dim2.fromValues(
    (config.repeatX || config.mipmaps) ? nextPOT(sourceSize[0]) : sourceSize[0],
    (config.repeatY || config.mipmaps) ? nextPOT(sourceSize[1]) : sourceSize[1]
  )
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

export function imageToTexture (
  glc :GLC, source :TexImageSource, config :TextureConfig, tex :WebGLTexture
) :Texture {
  // if we're a repeating texture (or we want mipmaps) and this image is non-POT on the relevant
  // axes, we need to scale it before we upload it; we'll just do this on the CPU since creating
  // a second texture, a frame buffer to render into it, sending a GPU batch and doing all the
  // blah blah blah seems likely to be more expensive overall
  const {repeatX, repeatY, mipmaps, scale} = config
  const pixSize = dim2.fromValues(source.width, source.height)
  const potSize = toTexSize(config, pixSize)
  function texImage2D (image :TexImageSource) {
    glc.bindTexture(GLC.TEXTURE_2D, tex)
    glc.texImage2D(GLC.TEXTURE_2D, 0, GLC.RGBA, GLC.RGBA, GLC.UNSIGNED_BYTE, image)
    if (mipmaps) glc.generateMipmap(GLC.TEXTURE_2D)
  }
  if ((repeatX || repeatY || mipmaps) && (potSize[0] != pixSize[0] && potSize[1] != pixSize[1])) {
    const scaled = document.createElement("canvas")
    scaled.width = potSize[0]
    scaled.height = potSize[1]
    const ctx = scaled.getContext("2d")
    if (!ctx) console.warn(`Failed to obtain Canvas2DContext`)
    else {
      if (source instanceof ImageData) {
        // TODO: how to properly handle ImageData?
        console.warn(`Cannot currently handle non-POT ImageData sources.`)
      } else {
        ctx.drawImage(source, 0, 0, potSize[0], potSize[1])
        texImage2D(scaled)
      }
    }
    return new Texture(glc, tex, config, potSize, scale.inv.scaledDim(pixSize))
  } else {
    texImage2D(source) // fast path, woo!
    return new Texture(glc, tex, config, pixSize)
  }
}

function makeErrorTexture (
  glc :GLC, config :TextureConfig, tex :WebGLTexture, size :dim2 = dim2.fromValues(100, 50)
) :Texture {
  const error = document.createElement("canvas")
  error.width = size[0]
  error.height = size[1]
  const ctx = error.getContext("2d")
  if (!ctx) console.warn(`Failed to obtain Canvas2DContext`) // ffs
  else {
    ctx.fillStyle = "red"
    ctx.fillRect(0, 0, error.width, error.height)
    ctx.textAlign = "center"
    ctx.fillStyle = "white"
    ctx.fillText("!ERROR!", error.width/2, error.height/2)
  }
  return imageToTexture(glc, error, config, tex)
}

export function makeTexture (
  glc :GLC, image :Subject<TexImageSource|Error>, config :Subject<TextureConfig>
) :Subject<Texture> {
  let tex :WebGLTexture|void = undefined
  return Subject.join2(image, config).mapTrace(() => {
    // nothing to do in onWake, we'll create our texture when we have our first `cfg`
  }, ([img, cfg]) => {
    if (!tex) tex = createTexture(glc, cfg)
    if (img instanceof Error) {
      console.log(`makeTexture() got error: ${img.message}`)
      return makeErrorTexture(glc, cfg, tex)
    }
    else return imageToTexture(glc, img, cfg, tex)
  }, _ => {
    if (tex) glc.deleteTexture(tex)
  })
}

/** A [[RenderTarget]] that renders to a [[Texture]]. */
export class TextureRenderTarget implements RenderTarget, Disposable {
  readonly fb :WebGLFramebuffer
  readonly scale :vec2

  constructor (readonly tex :Texture) {
    const glc = tex.glc
    const fb = glc.createFramebuffer()
    if (!fb) throw new Error(`Failed to create frame buffer: ${glc.getError()}`)
    this.fb = fb
    glc.bindFramebuffer(GLC.FRAMEBUFFER, fb)
    glc.framebufferTexture2D(GLC.FRAMEBUFFER, GLC.COLOR_ATTACHMENT0, GLC.TEXTURE_2D, tex, 0)
    checkError(glc, "framebufferTexture2D")
    const scale = this.tex.config.scale.factor
    this.scale = vec2.fromValues(scale, scale)
  }

  get size () :dim2 { return this.tex.size }
  get flip () :boolean { return false }

  bind () :void {
    this.tex.glc.bindFramebuffer(GLC.FRAMEBUFFER, this.fb)
    this.tex.glc.viewport(0, 0, this.size[0], this.size[1])
  }

  dispose () {
    this.tex.glc.deleteFramebuffer(this.fb)
  }
}

/** Returns a value with the current size of `window`, which updates when the size changes. */
export function windowSize (window :Window) :Value<dim2> {
  const size = Mutable.localEq(dim2.fromValues(window.innerWidth, window.innerHeight), dim2.eq)
  window.onresize = _ => size.update(dim2.fromValues(window.innerWidth, window.innerHeight))
  return size
}

/** Configuration for the [[Renderer]]. */
export type RendererConfig = {
  /** The size of the canvas into which we will render. For full screen windows, use [[windowSize]]. */
  size :Value<dim2>,
  /** The scale factor defining the ratio between display units and pixels. Usually
    * [[Window.devicePixelRatio]]. */
  scaleFactor :number,
  /** WebGL context configuration. */
  gl? :WebGLContextAttributes
}

export class Renderer {
  readonly canvas :HTMLCanvasElement
  readonly glc :GLC
  readonly target :RenderTarget
  readonly scale :Scale // TODO: support change in scale factor?
  readonly size :Value<dim2>

  constructor (config :RendererConfig) {
    const canvas = this.canvas = document.createElement("canvas")
    const glc = this.canvas.getContext("webgl", config.gl)
    if (!glc) throw new Error(`Unable to create WebGL rendering context.`)
    this.glc = glc

    // TODO: quad batch &c depends on this blend config, but maybe this is presumptuous?
    glc.enable(GLC.BLEND)
    glc.blendFunc(GLC.ONE, GLC.ONE_MINUS_SRC_ALPHA)
    glc.disable(GLC.CULL_FACE)

    const rend = this
    class DefaultRenderTarget implements RenderTarget {
      pixelSize = dim2.create()
      get size () { return this.pixelSize }
      get scale () { return vec2.fromValues(rend.scale.factor, rend.scale.factor) }
      get flip () { return true }
      bind () {
        rend.glc.bindFramebuffer(GLC.FRAMEBUFFER, null)
        rend.glc.viewport(0, 0, this.pixelSize[0], this.pixelSize[1])
      }
      dispose () {}
    }

    const target = this.target = new DefaultRenderTarget()
    const size = this.size = config.size
    const scale = this.scale = new Scale(config.scaleFactor)
    size.onValue(rsize => {
      // the frame buffer may be larger (or smaller) than the logical size, depending on whether
      // we're on a HiDPI display, or how the game has configured things (maybe they're scaling down
      // from native resolution to improve performance)
      const psize = scale.scaledDim(rsize)
      target.pixelSize = dim2.ceil(psize, psize)
      canvas.width = target.pixelSize[0]
      canvas.height = target.pixelSize[1]
      // set the canvas's CSS size to the logical size; the browser works in logical pixels
      canvas.style.width = `${rsize[0]}px`
      canvas.style.height = `${rsize[1]}px`
    })
  }
}
