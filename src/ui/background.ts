import {rect} from "../core/math"
import {Color} from "../core/color"

/** Configuration shared by all [[Background]]s. */
export interface BackgroundConfig {
  type :string
}

/** Renders a background for a [[Box]] to `canvas` with bounds `rect`. */
export type Background = (canvas :CanvasRenderingContext2D, bounds :rect) => void

export type BackgroundColor = string | Color

export interface SolidBackgroundConfig {
  type :"solid"
  color :BackgroundColor
}

export function solidBackground (config :SolidBackgroundConfig) :Background {
  const cssColor = typeof config.color === "string" ? config.color : Color.toCSS(config.color)
  return (canvas, bounds) => {
    console.log(`solidBackground(${cssColor} @ ${bounds})`)
    canvas.fillStyle = cssColor
    canvas.fillRect(bounds[0], bounds[1], bounds[2], bounds[3])
  }
}
