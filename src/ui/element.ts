import {Disposable} from "../core/util"
import {dim2, rect, vec2} from "../core/math"
import {Record} from "../core/data"
import {Emitter, Mutable, Remover, Source, Value, NoopRemover} from "../core/react"
import {Scale} from "../core/ui"
import {ImageResolver} from "./style"

const tmpr = rect.create()
const tmpv = vec2.create()
const trueValue = Value.constant(true)

/** Used by elements to observe reactive values. Takes care of invalidating the element when the
  * value changes, clearing old listeners when switching sources, and cleaning up when the element
  * is disposed. */
export class Observer<T> implements Disposable {
  private remover = NoopRemover

  constructor (public owner :Element, public current :T) {}

  /** Updates this observed property with (the non-reactive) `value` and invalidates the owning
    * element. */
  update (value :T) {
    this.remover()
    this.current = value
    this.owner.invalidate()
  }

  /** Updates this observed property with (the reactive) `value`. The owning element will be
    * invalidated when the first value is received and again if it changes. */
  observe (value :Source<T>) {
    this.remover()
    this.remover = value.onValue(v => {
      this.current = v
      this.owner.invalidate()
    })
  }

  dispose () {
    this.remover()
  }
}

/** Defines a path to a reactive property in a model, or an immediate value to be used. */
export type Prop<T> = string | Value<T>

/** Defines a path to an event emitter in a model, or an immediate emitter to be used. */
export type Sink<T> = string | Emitter<T>

/** Used to create runtime components from configuration data. */
export interface ElementFactory extends ImageResolver {

  /** Creates an element based on `config`. */
  createElement (parent :Element, config :ElementConfig) :Element

  /** Resolves the property `prop` via the UI model if appropriate. */
  resolveProp<T> (prop :Prop<T>) :Value<T>

  /** Resolves the event `sink` via the UI model if appropriate. */
  resolveSink<T> (sink :Sink<T>) :Emitter<T>
}

/** Enumerates the states an [[Element]] can be in, i.e. `normal` or `disabled`. Elements may be
  * styled differently depending on their state. */
export type ElementState = "normal" | "disabled"

/** Defines the style configurations for an [[Element]]. */
export interface ElementStyle {
  // nothing shared by all elements
}

/** Configuration shared by all [[Element]]s. */
export interface ElementConfig {
  type :string
  visible? :Prop<boolean>
  enabled? :Prop<boolean> // TODO: move to Widget/Control?
  constraints? :Record
  style? :{[key in ElementState] :ElementStyle}
  // this allows ElementConfig to contain "extra" stuff that TypeScript will ignore; this is
  // necessary to allow a subtype of ElementConfig to be supplied where a container element wants
  // some sort of ElementConfig; we can only plumb sharp types so deep
  [extra :string] :any
}

/** The basic building block of UIs. Elements have a bounds, are part of a UI hierarchy (have a
  * parent, except for the root element), and participate in the cycle of invaldiation, validation
  * and rendering. */
export abstract class Element implements Disposable {
  protected readonly _bounds :rect = rect.create()
  protected readonly _psize :dim2 = dim2.fromValues(-1, -1)
  protected _state = Mutable.local("normal") as Mutable<ElementState> // TODO: meh
  protected _valid = Mutable.local(false)
  protected _onDispose :Remover[] = []

  readonly visible :Value<boolean>
  readonly enabled :Value<boolean>

  constructor (fact :ElementFactory,
               readonly parent :Element|undefined,
               readonly config :ElementConfig) {
    this.noteDependentValue(this._state)
    if (!config.visible) this.visible = trueValue
    else this.noteDependentValue(this.visible = fact.resolveProp(config.visible))
    if (!config.enabled) this.enabled = trueValue
    else {
      this.enabled = fact.resolveProp(config.enabled)
      this._onDispose.push(this.enabled.onValue(_ => this._state.update(this.computeState)))
    }
  }

  get x () :number { return this._bounds[0] }
  get y () :number { return this._bounds[1] }
  get width () :number { return this._bounds[2] }
  get height () :number { return this._bounds[3] }
  get bounds () :rect { return this._bounds }

  get valid () :Value<boolean> { return this._valid }

  get root () :Root|undefined { return this.parent ? this.parent.root : undefined }

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

  invalidate () {
    if (this._valid.current) {
      this._valid.update(false)
      this._psize[0] = -1 // force psize recompute
      this.parent && this.parent.invalidate()
    }
  }

  validate () :boolean {
    if (this._valid.current) return false
    this.revalidate()
    this._valid.update(true)
    return true
  }

  abstract render (canvas :CanvasRenderingContext2D) :void

  /** Requests that this element handle the supplied mouse down event.
    * @param event the event forwarded from the browser.
    * @param pos the position of the event relative to the root origin.
    * @return an interaction if an element started an interaction with the mouse, `undefined`
    * otherwise. */
  handleMouseDown (event :MouseEvent, pos :vec2) :MouseInteraction|undefined {
    return undefined
  }

  dispose () {
    this._onDispose.forEach(r => r())
    this._onDispose = []
  }

  toString () {
    return `${this.constructor.name}@${this._bounds}`
  }

  // note: to type this properly, Element would need to be parameterized on the type of its state so
  // that subclasses could parameterize themselves on an extension of that state; but this would
  // leak irrelevant type machinery out to users of Element which is definitely not worth it, so
  // instead we just force subclasses to cast their extended state back to ElementState and rely on
  // them handling their extended state in the appropriate places
  protected get computeState () :ElementState {
    return this.enabled.current ? "normal" : "disabled"
  }

  protected noteDependentValue (value :Source<any>) {
    this._onDispose.push(value.onValue(_ => this.invalidate()))
  }

  protected observe<T> (initial :T) :Observer<T> {
    const obs = new Observer(this, initial)
    this._onDispose.push(() => obs.dispose())
    return obs
  }

  protected revalidate () {
    if (this.visible.current) this.relayout()
  }

  protected abstract computePreferredSize (hintX :number, hintY :number, into :dim2) :void
  protected abstract relayout () :void
}

/** Encapsulates a mouse interaction with an element. When the mouse button is pressed over an
  * element, it can start an interaction which will then handle subsequent mouse events until the
  * button is released or the interaction is canceled. */
export type MouseInteraction = {
  /** Called when the pointer is moved while this interaction is active. */
  move: (moveEvent :MouseEvent, pos :vec2) => void
  /** Called when the pointer is released while this interaction is active. This ends the
    * interaction. */
  release: (upEvent :MouseEvent, pos :vec2) => void
  /** Called if this action is canceled. This ends the interaction. */
  cancel: () => void
}

/** Defines configuration for [[Root]] elements. */
export interface RootConfig extends ElementConfig {
  type :"root"
  scale :Scale
  contents :ElementConfig
}

/** The top-level of the UI hierarchy. Manages the canvas into which the UI is rendered. */
export class Root extends Element {
  readonly canvas :HTMLCanvasElement = document.createElement("canvas")
  readonly ctx :CanvasRenderingContext2D
  readonly contents :Element
  private interacts :Array<MouseInteraction|undefined> = []

  constructor (readonly fact :ElementFactory, readonly config :RootConfig) {
    super(fact, undefined, config)
    const ctx = this.canvas.getContext("2d")
    if (ctx) this.ctx = ctx
    else throw new Error(`Canvas rendering context not supported?`)
    this.contents = fact.createElement(this, config.contents)
  }

  get root () :Root|undefined { return this }

  pack (width :number, height :number) :HTMLCanvasElement {
    this.setBounds(rect.set(tmpr, 0, 0, width, height))
    this.validate()
    this.render(this.ctx)
    return this.canvas
  }

  render (canvas :CanvasRenderingContext2D) {
    const sf = this.config.scale.factor
    canvas.scale(sf, sf)
    this.contents.render(canvas)
  }

  dispose () {
    super.dispose()
    this.contents.dispose()
  }

  /** Dispatches a browser mouse event to this root.
    * @param event the browser event to dispatch.
    * @param origin the origin of the root in screen coordinates. */
  dispatchMouseEvent (event :MouseEvent, origin :vec2) {
    // TODO: we're assuming the root/renderer scale is the same as the browser display unit to pixel
    // ratio (mouse events come in display units), so everything "just lines up"; if we want to
    // support other weird ratios between browser display units and backing buffers, we have to be
    // more explicit about all this...
    const pos = vec2.set(tmpv, event.offsetX-origin[0], event.offsetY-origin[1])
    const button = event.button
    const iact = this.interacts[button]
    switch (event.type) {
    case "mousedown":
      if (rect.contains(this.contents.bounds, pos)) {
        if (iact) {
          console.warn(`Got mouse down but have active interaction? [button=${button}]`)
          iact.cancel()
        }
        this.interacts[button] = this.contents.handleMouseDown(event, pos)
      }
      break
    case "mousemove":
      if (iact) iact.move(event, pos)
      break
    case "mouseup":
      if (iact) {
        iact.release(event, pos)
        this.interacts[button] = undefined
      }
      break
    case "mousecancel":
      if (iact) {
        iact.cancel()
        this.interacts[button] = undefined
      }
    }
  }

  // TODO: dispatchKeyEvent, dispatchTouchEvent? separate handleXEvent methods?

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.copy(into, this.contents.preferredSize(hintX, hintY))
  }

  protected relayout () {
    this.contents.setBounds(this._bounds)
  }

  protected revalidate () {
    super.revalidate()
    const canvas = this.canvas, toPixel = this.config.scale
    canvas.width = Math.ceil(toPixel.scaled(this.width))
    canvas.height = Math.ceil(toPixel.scaled(this.height))
    canvas.style.width = `${this.width}px`
    canvas.style.height = `${this.height}px`
    this.contents.validate()
  }
}
