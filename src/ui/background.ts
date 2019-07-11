import {rect} from "../core/math"
import {ColorConfig, makeColorSpec} from "./style"

/** Configuration shared by all [[Background]]s. */
export interface BackgroundConfig {
  type :string
}

/** Renders a background for a [[Box]] to `canvas` with bounds `rect`. */
export type Background = (canvas :CanvasRenderingContext2D, bounds :rect) => void

export interface SolidBackgroundConfig {
  type :"solid"
  color :ColorConfig
}

export function solidBackground (config :SolidBackgroundConfig) :Background {
  const cssColor = makeColorSpec(config.color)
  return (canvas, bounds) => {
    canvas.fillStyle = cssColor
    canvas.fillRect(bounds[0], bounds[1], bounds[2], bounds[3])
  }
}
