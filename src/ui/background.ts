import {dim2} from "../core/math"
import {Subject, Value} from "../core/react"
import {ImageResolver, PaintConfig, Paint, makePaint} from "./style"

export type FitConfig = "start"| "center"  | "end" | "stretch"

/** Configures a [[Background]] instance. */
export interface BackgroundConfig {
  /** Defines a paint used to fill this background. */
  fill? :PaintConfig
  /** Defines the corner radius if a filled background is used. */
  cornerRadius? :number
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
  // TODO: insets
  // TODO: shadow
}

/** Renders backgrounds. */
export abstract class Background {

  /** Render this background to `canvas`. The canvas will be translated such that `0, 0` is the
    * upper left of the region into which the background should be rendered, and `size` indicates
    * its size. */
  abstract render (canvas :CanvasRenderingContext2D, size :dim2) :void
}

/** Creates a [[Background]] based on the supplied `config`. */
export function makeBackground (
  resolver :ImageResolver, config :BackgroundConfig
) :Subject<Background> {
  if (config.fill) return makePaint(resolver, config.fill).map(fill => {
    return new FilledBackground(fill, config)
  })
  // TODO
  else if (config.image) return Value.constant(NoBackground)
  // TODO: log a warning?
  else return Value.constant(NoBackground)
}

class BlankBackground extends Background {
  constructor () { super() }
  render (canvas :CanvasRenderingContext2D, size :dim2) {} // noop!
}

export const NoBackground :Background = new BlankBackground()

class FilledBackground extends Background {
  cornerRadius? :number

  constructor (readonly fill :Paint, config :BackgroundConfig) {
    super()
    this.cornerRadius = config.cornerRadius
  }

  render (canvas :CanvasRenderingContext2D, size :dim2) {
    this.fill.prepFill(canvas)
    const radius = this.cornerRadius
    const w = size[0], h = size[1]
    if (radius) {
      const midx = w/2, midy = h/2, maxx = w, maxy = h
      canvas.beginPath()
      canvas.moveTo(0, midy)
      canvas.arcTo(0, 0, midx, 0, radius)
      canvas.arcTo(maxx, 0, maxx, midy, radius)
      canvas.arcTo(maxx, maxy, midx, maxy, radius)
      canvas.arcTo(0, maxy, 0, midy, radius)
      canvas.closePath()
      canvas.fill()
    } else {
      canvas.fillRect(0, 0, w, h)
    }
  }
}
