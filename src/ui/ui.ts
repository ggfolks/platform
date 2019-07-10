import {Element, ElementConfig, ElementFactory} from "./element"
import * as B from "./box"
import * as G from "./group"
import * as BG from "./background"

export {Root, RootConfig} from "./element"

type SomeBackgroundConfig = BG.SolidBackgroundConfig
type SomeElementConfig = B.BoxConfig | G.ColumnConfig

export class UI implements ElementFactory {

  // TODO: top-level style sheet, etc.
  constructor () {}

  createBackground (config :BG.BackgroundConfig) :BG.Background {
    const cfg = config as SomeBackgroundConfig
    switch (cfg.type) {
    case "solid": return BG.solidBackground(cfg)
    default: throw new Error(`Unknown background type '${config.type}'.`)
    }
  }

  createElement (config :ElementConfig) :Element {
    const cfg = config as SomeElementConfig
    switch (cfg.type) {
    case "column": return new G.Column(this, cfg)
    case    "box": return new B.Box(this, cfg)
    default: throw new Error(`Unknown element type '${config.type}'.`)
    }
  }
}
