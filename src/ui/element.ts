import {Disposable, Disposer, Remover, NoopRemover} from "../core/util"
import {Clock} from "../core/clock"
import {dim2, rect, vec2} from "../core/math"
import {Record} from "../core/data"
import {Mutable, Source, Value} from "../core/react"
import {Scale} from "../core/ui"
import {StyleContext} from "./style"

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

/** Gives elements access to their enclosing context. */
export interface ElementContext extends StyleContext {

  /** Creates an element based on `config`. */
  createElement (parent :Element, config :ElementConfig) :Element

  /** Resolves the UI model element `elem`. The model element may be an immediate reactive value of
    * the desired type or may be a path into the UI data model. */
  resolveModel<T, V extends Source<T>> (elem :string|V) :V
}

/** Defines the style configurations for an [[Element]]. */
export interface ElementStyle {
  // nothing shared by all elements
}

/** Configuration shared by all [[Element]]s. */
export interface ElementConfig {
  type :string
  visible? :string|Value<boolean>
  constraints? :Record
  // this allows ElementConfig to contain "extra" stuff that TypeScript will ignore; this is
  // necessary to allow a subtype of ElementConfig to be supplied where a container element wants
  // some sort of ElementConfig; we can only plumb sharp types so deep
  [extra :string] :any
}

/** Used to define "scoped" styles for controls. A button for example defines the `button` scope,
  * and elements that are rendered inside a button are styled according to the `button` scope. */
export type StyleScope = {
  id :string
  states :string[]
}

const DefaultState = "normal"
const DefaultStyleScope = {id: "default", states: [DefaultState]}
const rootState = Value.constant(DefaultState)

/** The basic building block of UIs. Elements have a bounds, are part of a UI hierarchy (have a
  * parent, except for the root element), and participate in the cycle of invalidation, validation
  * and rendering. */
export abstract class Element implements Disposable {
  protected readonly _bounds :rect = rect.create()
  protected readonly _psize :dim2 = dim2.fromValues(-1, -1)
  protected readonly _valid = Mutable.local(false)
  protected readonly disposer = new Disposer()

  readonly parent :Element|undefined
  readonly visible :Value<boolean>

  constructor (ctx :ElementContext, parent :Element|undefined, config :ElementConfig) {
    this.parent = parent
    this.visible = config.visible ? ctx.resolveModel(config.visible) : trueValue
    this.invalidateOnChange(this.visible)
  }

  get x () :number { return this._bounds[0] }
  get y () :number { return this._bounds[1] }
  get width () :number { return this._bounds[2] }
  get height () :number { return this._bounds[3] }
  get bounds () :rect { return this._bounds }

  abstract get config () :ElementConfig
  get styleScope () :StyleScope { return this.parent ? this.parent.styleScope : DefaultStyleScope }
  get root () :Root|undefined { return this.parent ? this.parent.root : undefined }
  get valid () :Value<boolean> { return this._valid }
  // all elements except Root have a parent, so rootState is only used for Roots
  get state () :Value<string> { return this.parent ? this.parent.state : rootState }

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
    this.disposer.dispose()
  }

  toString () {
    return `${this.constructor.name}@${this._bounds}`
  }

  protected invalidateOnChange (value :Source<any>) {
    this.disposer.add(value.onEmit(_ => this.invalidate()))
  }

  protected observe<T> (initial :T) :Observer<T> {
    return this.disposer.add(new Observer(this, initial))
  }

  protected revalidate () {
    if (this.visible.current) this.relayout()
  }

  protected abstract computePreferredSize (hintX :number, hintY :number, into :dim2) :void
  protected abstract relayout () :void
}

const ControlStyleScope = {id: "control", states: [DefaultState, "disabled"]}

/** Configuration shared by all [[Control]]s. */
export interface ControlConfig extends ElementConfig {
  enabled? :string|Value<boolean>
  contents :ElementConfig
}

/** Controls are [[Element]]s that can be interacted with. They can be enabled or disabled and
  * generally support some sort of mouse/touch/keyboard interactions. Controls are also generally
  * composite elements, combining one or more "visualization" elements. For example, a `Button`
  * combines a `Box` with an `Icon` and/or `Label` (and a `Group` if both an icon and label are
  * used) to visualize the button, and `Button` handles interactions. */
export class Control extends Element {
  protected readonly _state = Mutable.local("normal")
  protected readonly enabled :Value<boolean>
  protected readonly contents :Element

  constructor (ctx :ElementContext, parent :Element|undefined, readonly config :ControlConfig) {
    super(ctx, parent, config)
    if (!config.enabled) this.enabled = trueValue
    else {
      this.enabled = ctx.resolveModel(config.enabled)
      this.disposer.add(this.enabled.onValue(_ => this._state.update(this.computeState)))
    }
    this.contents = ctx.createElement(this, config.contents)
  }

  get styleScope () :StyleScope { return ControlStyleScope }
  get state () :Value<string> { return this._state }

  render (canvas :CanvasRenderingContext2D) {
    this.contents.render(canvas)
  }

  dispose () {
    super.dispose()
    this.contents.dispose()
  }

  protected get computeState () :string {
    return this.enabled.current ? "normal" : "disabled"
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.copy(into, this.contents.preferredSize(hintX, hintY))
  }

  protected relayout () {
    this.contents.setBounds(this._bounds)
  }

  protected revalidate () {
    super.revalidate()
    this.contents.validate()
  }
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
  readonly canvasElem :HTMLCanvasElement = document.createElement("canvas")
  readonly canvas :CanvasRenderingContext2D
  readonly contents :Element
  private interacts :Array<MouseInteraction|undefined> = []

  constructor (readonly ctx :ElementContext, readonly config :RootConfig) {
    super(ctx, undefined, config)
    const canvas = this.canvasElem.getContext("2d")
    if (canvas) this.canvas = canvas
    else throw new Error(`Canvas rendering context not supported?`)
    this.contents = ctx.createElement(this, config.contents)
  }

  get root () :Root|undefined { return this }

  pack (width :number, height :number) :HTMLCanvasElement {
    this.setBounds(rect.set(tmpr, 0, 0, width, height))
    this.validate()
    this.render(this.canvas)
    return this.canvasElem
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
    const canvas = this.canvasElem, toPixel = this.config.scale
    canvas.width = Math.ceil(toPixel.scaled(this.width))
    canvas.height = Math.ceil(toPixel.scaled(this.height))
    canvas.style.width = `${this.width}px`
    canvas.style.height = `${this.height}px`
    this.contents.validate()
  }
}

/** Manages a collection of [[Root]]s: handles dispatching input and frame events, revalidating and
  * rerendering. Client responsibilities:
  * - [[bind]] to the canvas element in which the roots are rendered
  * - call [[update]] on every animation frame
  * - add manually created roots via [[addRoot]]
  * - keep the root origins up to date with the locations at which the roots are rendered.
  *
  * Clients will generally not use this class directly but rather use the `Host2` or `Host3`
  * subclasses which integrate more tightly with the `scene2` and `scene3` libraries. */
export class Host implements Disposable {
  private readonly onMouse = (event :MouseEvent) => this.handleMouseEvent(event)
  protected readonly roots :[Root, vec2][] = []

  addRoot (root :Root, origin :vec2) {
    const ii = this.roots.length
    this.roots.push([root, origin])
    this.rootAdded(root, origin, ii)
  }

  bind (canvas :HTMLCanvasElement) :Remover {
    canvas.addEventListener("mousedown", this.onMouse)
    canvas.addEventListener("mousemove", this.onMouse)
    canvas.addEventListener("mouseup", this.onMouse)
    return () => {
      canvas.removeEventListener("mousedown", this.onMouse)
      canvas.removeEventListener("mousemove", this.onMouse)
      canvas.removeEventListener("mouseup", this.onMouse)
    }
  }

  handleMouseEvent (event :MouseEvent) {
    for (const ro of this.roots) ro[0].dispatchMouseEvent(event, ro[1])
  }

  update (clock :Clock) {
    let ii = 0
    for (const ro of this.roots) {
      const root = ro[0], origin = ro[1]
      if (root.validate()) {
        root.render(root.canvas)
        this.rootUpdated(root, origin, ii)
      }
      ii += 1
    }
  }

  dispose () {
    for (const ro of this.roots) ro[0].dispose()
  }

  protected rootAdded (root :Root, origin :vec2, index :number) {}
  protected rootUpdated (root :Root, origin :vec2, index :number) {}
}
