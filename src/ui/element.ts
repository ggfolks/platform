import {dim2, rect, vec2} from "../core/math"
import {Record} from "../core/data"
import {Value, Mutable, Remover} from "../core/react"
import {Scale} from "../core/ui"
import {Background, BackgroundConfig} from "./background"

const tmpr = rect.create()
const trueValue = Value.constant(true)

/** Used to create runtime components from configuration data. */
export interface ElementFactory {

  /** Creates a background based on `config`. */
  createBackground (config :BackgroundConfig) :Background

  /** Creates an element based on `config`. */
  createElement (config :ElementConfig) :Element
}

/** Configuration shared by all [[Element]]s. */
export interface ElementConfig {
  type :string
  enabled? :Value<boolean> // TODO: move to Widget/Control?
  visible? :Value<boolean>
  constraints? :Record
}

/** The basic building block of UIs. Elements have a bounds, are part of a UI hierarchy (have a
  * parent, except for the root element), and participate in the cycle of invaldiation, validation
  * and rendering. */
export abstract class Element {
  protected readonly _bounds :rect = rect.create()
  protected readonly _psize :dim2 = dim2.fromValues(-1, -1)
  protected _parent? :Element = undefined
  protected _valid = Mutable.local(false)
  protected _onRemoved :Remover[] = []

  constructor () {}

  abstract get config () :ElementConfig

  get x () :number { return this._bounds[0] }
  get y () :number { return this._bounds[1] }
  get width () :number { return this._bounds[2] }
  get height () :number { return this._bounds[3] }

  get enabled () :Value<boolean> { return this.config.enabled || trueValue }
  get visible () :Value<boolean> { return this.config.visible || trueValue }
  get valid () :Value<boolean> { return this._valid }

  get root () :Root|undefined { return this._parent ? this._parent.root : undefined }

  pos (into :vec2) :vec2 {
    into[0] = this.x
    into[1] = this.y
    return into
  }
  size (into :dim2) :dim2 {
    into[0] = this.width
    into[1] = this.height
    return into
  }

  preferredSize (hintX :number, hintY :number) :dim2 {
    const psize = this._psize
    if (psize[0] < 0) this.computePreferredSize(hintX, hintY, psize)
    return psize
  }

  setBounds (bounds :rect) {
    const obounds = this._bounds, changed = obounds[2] !== bounds[2] || obounds[3] !== bounds[3]
    rect.copy(obounds, bounds)
    if (changed) this.invalidate()
  }

  validate () {
    if (!this._valid.current) {
      this.revalidate()
      this._valid.update(true)
    }
  }

  abstract render (canvas :CanvasRenderingContext2D) :void

  protected wasParented (parent :Element) {
    this._parent = parent
  }
  protected wasUnparented () {
    this._parent = undefined
  }

  protected wasAdded () {
    this._onRemoved.push(this.enabled.onValue(_ => this.invalidate()))
    this._onRemoved.push(this.visible.onValue(_ => this.invalidate()))
    // TODO: do we want hierarchy changed event?
  }
  protected wasRemoved () {
    this._onRemoved.forEach(r => r())
    this._onRemoved = []
  }

  protected invalidate () {
    // TODO: clear preferred size
    if (this._valid.current) {
      this._valid.update(false)
      this._parent && this._parent.invalidate()
    }
  }
  protected revalidate () {
    if (this.visible.current) this.relayout()
  }

  protected abstract computePreferredSize (hintX :number, hintY :number, into :dim2) :void
  protected abstract relayout () :void

  // TODO: willAdd, willRemove, willDispose?
}

/** Defines configuration for [[Root]] elements. */
export interface RootConfig extends ElementConfig {
  type :"root"
  scale :Scale
  child :ElementConfig
}

/** The top-level of the UI hierarchy. Manages the canvas into which the UI is rendered. */
export class Root extends Element {
  private canvas :HTMLCanvasElement = document.createElement("canvas")
  readonly child :Element

  constructor (readonly fact :ElementFactory, readonly config :RootConfig) {
    super()
    this.child = fact.createElement(config.child)
  }

  get root () :Root|undefined { return this }

  pack (width :number, height :number) :HTMLCanvasElement {
    this.setBounds(rect.set(tmpr, 0, 0, width, height))
    this.validate()
    const ctx = this.canvas.getContext("2d")
    ctx && this.render(ctx)
    return this.canvas
  }

  render (canvas :CanvasRenderingContext2D) {
    this.child.render(canvas)
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.copy(into, this.child.preferredSize(hintX, hintY))
  }

  protected relayout () {
    this.child.setBounds(this._bounds)
  }

  protected revalidate () {
    super.revalidate()
    const canvas = this.canvas, toPixel = this.config.scale
    canvas.width = Math.ceil(toPixel.scaled(this.width))
    canvas.height = Math.ceil(toPixel.scaled(this.height))
    canvas.style.width = `${this.width}px`
    canvas.style.height = `${this.height}px`
    console.log(`Resized canvas ${canvas.width}x${canvas.height} & ${this.width}x${this.height}`)
    this.child.validate()
  }
}
