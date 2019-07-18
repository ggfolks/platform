import {dim2} from "../core/math"
import {Color} from "../core/color"
import {Subject, Value} from "../core/react"

// Todo: ImageConfig = string | {source/path/url :string, scale :number} | ?

export interface ImageResolver {

  resolveImage (path :string) :Subject<HTMLImageElement|Error>
}

//
// Font rendering

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

const DefaultFontConfig :FontConfig = {
  family: "Helvetica",
  size: 16
}

function toCanvasFont (config :FontConfig) :string {
  const weight = config.weight || "normal"
  const style = config.style || "normal"
  const variant = config.variant || "normal"
  return `${style} ${variant} ${weight} ${config.size}px ${config.family}`
}

export type DrawFn = (canvas :CanvasRenderingContext2D, x :number, y :number) => void

export const NoopDrawFn :DrawFn = (canvas, x, y) => {}

export class Font {
  readonly cssFont :string

  constructor (readonly config :FontConfig) {
    this.cssFont = toCanvasFont(config)
  }

  measureText (canvas :CanvasRenderingContext2D, text :string, into :dim2) :DrawFn {
    canvas.font = this.cssFont
    const metrics = canvas.measureText(text)
    into[0] = metrics.width
    // TODO: blah, of course Firefox doesn't support anything but TM.width; we'll need to do a bunch
    // of fucking around with CSS and hidden divs to measure text; le sigh...
    into[1] = ('emHeightAscent' in metrics) ?
      // TODO: we probably ultimately need to use actualBoundingBox here but then I'd like some way
      // to configure multiple labels to share the same baseline even if they contain glyphs of
      // differing heights
      metrics.emHeightAscent + metrics.emHeightDescent :
      this.config.size

    return (canvas, x, y) => {
      canvas.font = this.cssFont
      const ascent = ("emHeightAscent" in metrics) ? metrics.emHeightAscent : this.config.size
      canvas.fillText(text, x, y + ascent)
    }
  }
}

export function makeFont (config? :FontConfig) :Font {
  return new Font(config || DefaultFontConfig)
}

//
// Paint: color/gradient/pattern filling and stroking

export type ColorConfig = string | Color

/** Configures a paint that uses a single color. */
export interface ColorPaintConfig {
  type :"color"
  color :ColorConfig
}

/** Defines a color stop for a linear or radial gradient. */
export type ColorStop = [number, ColorConfig]

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

  abstract prepStroke (canvas :CanvasRenderingContext2D) :void
  abstract prepFill (canvas :CanvasRenderingContext2D) :void
}

export function makePaint (resolver :ImageResolver, config :PaintConfig) :Subject<Paint> {
  const type :string = config.type
  switch (config.type) {
  case   "color": return Value.constant(new ColorPaint(makeCSSColor(config.color)))
  case  "linear":
  case  "radial": return Value.constant(new GradientPaint(config))
  case "pattern": return resolver.resolveImage(config.image).map(img => {
      if (img instanceof HTMLImageElement) return new PatternPaint(img, config)
      // TODO: return error pattern
      else return new ColorPaint("#FF0000")
    })
  }
  // though TypeScript thinks we're safe here, our data may have been coerced from a config object,
  // so we need to handle the unexpected case
  throw new Error(`Unknown paint type '${type}'`)
}

function makeCSSColor (config? :ColorConfig) :string {
  if (config === undefined) return "#000"
  else if (typeof config === "string") return config
  else return Color.toCSS(config)
}

class ColorPaint extends Paint {
  constructor (readonly color :string) { super() }
  prepStroke (canvas :CanvasRenderingContext2D) {
    canvas.strokeStyle = this.color
  }
  prepFill (canvas :CanvasRenderingContext2D) {
    canvas.fillStyle = this.color
  }
}

class GradientPaint extends Paint {
  private gradient? :CanvasGradient
  constructor (readonly config :GradientPaintConfig) { super() }

  prepStroke (canvas :CanvasRenderingContext2D) {
    canvas.strokeStyle = this.prepStyle(canvas)
  }
  prepFill (canvas :CanvasRenderingContext2D) {
    canvas.fillStyle = this.prepStyle(canvas)
  }

  private prepStyle (canvas :CanvasRenderingContext2D) :CanvasGradient {
    function make (config :GradientPaintConfig) :CanvasGradient {
      let gradient :CanvasGradient
      if (config.type === "radial") {
        const [x0, y0, r0] = config.start, [x1, y1, r1] = config.end
        gradient = canvas.createRadialGradient(x0, y0, r0, x1, y1, r1)
      } else {
        const [x0, y0] = config.start, [x1, y1] = config.end
        gradient = canvas.createLinearGradient(x0, y0, x1, y1)
      }
      (config.stops || []).forEach(
        ([frac, color]) => gradient.addColorStop(frac, makeCSSColor(color)))
      return gradient
    }
    return this.gradient ? this.gradient : (this.gradient = make(this.config))
  }
}

// TODO: pattern fills don't play well with HiDPI images: on a 2x HiDPI display the canvas is scaled
// 2x which causes a normal pattern image to be drawn at 2x the size, then if one uses a HiDPI image
// for the pattern, it's already 2x the size so we end up with a pattern that's 4x the size; I'm not
// sure if this can be fixed without major hackery...
class PatternPaint extends Paint {
  private pattern? :CanvasPattern
  constructor (readonly image :HTMLImageElement, readonly config :PatternPaintConfig) { super() }

  prepStroke (canvas :CanvasRenderingContext2D) {
    canvas.strokeStyle = this.prepStyle(canvas)
  }
  prepFill (canvas :CanvasRenderingContext2D) {
    canvas.fillStyle = this.prepStyle(canvas)
  }

  private prepStyle (canvas :CanvasRenderingContext2D) :CanvasPattern {
    if (this.pattern) return this.pattern
    const pattern = canvas.createPattern(this.image, this.config.repeat || "repeat")
    if (pattern) return this.pattern = pattern
    throw new Error(`Failed to create pattern? [config=${JSON.stringify(this.config)}]`)
  }
}

export const DefaultPaint :Paint = new ColorPaint("#FF0000")

//
// Shadows

export interface ShadowConfig {
  offsetX :number
  offsetY :number
  blur :number
  color :ColorConfig
}

export function prepShadow (canvas :CanvasRenderingContext2D, config :ShadowConfig) {
  canvas.shadowOffsetX = config.offsetX
  canvas.shadowOffsetY = config.offsetY
  canvas.shadowBlur = config.blur
  canvas.shadowColor = makeCSSColor(config.color)
}

export function resetShadow (canvas :CanvasRenderingContext2D) {
  canvas.shadowOffsetX = 0
  canvas.shadowOffsetY = 0
  canvas.shadowBlur = 0
}
