import {PMap, getValue, log} from "../core/util"
import {dim2, rect} from "../core/math"
import {dataEquals} from "../core/data"
import {Color} from "../core/color"
import {Subject} from "../core/react"
import {makeRoundRectPath, strokeLinePath, strokeRoundRectSide} from "./util"

/** Handles the resolution of images needed by style components. */
export interface ImageResolver {

  /** Resolves the image at `path`, eventually providing an HTML image or an error. Note that the
    * `path` is treated as opaque. An app will provide an image resolver that handles paths of a
    * particular sort (could be full URLs, could be paths relative to some root URL, could be
    * something totally different) and will then make reference to those paths in its style
    * definitions. */
  resolve (path :string) :Subject<HTMLImageElement|Error>
}

const SpecPrefix = "$"

/** Defines either an "immediate" style configuration or the id of style def. */
export type Spec<T> = string | T

function readDef<C> (type :string, defs :PMap<C>, id :string) :C {
  const config = defs[id.substring(1)]
  if (config) return config
  throw new Error(`Missing ${type} style def '${id}'`)
}

const NoPaint = Subject.constant<Paint|undefined>(undefined)

/** An equality function that can be used to compare style configs structurally.
  * There's no root type for style configs, so this is typed to operate on `any`. */
export const styleEquals :(a :any, b :any) => boolean = dataEquals

/** Defines styles which can be referenced by name in element configuration. */
export interface StyleDefs {
  colors      :PMap<ColorConfig>
  shadows     :PMap<ShadowConfig>
  fonts       :PMap<FontConfig>
  paints      :PMap<PaintConfig>
  borders     :PMap<BorderConfig>
  backgrounds :PMap<BackgroundConfig>
}

/** Provides style definitions for use when resolving styles, and other needed context. */
export class StyleContext {

  constructor (readonly styles :StyleDefs, readonly image :ImageResolver) {}

  resolveColor (spec :Spec<ColorConfig>) :string {
    if (typeof spec !== "string" || !spec.startsWith(SpecPrefix)) return makeCSSColor(spec)
    else return makeCSSColor(readDef("color", this.styles.colors, spec))
  }

  resolveShadow (spec :Spec<ShadowConfig>) :Shadow {
    const config = (typeof spec !== "string") ? spec : readDef("shadow", this.styles.shadows, spec)
    return new Shadow(config.offsetX, config.offsetY, config.blur, this.resolveColor(config.color))
  }
  resolveShadowOpt (spec :Spec<ShadowConfig>|undefined) :Shadow {
    return spec ? this.resolveShadow(spec) : NoShadow
  }

  resolveFont (spec :Spec<FontConfig>) :FontConfig {
    if (typeof spec !== "string") return spec
    else return readDef("font", this.styles.fonts, spec)
  }
  resolveFontOpt (spec :Spec<FontConfig>|undefined) :FontConfig {
    return spec ? this.resolveFont(spec) : DefaultFontConfig
  }

  // TODO: we should probably cache resolved borders, bgs & paints

  resolveBorder (spec :Spec<BorderConfig>) :Subject<Decoration> {
    if (typeof spec !== "string") return makeBorder(this, spec)
    else return makeBorder(this, readDef("border", this.styles.borders, spec))
  }

  resolveBackground (spec :Spec<BackgroundConfig>) :Subject<Decoration> {
    if (typeof spec !== "string") return makeBackground(this, spec)
    else return makeBackground(this, readDef("background", this.styles.backgrounds, spec))
  }

  resolvePaint (spec :Spec<PaintConfig>) :Subject<Paint> {
    if (typeof spec !== "string") return makePaint(this, spec)
    else return makePaint(this, readDef("paint", this.styles.paints, spec))
  }

  resolvePaintOpt (spec :Spec<PaintConfig>|undefined) :Subject<Paint|undefined> {
    return spec ? this.resolvePaint(spec) : NoPaint
  }
}

let scratch2D :CanvasRenderingContext2D|null = null
function requireScratch2D () :CanvasRenderingContext2D {
  if (!scratch2D) {
    const scratch = document.createElement("canvas")
    scratch2D = scratch.getContext("2d")
    if (!scratch2D) throw new Error(`Support for 2D canvas required`)
  }
  return scratch2D
}

//
// Insets

/** Padding and margin are either specified as a single value for all four sides, or as individual
  * values: `[top, right, bottom, left]`. */
export type Insets = number | [number,number,number,number]

export namespace Insets {

  export function width (insets :Insets) :number {
    return typeof insets === 'number' ? (2*insets) : (insets[1] + insets[3])
  }
  export function height (insets :Insets) :number {
    return typeof insets === 'number' ? (2*insets) : (insets[0] + insets[2])
  }
  export function rect (insets :Insets, source :rect, dest :rect) :rect {
    let top :number, right :number, bottom :number, left :number
    if (typeof insets === 'number') {
      left = insets ; right = insets ; top = insets ; bottom = insets
    } else {
      top = insets[0] ; right = insets[1] ; bottom = insets[2], left = insets[3]
    }
    dest[0] = source[0] + left
    dest[1] = source[1] + top
    dest[2] = source[2] - left - right
    dest[3] = source[3] - top - bottom
    return dest
  }

  /** Returns a CSS string that represents `insets`. */
  export function toCSS (insets :Insets) {
    return typeof insets === 'number' ? `${insets}` :
      `${insets[0]} ${insets[1]} ${insets[2]} ${insets[3]}`
  }
}

//
// Paint: color/gradient/pattern filling and stroking

// TODO: also allow JS array [a,r,g,b]? (Color is a float32array)
export type ColorConfig = string | Color

/** Configures a paint that uses a single color. */
export interface ColorPaintConfig {
  type :"color"
  color :Spec<ColorConfig>
}

/** Defines a color stop for a linear or radial gradient. */
export type ColorStop = [number, Spec<ColorConfig>]

// TODO: gradient configurations are specified in absolute pixel coordinates which is problematic;
// you don't know how big a space you'll need to fill until your widget is laid out, and you
// probably want your gradient defined in terms of that laid out space (so the gradient can smoothly
// go from top to bottom of your widget, say); we could allow gradients to be specified using
// fractions of the final laid out size, but then we'd need to instantiate paints after layout in
// Box which is kinda fiddly... still probably worth it eventually

/** Configures a paint that uses a linear gradient. */
export interface LinearGradientPaintConfig {
  type :"linear"
  /** The `x, y` coordinate of the start point of the gradient. */
  start :[number,number]
  /** The `x, y` coordinate of the end point of the gradient. */
  end :[number,number]
  /** Zero or more color stops which specify `[frac, color]` where `frac` is the fraction of
    * distance between `start` and `end` at which the gradient should be fully transitioned to
    * `color`. */
  stops? :ColorStop[]
}

/** Configures a paint that uses a radial gradient. */
export interface RadialGradientPaintConfig {
  type :"radial"
  /** The `x, y, r` coordinate of the start point of the gradient. */
  start :[number,number,number]
  /** The `x, y, r` coordinate of the end point of the gradient. */
  end :[number,number,number]
  /** Zero or more color stops which specify `[frac, color]` where `frac` is the fraction of
    * distance between `start` and `end` at which the gradient should be fully transitioned to
    * `color`. */
  stops? :ColorStop[]
}

type GradientPaintConfig = LinearGradientPaintConfig | RadialGradientPaintConfig

export type PatternRepeat = "repeat" | "repeat-x" | "repeat-y" | "no-repeat"

/** Configures a paint that uses an image pattern. */
export interface PatternPaintConfig {
  type :"pattern"
  image :string
  repeat? :PatternRepeat
}

/** Defines configuration for the various types of paints. */
export type PaintConfig = ColorPaintConfig
                        | GradientPaintConfig
                        | PatternPaintConfig

/** Configures a canvas to paint using a color, gradient or pattern. */
export abstract class Paint {

  abstract prepCSS (css :CSSStyleDeclaration) :void
  abstract prepStroke (canvas :CanvasRenderingContext2D) :void
  abstract prepFill (canvas :CanvasRenderingContext2D) :void
}

export function makePaint (ctx :StyleContext, config :PaintConfig) :Subject<Paint> {
  const type :string = config.type
  switch (config.type) {
  case   "color": return Subject.constant(new ColorPaint(ctx.resolveColor(config.color)))
  case  "linear":
  case  "radial": return Subject.constant(new GradientPaint(ctx, config))
  case "pattern": return ctx.image.resolve(config.image).map(img => {
      if (img instanceof HTMLImageElement) return new PatternPaint(img, config)
      // TODO: return error pattern
      else return new ColorPaint("#FF0000")
    })
  }
  // though TypeScript thinks we're safe here, our data may have been coerced from a config object,
  // so we need to handle the unexpected case
  throw new Error(`Unknown paint type '${type}' (in ${JSON.stringify(config)})`)
}

function makeCSSColor (config? :ColorConfig) :string {
  if (config === undefined) return "#000"
  else if (typeof config === "string") return config
  else return Color.toCSS(config)
}

class ColorPaint extends Paint {
  constructor (readonly color :string) { super() }

  prepCSS (css :CSSStyleDeclaration) {
    css.color = this.color
  }
  prepStroke (canvas :CanvasRenderingContext2D) {
    canvas.strokeStyle = this.color
  }
  prepFill (canvas :CanvasRenderingContext2D) {
    canvas.fillStyle = this.color
  }
}

class GradientPaint extends Paint {
  private gradient :CanvasGradient

  constructor (ctx :StyleContext, config :GradientPaintConfig) {
    super()
    const canvas = requireScratch2D()
    if (config.type === "radial") {
      const [x0, y0, r0] = config.start, [x1, y1, r1] = config.end
      this.gradient = canvas.createRadialGradient(x0, y0, r0, x1, y1, r1)
    } else {
      const [x0, y0] = config.start, [x1, y1] = config.end
      this.gradient = canvas.createLinearGradient(x0, y0, x1, y1)
    }
    (config.stops || []).forEach(
      ([frac, color]) => this.gradient.addColorStop(frac, ctx.resolveColor(color)))
  }

  prepCSS (css :CSSStyleDeclaration) {
    console.warn('TODO: how to sync gradient to CSS color') // TODO
  }
  prepStroke (canvas :CanvasRenderingContext2D) {
    canvas.strokeStyle = this.gradient
  }
  prepFill (canvas :CanvasRenderingContext2D) {
    canvas.fillStyle = this.gradient
  }
}

// TODO: pattern fills don't play well with HiDPI images: on a 2x HiDPI display the canvas is scaled
// 2x which causes a normal pattern image to be drawn at 2x the size, then if one uses a HiDPI image
// for the pattern, it's already 2x the size so we end up with a pattern that's 4x the size; I'm not
// sure if this can be fixed without major hackery...
class PatternPaint extends Paint {
  private pattern :CanvasPattern

  constructor (image :HTMLImageElement, config :PatternPaintConfig) {
    super()
    const pattern = requireScratch2D().createPattern(image, config.repeat || "repeat")
    if (pattern) this.pattern = pattern
    else throw new Error(`Failed to create pattern? [config=${JSON.stringify(config)}]`)
  }

  prepCSS (css :CSSStyleDeclaration) {
    console.warn('TODO: how to sync pattern to CSS color') // TODO
  }
  prepStroke (canvas :CanvasRenderingContext2D) {
    canvas.strokeStyle = this.pattern
  }
  prepFill (canvas :CanvasRenderingContext2D) {
    canvas.fillStyle = this.pattern
  }
}

export const DefaultPaint :Paint = new ColorPaint("#000000")

//
// Shadows

export interface ShadowConfig {
  offsetX :number
  offsetY :number
  blur :number
  color :Spec<ColorConfig>
}

export class Shadow {
  constructor (readonly ox :number, readonly oy :number, readonly blur :number, readonly color :string) {}

  prep (canvas :CanvasRenderingContext2D) {
    canvas.shadowOffsetX = this.ox
    canvas.shadowOffsetY = this.oy
    canvas.shadowBlur = this.blur
    canvas.shadowColor = this.color
  }
  reset (canvas :CanvasRenderingContext2D) {
    canvas.shadowOffsetX = 0
    canvas.shadowOffsetY = 0
    canvas.shadowBlur = 0
  }
}

export const NoShadow = new Shadow(0, 0, 0, "white")

//
// Fonts

export type FontWeight = "normal" | "bold" | "bolder" | "lighter" | number
export type FontStyle = "normal" | "italic" | "oblique"
export type FontVariant = "normal" | "small-caps"

export interface FontConfig {
  family :string
  size :number
  weight? :FontWeight
  style? :FontStyle
  variant? :FontVariant
}

export const DefaultFontConfig :FontConfig = {
  family: "Helvetica",
  size: 16
}

function toCanvasFont (config :FontConfig) :string {
  const weight = config.weight || "normal"
  const style = config.style || "normal"
  const variant = config.variant || "normal"
  return `${style} ${variant} ${weight} ${config.size}px ${config.family}`
}

//
// Backgrounds and borders

/** A decoration (border or background) contains a size ([top, right, bottom, left]) and a rendering
  * function. The canvas will be translated such that `0, 0` is the upper left of the region into
  * which the decoration should be rendered, and `size` indicates its size. */
export interface Decoration {
  size :[number, number, number, number]
  render (canvas :CanvasRenderingContext2D, size :dim2) :void
}

export namespace Decoration {

  /** A decoration that renders nothing. */
  export const Noop :Decoration = {size: [0, 0, 0, 0], render: () => {}}

  export const None = Subject.constant(Noop)

  /** Adds the sizes of the provided background and border to the bounds given, placing the result
    * in `out`. */
  export function addBounds (
    out :rect,
    bounds :rect,
    background :Decoration,
    border :Decoration,
  ) :rect {
    const backgroundSize = background.size
    const borderSize = border.size
    const top = Math.max(backgroundSize[0], borderSize[0])
    const right = Math.max(backgroundSize[1], borderSize[1])
    const bottom = Math.max(backgroundSize[2], borderSize[2])
    const left = Math.max(backgroundSize[3], borderSize[3])
    return rect.set(
      out,
      bounds[0] - left,
      bounds[1] - top,
      bounds[2] + left + right,
      bounds[3] + top + bottom,
    )
  }
}

export type FitConfig = "start" | "center" | "end" | "stretch"

/** Defines a background rendered behind a [[Box]]. */
export interface BackgroundConfig {
  /** The paint used to fill this background (if it is a filled background). */
  fill? :Spec<PaintConfig>
  /** The corner radius or radii ([ul, ur, lr, ll]) if a filled background is used. */
  cornerRadius? :number|number[]
  /** A shadow rendered behind this background. */
  shadow? :Spec<ShadowConfig>
  /** Defines an image which is rendered for the background. */
  image? :{
    /** The source URL for the image. Passed to the image resolver. */
    source :string
    /** The fit for the image on both x and y axes. Defaults to `center`. */
    fit? :FitConfig
    /** The fit for the image on the x axis. Supercedes `fit`, defaults to `center`. */
    fitX? :FitConfig
    /** The fit for the image on the y axis. Supercedes `fit`, defaults to `center`. */
    fitY? :FitConfig
  }
}

/** Creates a background based on the supplied `config`. */
export function makeBackground (ctx :StyleContext, config :BackgroundConfig) :Subject<Decoration> {
  if (config.fill) return ctx.resolvePaint(config.fill).map(fill => {
    const cornerRadius = config.cornerRadius
    const shadow = ctx.resolveShadowOpt(config.shadow)
    return {
      size: [
        Math.max(-shadow.oy, 0) + shadow.blur,
        Math.max(shadow.ox, 0) + shadow.blur,
        Math.max(shadow.oy, 0) + shadow.blur,
        Math.max(-shadow.ox, 0) + shadow.blur,
      ],
      render: (canvas, size) => {
        fill.prepFill(canvas)
        const w = size[0], h = size[1]
        shadow.prep(canvas)
        if (cornerRadius) {
          makeRoundRectPath(canvas, 0, 0, w, h, cornerRadius)
          canvas.fill()
        } else {
          canvas.fillRect(0, 0, w, h)
        }
        shadow.reset(canvas)
      }
    }
  })
  else if (config.image) {
    // TODO
    log.warn("TODO: support for background images.", "src", config.image.source)
    return Decoration.None
  }
  else {
    log.warn("Unknown background.", "config", config)
    return Decoration.None
  }
}

/** Defines a border rendered around a [[Box]]. */
export interface BorderConfig {
  /** The width or widths ([top, right, bottom, left]) of the line used to stroke this border. */
  width? :number|number[]
  /** The paint used to stroke this border. */
  stroke :Spec<PaintConfig>
  /** The corner radius or radii ([ul, ur, lr, ll]) of the border. */
  cornerRadius? :number|number[]
  /** A shadow rendered behind this border. */
  shadow? :Spec<ShadowConfig>
}

/** Creates a border based on the supplied `config`. */
export function makeBorder (ctx :StyleContext, config :BorderConfig) :Subject<Decoration> {
  return ctx.resolvePaint(config.stroke).map(stroke => {
    const lineWidth = getValue(config.width, 1)
    const lineWidths = Array.isArray(lineWidth)
      ? lineWidth
      : [lineWidth, lineWidth, lineWidth, lineWidth]
    const cornerRadius = config.cornerRadius
    const shadow = ctx.resolveShadowOpt(config.shadow)
    return {
      size: [
        Math.max(lineWidths[0], Math.max(-shadow.oy, 0) + shadow.blur),
        Math.max(lineWidths[1], Math.max(shadow.ox, 0) + shadow.blur),
        Math.max(lineWidths[2], Math.max(shadow.oy, 0) + shadow.blur),
        Math.max(lineWidths[3], Math.max(-shadow.ox, 0) + shadow.blur),
      ],
      render: (canvas, size) => {
        const oldWidth = canvas.lineWidth
        stroke.prepStroke(canvas)
        const w = size[0], h = size[1]
        shadow.prep(canvas)
        if (Array.isArray(lineWidth)) {
          if (cornerRadius) {
            const cornerRadii = Array.isArray(cornerRadius)
              ? cornerRadius
              : [cornerRadius, cornerRadius, cornerRadius, cornerRadius]
            strokeRoundRectSide(canvas, 0, 0, w, 0, cornerRadii[0], cornerRadii[1], lineWidths[0])
            strokeRoundRectSide(canvas, w, 0, w, h, cornerRadii[1], cornerRadii[2], lineWidths[1])
            strokeRoundRectSide(canvas, w, h, 0, h, cornerRadii[2], cornerRadii[3], lineWidths[2])
            strokeRoundRectSide(canvas, 0, h, 0, 0, cornerRadii[3], cornerRadii[0], lineWidths[3])
          } else {
            strokeLinePath(canvas, 0, 0, w, 0, lineWidths[0])
            strokeLinePath(canvas, w, 0, w, h, lineWidths[1])
            strokeLinePath(canvas, w, h, 0, h, lineWidths[2])
            strokeLinePath(canvas, 0, h, 0, 0, lineWidths[3])
          }
        } else {
          canvas.lineWidth = lineWidth
          if (cornerRadius) {
            makeRoundRectPath(canvas, 0, 0, w, h, cornerRadius)
            canvas.stroke()
          } else {
            canvas.strokeRect(0, 0, w, h)
          }
        }
        shadow.reset(canvas)
        canvas.lineWidth = oldWidth
      }
    }
  })
}

//
// Styled text

function computeBreaks (text :string) :[number, string][] {
  const breakRE = /\s+/g, breaks :[number, string][] = []
  let match :RegExpExecArray | null
  while ((match = breakRE.exec(text)) != null) breaks.push([match.index, match[0]])
  breaks.push([text.length, ""])
  return breaks
}

export type Wrap = {width :number, start :number, end :number}

/** A span of text in a particular style, all rendered in a single line. */
export class Span {
  readonly size = dim2.create()
  readonly text :string

  constructor (
    text :string,
    readonly font :FontConfig,
    readonly fill? :Paint,
    readonly stroke? :Paint,
    readonly shadow? :Shadow
  ) {
    if (!fill && !stroke) console.warn(`Span with neither fill nor stroke? [text=${text}]`)
    if (typeof text !== "string") throw new Error(`Invalid text ${text}`)
    this.text = text.replace(/\r\n|\r/g, "\n") // normalize newlines in the text
    const canvas = requireScratch2D()
    this.prepCanvas(canvas)
    const metrics = canvas.measureText(this.text)
    dim2.round(this.size, dim2.set(this.size, metrics.width, this.font.size))
    this.resetCanvas(canvas)
  }

  render (canvas :CanvasRenderingContext2D, x :number, y :number, wraps? :Wrap[]) {
    this.prepCanvas(canvas)
    const {fill, stroke, text} = this
    if (wraps) {
      for (const wrap of wraps) {
        const wtext = text.substring(wrap.start, wrap.end)
        fill && canvas.fillText(wtext, x, y)
        stroke && canvas.strokeText(wtext, x, y)
        y += this.size[1]
      }
    } else {
      fill && canvas.fillText(text, x, y)
      stroke && canvas.strokeText(text, x, y)
    }
    this.resetCanvas(canvas)
  }

  /** Measures the x offset of the character at position `offset`. This is the position at which the
    * cursor will be rendered when it is at that character offset into our text. */
  measureAdvance (offset :number) :number {
    // avoid measuring things if we can
    if (offset <= 0) return 0
    else if (offset >= this.text.length) return this.size[0]

    const canvas = requireScratch2D()
    this.prepCanvas(canvas)
    const metrics = canvas.measureText(this.text.substring(0, offset))
    this.resetCanvas(canvas)
    return Math.round(metrics.width)
  }


  /** Computes the character offset into this span's text of the specified `advance`. This is used
    * to position the cursor when the user clicks or taps on text at a particular position. */
  computeOffset (advance :number) :number {
    // if we're out of bounds, return one or the other end
    if (advance <= 0) return 0
    else if (advance >= this.size[0]) return this.text.length

    const canvas = requireScratch2D()
    this.prepCanvas(canvas)
    // yay, the canvas text APIs are the worst, so we have to do this binary search
    let minO = 0, minA = 0, maxO = this.size[0]
    while (maxO - minO > 1) {
      const testO = minO + Math.round((maxO-minO)/2)
      const testA = Math.round(canvas.measureText(this.text.substring(0, testO)).width)
      if (testA > advance) { maxO = testO }
      else { minO = testO ; minA = testA }
    }
    const maxA = Math.round(canvas.measureText(this.text.substring(0, maxO)).width)
    this.resetCanvas(canvas)
    return (maxA-advance < advance-minA) ? maxO : minO
  }

  computeWrap (width :number) :Wrap[] {
    const canvas = requireScratch2D()
    this.prepCanvas(canvas)

    try {
      const text = this.text, breaks = computeBreaks(text), wraps :Wrap[] = []
      let startc = 0, bcount = 0, lastwid = 0
      for (let bb = 0, bc = breaks.length; bb < bc; bb += 1) {
        const [bstart, bws] = breaks[bb]
        const linewid = canvas.measureText(text.substring(startc, bstart)).width
        if (linewid <= width) {
          if (bws.includes("\n")) {
            wraps.push({width: linewid, start: startc, end: bstart})
            startc = bstart + bws.length
            lastwid = 0
            bcount = 0
          } else {
            lastwid = linewid
            bcount += 1
          }

        } else if (bcount > 0) {
          bb -= 1
          const [lbstart, lbws] = breaks[bb]
          wraps.push({width: lastwid, start: startc, end: lbstart})
          startc = lbstart + lbws.length
          lastwid = 0
          bcount = 0

        } else {
          const emwidth = canvas.measureText("m").width
          let hardlen = Math.floor(width/emwidth)
          let hardwidth = canvas.measureText(text.substring(startc, startc+hardlen)).width
          while (hardwidth < width) {
            const nlen = hardlen+1
            const nwid = canvas.measureText(text.substring(startc, startc+nlen)).width
            if (nwid <= width) {
              hardlen = nlen
              hardwidth = nwid
            } else break
          }
          wraps.push({width: hardwidth, start: startc, end: startc+hardlen})
          startc = startc+hardlen
          bb -= 1
        }
      }

      wraps.push({width: lastwid, start: startc, end: text.length})
      return wraps

    } finally {
      this.resetCanvas(canvas)
    }
  }

  syncStyle (css :CSSStyleDeclaration) {
    css.font = toCanvasFont(this.font)
    if (this.fill) this.fill.prepCSS(css)
    else css.color = ""
    // TODO: stroke, shadow?
  }

  private prepCanvas (canvas :CanvasRenderingContext2D) {
    canvas.textAlign = "start"
    canvas.textBaseline = "top"
    canvas.font = toCanvasFont(this.font)
    this.fill && this.fill.prepFill(canvas)
    this.stroke && this.stroke.prepStroke(canvas)
    if (this.shadow) this.shadow.prep(canvas)
  }
  private resetCanvas (canvas :CanvasRenderingContext2D) {
    if (this.shadow) this.shadow.reset(canvas)
  }
}

export const EmptySpan = new Span("", DefaultFontConfig, undefined, DefaultPaint, undefined)
