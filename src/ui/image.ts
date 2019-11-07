import {dim2, rect} from "../core/math"
import {Value} from "../core/react"
import {Element, ElementConfig, ElementContext} from "./element"
import {Spec} from "./style"

type ImageSpec = {path :string, scaleFactor :number}

/** Defines configuration for [[Image]] elements. */
export interface ImageConfig extends ElementConfig {
  type :"image"
  image :Spec<Value<ImageSpec|string>>
  width? :number
  height? :number
}

/** Displays an image, which potentially varies based on the element state. */
export class Image extends Element {
  private image = this.observe<HTMLImageElement | Error | undefined>(undefined)
  private scaleFactor = 1

  constructor (ctx :ElementContext, parent :Element, readonly config :ImageConfig) {
    super(ctx, parent, config)
    this.disposer.add(ctx.model.resolve(config.image).onValue(spec => {
      const path = typeof spec === "string" ? spec : spec.path
      this.image.observe(ctx.style.image.resolve(path))
      this.scaleFactor = typeof spec === "string" ? 1 : spec.scaleFactor
    }))
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const image = this.image.current
    if (image instanceof HTMLImageElement) dim2.set(
      into, this.getWidth(image), this.getHeight(image))
    else dim2.set(into, this.config.width || 0, this.config.height || 0)
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
    else if (config.height) return (config.height / this.scale(img.height)) * this.scale(img.width)
    else return this.scale(img.width)
  }

  protected getHeight (img :HTMLImageElement) :number {
    const config = this.config
    if (config.height) return config.height
    else if (config.width) return (config.width / this.scale(img.width)) * this.scale(img.height)
    else return this.scale(img.height)
  }

  protected scale (size :number) { return size / this.scaleFactor }
}
