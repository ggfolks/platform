import {dim2} from "../core/math"
import {Color} from "../core/color"

export type ColorConfig = string | Color

export type ColorSpec = string

export function makeColorSpec (config? :ColorConfig) :ColorSpec {
  if (config === undefined) return "#000"
  else if (typeof config === "string") return config
  else return Color.toCSS(config)
}

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

export type FillFn = (canvas :CanvasRenderingContext2D, x :number, y :number) => void

export const NoopFillFn :FillFn = (canvas, x, y) => {}

export class FontSpec {
  readonly cssFont :string

  constructor (readonly config :FontConfig) {
    this.cssFont = toCanvasFont(config)
  }

  measureText (canvas :CanvasRenderingContext2D, text :string, into :dim2) :FillFn {
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

export function makeFontSpec (config? :FontConfig) :FontSpec {
  return new FontSpec(config || DefaultFontConfig)
}

export interface PatternConfig {
}

export interface GradientConfig {
  type :"linear"|"radial"
}

export interface LinearGradientConfig extends GradientConfig {
  type :"linear"
  start :[number,number]
  end :[number,number]
  stops? :ColorConfig[]
}

export interface RadialGradientConfig extends GradientConfig {
  type :"radial"
  start :[number,number,number]
  end :[number,number,number]
  stops? :ColorConfig[]
}

// TODO: create runtime objects from the above configs which create & cache the necessary CSS fiddly
// busineses needed to configure the Canvas prior to rendering

// ColorSpec
// GradientSpec
// PatternSpec
// FontSpec
