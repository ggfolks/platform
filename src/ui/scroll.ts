import {vec2} from "../core/math"
import {Control, ControlConfig, Element, ElementContext, MouseInteraction} from "./element"

/** Provides a scrolling window onto its contents. */
export interface ScrollViewConfig extends ControlConfig {
  type :"scrollpane"
}

export class ScrollView extends Control {

  constructor (ctx :ElementContext, parent :Element, readonly config :ScrollViewConfig) {
    super(ctx, parent, config)
  }

  handleMouseDown (event :MouseEvent, pos :vec2) :MouseInteraction|undefined {
    if (event.button !== 0) return undefined
    return {
      move: (event, pos) => {},
      release: () => {},
      cancel: () => {},
    }
  }

  protected rerender (canvas :CanvasRenderingContext2D) {
    this.contents.render(canvas)
  }
}
