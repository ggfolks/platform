import {dim2, rect} from "../core/math"
import {Buffer, Source} from "../core/react"
import {Scale} from "../core/ui"
import {Element} from "./element"
import {ModelValue} from "./model"
import {Spec} from "./style"

type ImageSpec = {path :string, scaleFactor :number}

/** Defines configuration for [[Image]] elements. */
export interface ImageConfig extends Element.Config {
  type :"image"
  image :Spec<Source<ImageSpec|string>>
  width? :number
  height? :number
}

/** Displays an image, which potentially varies based on the element state. */
export class Image extends Element {
  private image = this.observe<HTMLImageElement|undefined>(undefined)
  private scaleFactor = 1

  constructor (ctx :Element.Context, parent :Element, readonly config :ImageConfig) {
    super(ctx, parent, config)
    this.disposer.add(ctx.model.resolveAs(config.image, "image").onValue(spec => {
      const path = typeof spec === "string" ? spec : spec.path
      if (path === "") this.image.update(undefined)
      else {
        this.image.observe(ctx.style.loader.getImage(path))
        this.scaleFactor = typeof spec === "string" ? 1 : spec.scaleFactor
      }
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
    if (image) canvas.drawImage(image, this.x, this.y, this.getWidth(image), this.getHeight(image))
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

export class CanvasImage implements ModelValue {
  readonly canvas :Buffer<HTMLCanvasElement>
  private readonly rctx :CanvasRenderingContext2D

  constructor (readonly scale :Scale, readonly width :number, readonly height :number) {
    const canvas = document.createElement("canvas")
    canvas.width = Math.ceil(scale.scaled(width))
    canvas.height = Math.ceil(scale.scaled(height))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    this.canvas = Buffer.create(canvas)

    const rctx = canvas.getContext("2d")
    if (rctx) this.rctx = rctx
    else throw new Error(`No 2D rendering context for <canvas>?!`)
    rctx.scale(scale.factor, scale.factor)
  }

  render (fn :(ctx :CanvasRenderingContext2D) => void) {
    fn(this.rctx)
    this.canvas.updated()
  }
}

/** Defines configuration for [[Canvas]] elements. */
export interface CanvasConfig extends Element.Config {
  type :"canvas"
  image :Spec<CanvasImage>
}

/** Displays an image, which potentially varies based on the element state. */
export class Canvas extends Element {
  private readonly image :CanvasImage

  constructor (ctx :Element.Context, parent :Element, readonly config :CanvasConfig) {
    super(ctx, parent, config)
    this.image = ctx.model.resolveAs(config.image, "image")
    this.invalidateOnChange(this.image.canvas)
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.set(into, this.image.width, this.image.height)
  }

  protected relayout () {} // nothing needed

  protected rerender (ctx :CanvasRenderingContext2D, region :rect) {
    const {canvas, width, height} = this.image
    ctx.drawImage(canvas.current, this.x, this.y, width, height)
  }
}

export const ImageCatalog :Element.Catalog = {
  "image": (ctx, parent, cfg) => new Image(ctx, parent, cfg as ImageConfig),
  "canvas": (ctx, parent, cfg) => new Canvas(ctx, parent, cfg as CanvasConfig),
}
