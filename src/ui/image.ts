import {dim2, rect} from "../core/math"
import {Value} from "../core/react"
import {Element, ElementConfig, ElementContext} from "./element"
import {Spec} from "./style"

// TODO: we need an image spec which defines whether an image is HiDPI

/** Defines configuration for [[Image]] elements. */
export interface ImageConfig extends ElementConfig {
  type :"image"
  image :Spec<Value<string>>
  width? :number
  height? :number
}

/** Displays an image, which potentially varies based on the element state. */
export class Image extends Element {
  private image = this.observe<HTMLImageElement | Error | undefined>(undefined)

  constructor (ctx :ElementContext, parent :Element, readonly config :ImageConfig) {
    super(ctx, parent, config)
    const text = ctx.model.resolve(config.image)
    this.image.observe(text.toSubject().switchMap(path => ctx.style.image.resolve(path)))
  }

  dispose () {
    super.dispose()
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const image = this.image.current
    if (image instanceof HTMLImageElement) {
      dim2.set(into, this.getWidth(image), this.getHeight(image))
    }
  }

  protected relayout () {} // nothing needed

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    const image = this.image.current
    if (image instanceof HTMLImageElement) {
      canvas.drawImage(image, this.x, this.y, this.getWidth(image), this.getHeight(image))
    }
  }

  protected getWidth (img :HTMLImageElement) :number {
    const config = this.config
    if (config.width) return config.width
    else if (config.height) return (config.height / img.height) * img.width
    else return img.width
  }

  protected getHeight (img :HTMLImageElement) :number {
    const config = this.config
    if (config.height) return config.height
    else if (config.width) return (config.width / img.width) * img.height
    else return img.height
  }
}
