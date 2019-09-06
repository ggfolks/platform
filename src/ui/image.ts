import {dim2, rect} from "../core/math"
import {PMap} from "../core/util"
import {Element, ElementConfig, ElementContext} from "./element"
import {Spec} from "./style"

// TODO: we need an image spec which defines whether an image is HiDPI
export interface ImageStyle {
  image :Spec<string>
}

/** Defines configuration for [[Image]] elements. */
export interface ImageConfig extends ElementConfig {
  type :"image"
  style :PMap<ImageStyle>
}

/** Displays an image, which potentially varies based on the element state. */
export class Image extends Element {
  private image = this.observe<HTMLImageElement | Error | undefined>(undefined)

  constructor (ctx :ElementContext, parent :Element, readonly config :ImageConfig) {
    super(ctx, parent, config)
    this.disposer.add(this.state.onValue(state => {
      const style = this.getStyle(this.config.style, state)
      this.image.observe(ctx.style.image.resolve(style.image));
    }))
  }

  get style () :ImageStyle { return this.getStyle(this.config.style, this.state.current) }

  dispose () {
    super.dispose()
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const image = this.image.current
    if (image instanceof HTMLImageElement) dim2.set(into, image.width, image.height)
  }

  protected relayout () {} // nothing needed

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    const image = this.image.current, {x, y} = this
    if (image instanceof HTMLImageElement) canvas.drawImage(image, x, y)
  }
}
