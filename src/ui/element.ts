import {Disposable, Disposer, Remover, NoopRemover, PMap} from "../core/util"
import {Clock} from "../core/clock"
import {dim2, rect, vec2} from "../core/math"
import {Record} from "../core/data"
import {Emitter, Mutable, Source, Stream, Value} from "../core/react"
import {Scale} from "../core/ui"
import {Model} from "./model"
import {Spec, StyleContext} from "./style"

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
      // dirty first, in case changing the value changes the bounds expansion
      this.owner.dirty()
      this.current = v
      this.owner.invalidate()
    })
  }

  dispose () {
    this.remover()
  }
}

/** Handles creating elements from a configuration. */
export interface ElementFactory {

  /** Creates an element based on `config`. */
  create (ctx :ElementContext, parent :Element, config :ElementConfig) :Element
}

/** Gives elements access to their enclosing context. */
export type ElementContext = {
  /** Used to obtain model data for elements. */
  model :Model
  /** Used to resolve styles for elements. */
  style :StyleContext
  /** Used to create new elements. */
  elem :ElementFactory
}

/** Configuration shared by all [[Element]]s. */
export interface ElementConfig {
  type :string
  tags? :Set<string>
  visible? :Spec<Value<boolean>>
  constraints? :Record
  scopeId? :string
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

const mergedBounds = rect.create()

/** The basic building block of UIs. Elements have a bounds, are part of a UI hierarchy (have a
  * parent, except for the root element), and participate in the cycle of invalidation, validation
  * and rendering. */
export abstract class Element implements Disposable {
  protected readonly _bounds :rect = rect.create()
  protected readonly _psize :dim2 = dim2.fromValues(-1, -1)
  protected readonly _valid = Mutable.local(false)
  protected readonly _dirtyRegion = rect.create()
  protected readonly _configScope? :StyleScope
  protected readonly disposer = new Disposer()

  readonly parent :Element|undefined
  readonly visible :Value<boolean>

  constructor (ctx :ElementContext, parent :Element|undefined, config :ElementConfig) {
    this.parent = parent
    this.visible = config.visible ? ctx.model.resolve(config.visible) : trueValue
    if (config.scopeId) this._configScope = {id: config.scopeId, states: RootStates}
    this.invalidateOnChange(this.visible)
  }

  get x () :number { return this._bounds[0] }
  get y () :number { return this._bounds[1] }
  get width () :number { return this._bounds[2] }
  get height () :number { return this._bounds[3] }
  get bounds () :rect { return this._bounds }

  abstract get config () :ElementConfig
  get styleScope () :StyleScope { return this._configScope || this.requireParent.styleScope }
  get root () :Root { return this.requireParent.root }
  get valid () :Value<boolean> { return this._valid }
  get state () :Value<string> { return this.requireParent.state }

  protected get requireParent () :Element {
    const parent = this.parent
    if (!parent) throw new Error(`Element missing parent?`)
    return parent
  }

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
    if (rect.eq(this._bounds, bounds)) return
    rect.union(mergedBounds, this._bounds, bounds)
    rect.copy(this._bounds, bounds)
    this.dirty(this.expandBounds(mergedBounds))
    this.invalidate()
  }

  invalidate (dirty :boolean = true) {
    if (this._valid.current) {
      this._valid.update(false)
      this._psize[0] = -1 // force psize recompute
      this.parent && this.parent.invalidate(false)
    }
    if (dirty) this.dirty()
  }

  dirty (region :rect = this.expandBounds(this._bounds), fromChild :boolean = false) {
    if (rect.containsRect(this._dirtyRegion, region)) return
    rect.union(this._dirtyRegion, this._dirtyRegion, region)
    if (this.parent) this.parent.dirty(region, true)
  }

  validate () :boolean {
    if (this._valid.current) return false
    this.revalidate()
    this._valid.update(true)
    return true
  }

  render (canvas :CanvasRenderingContext2D, region :rect) {
    if (!rect.intersects(this._bounds, region)) return
    if (this.visible.current) this.rerender(canvas, region)
    rect.zero(this._dirtyRegion)
  }

  /** Requests that this element handle the supplied mouse down event.
    * @param event the event forwarded from the browser.
    * @param pos the position of the event relative to the root origin.
    * @return an interaction if an element started an interaction with the mouse, `undefined`
    * otherwise. */
  handleMouseDown (event :MouseEvent, pos :vec2) :MouseInteraction|undefined {
    return undefined
  }

  /** Requests that this element handle the supplied wheel event.
    * @param event the event forwarded from the browser.
    * @param pos the position of the event relative to the root origin.
    * @return whether or not the wheel was handled, and thus should not be further propagated. */
  handleWheel (event :WheelEvent, pos :vec2) :boolean {
    return false
  }

  /** Finds the first child with the specified `type`. */
  findChild (type :string) :Element|undefined {
    return (this.config.type === type) ? this : undefined
  }

  /** Finds the first child with the specified `tag`. */
  findTaggedChild (tag :string) :Element|undefined {
    return (this.config.tags && this.config.tags.has(tag)) ? this : undefined
  }

  dispose () {
    this.disposer.dispose()
  }

  toString () {
    return `${this.constructor.name}@${this._bounds}`
  }

  protected getStyle<S> (styles :PMap<S>, state :string) :S {
    const style = styles[state]
    if (style) return style
    console.warn(`Missing styles for state '${state}' in ${this}.`)
    return {} as S
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

  /** Expands the supplied bounds to include space for extra details such as shadows. */
  protected expandBounds (bounds :rect) :rect {
    return bounds
  }

  protected abstract computePreferredSize (hintX :number, hintY :number, into :dim2) :void
  protected abstract relayout () :void
  protected abstract rerender (canvas :CanvasRenderingContext2D, region :rect) :void
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

export const RootStates = ["normal"]
const RootState = Value.constant(RootStates[0])

/** Defines configuration for [[Root]] elements. */
export interface RootConfig extends ElementConfig {
  type :"root"
  scale :Scale
  contents :ElementConfig
}

/** The top-level of the UI hierarchy. Manages the canvas into which the UI is rendered. */
export class Root extends Element {
  private readonly interacts :Array<MouseInteraction|undefined> = []
  private readonly _clock = new Emitter<Clock>()
  readonly canvasElem :HTMLCanvasElement = document.createElement("canvas")
  readonly canvas :CanvasRenderingContext2D
  readonly contents :Element
  readonly focus = Mutable.local<Control|undefined>(undefined)

  constructor (readonly ctx :ElementContext, readonly config :RootConfig) {
    super(ctx, undefined, config)
    const canvas = this.canvasElem.getContext("2d")
    if (canvas) this.canvas = canvas
    else throw new Error(`Canvas rendering context not supported?`)
    this.contents = ctx.elem.create(ctx, this, config.contents)
  }

  get clock () :Stream<Clock> { return this._clock }
  get styleScope () :StyleScope { return {id: "default", states: RootStates} }
  get root () :Root { return this }
  get state () :Value<string> { return RootState }

  pack (width :number, height :number) :HTMLCanvasElement {
    this.setBounds(rect.set(tmpr, 0, 0, width, height))
    this.validate()
    this.render(this.canvas, this._bounds)
    return this.canvasElem
  }

  update (clock :Clock) :boolean {
    this._clock.emit(clock)
    const changed = this.validate() || !rect.isEmpty(this._dirtyRegion)
    changed && this.render(this.canvas, this._dirtyRegion)
    return changed
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
        const niact = this.interacts[button] = this.contents.handleMouseDown(event, pos)
        // if we click and hit no interactive control, clear the focus
        if (niact === undefined) this.focus.update(undefined)
        else event.cancelBubble = true
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
  // TODO: dispatchMouseWheelEvent, dispatchTouchEvent, handlePointerDown (called by mouse & touch)?

  /** Dispatches a browser keyboard event to this root. */
  dispatchKeyEvent (event :KeyboardEvent) {
    // TODO: focus navigation on Tab/Shift-Tab?
    const focus = this.focus.current
    focus && focus.handleKeyEvent(event)
  }

  dispatchWheelEvent (event :WheelEvent, origin :vec2) {
    const pos = vec2.set(tmpv, event.offsetX-origin[0], event.offsetY-origin[1])
    if (rect.contains(this.contents.bounds, pos) && this.contents.handleWheel(event, pos)) {
      event.cancelBubble = true
    }
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.copy(into, this.contents.preferredSize(hintX, hintY))
  }

  protected relayout () {
    this.contents.setBounds(this._bounds)
  }

  protected revalidate () {
    super.revalidate()
    const canvas = this.canvasElem, toPixel = this.config.scale
    const scaledWidth = Math.ceil(toPixel.scaled(this.width))
    const scaledHeight = Math.ceil(toPixel.scaled(this.height))
    if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
      canvas.width = scaledWidth
      canvas.height = scaledHeight
      canvas.style.width = `${this.width}px`
      canvas.style.height = `${this.height}px`
    }
    this.contents.validate()
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    const sf = this.config.scale.factor
    canvas.save()
    canvas.scale(sf, sf)
    if (debugDirty) {
      canvas.strokeStyle = DebugColors[debugColorIndex]
      debugColorIndex = (debugColorIndex + 1) % DebugColors.length
      canvas.strokeRect(region[0] - 2, region[1] - 2, region[2] + 4, region[3] + 4)
    }
    // expand the region by one pixel to allow for subpixel positioning
    canvas.clearRect(region[0] - 1, region[1] - 1, region[2] + 2, region[3] + 2)
    canvas.beginPath()
    canvas.rect(region[0] - 1, region[1] - 1, region[2] + 2, region[3] + 2)
    canvas.clip()
    this.contents.render(canvas, region)
    canvas.restore()
  }
}

const debugDirty = false
const DebugColors = ["#FF0000", "#00FF00", "#0000FF", "#00FFFF", "#FF00FF", "#FFFF00"]
let debugColorIndex = 0

export const ControlStates = [...RootStates, "disabled", "focused"]

/** Configuration shared by all [[Control]]s. */
export interface ControlConfig extends ElementConfig {
  enabled? :Spec<Value<boolean>>
  contents :ElementConfig
}

/** Controls are [[Element]]s that can be interacted with. They can be enabled or disabled and
  * generally support some sort of mouse/touch/keyboard interactions. Controls are also generally
  * composite elements, combining one or more "visualization" elements. For example, a `Button`
  * combines a `Box` with an `Icon` and/or `Label` (and a `Group` if both an icon and label are
  * used) to visualize the button, and `Button` handles interactions. */
export class Control extends Element {
  protected readonly _state = Mutable.local(ControlStates[0])
  protected readonly enabled :Value<boolean>
  protected readonly contents :Element

  constructor (ctx :ElementContext, parent :Element|undefined, readonly config :ControlConfig) {
    super(ctx, parent, config)
    if (!config.enabled) this.enabled = trueValue
    else {
      this.enabled = ctx.model.resolve(config.enabled)
      this.disposer.add(this.enabled.onValue(_ => this._state.update(this.computeState)))
    }
    this.contents = this.createContents(ctx)
  }

  get styleScope () :StyleScope { return {id: "control", states: ControlStates} }
  get state () :Value<string> { return this._state }
  get isFocused () :boolean { return this.root.focus.current === this }

  /** Requests that this control receive input focus. */
  focus () {
    // no focus if you're not enabled
    if (!this.enabled.current) return
    const root = this.root
    // if we're already focused, then nothing doing
    if (root.focus.current === this) return

    root.focus.update(this)
    this._state.update(this.computeState)
    const remover = root.focus.onValue(fc => {
      if (fc !== this) {
        this._state.update(this.computeState)
        remover()
      }
    })
  }

  /** Requests that this control handle the supplied keyboard event.
    * This will only be called on controls that have the keyboard focus. */
  handleKeyEvent (event :KeyboardEvent) {}

  findChild (type :string) :Element|undefined {
    return super.findChild(type) || this.contents.findChild(type)
  }
  findTaggedChild (tag :string) :Element|undefined {
    return super.findTaggedChild(tag) || this.contents.findTaggedChild(tag)
  }

  dispose () {
    super.dispose()
    this.contents.dispose()
  }

  protected createContents (ctx :ElementContext) :Element {
    return ctx.elem.create(ctx, this, this.config.contents)
  }

  protected get computeState () :string {
    return this.enabled.current ? (this.isFocused ? "focused" : "normal") : "disabled"
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

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    this.contents.render(canvas, region)
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
  private readonly onKey = (event :KeyboardEvent) => this.handleKeyEvent(event)
  private readonly onWheel = (event :WheelEvent) => this.handleWheelEvent(event)
  private readonly onPointerDown = (event :PointerEvent) => this.handlePointerDown(event)
  private readonly onPointerUp = (event :PointerEvent) => this.handlePointerUp(event)
  protected readonly roots :[Root, vec2][] = []

  addRoot (root :Root, origin :vec2) {
    const ii = this.roots.length
    this.roots.push([root, origin])
    this.rootAdded(root, origin, ii)
  }

  removeRoot (root :Root, dispose = true) {
    const idx = this.roots.findIndex(ro => ro[0] === root)
    if (idx >= 0) {
      const ro = this.roots.splice(idx, 1)[0]
      this.rootRemoved(root, ro[1], idx)
      if (dispose) root.dispose()
    }
  }

  bind (canvas :HTMLCanvasElement) :Remover {
    canvas.addEventListener("mousedown", this.onMouse)
    canvas.addEventListener("mousemove", this.onMouse)
    document.addEventListener("mouseup", this.onMouse)
    canvas.addEventListener("wheel", this.onWheel)
    canvas.addEventListener("pointerdown", this.onPointerDown)
    canvas.addEventListener("pointerup", this.onPointerUp)
    document.addEventListener("keydown", this.onKey)
    document.addEventListener("keyup", this.onKey)
    return () => {
      canvas.removeEventListener("mousedown", this.onMouse)
      canvas.removeEventListener("mousemove", this.onMouse)
      document.removeEventListener("mouseup", this.onMouse)
      canvas.removeEventListener("wheel", this.onWheel)
      canvas.removeEventListener("pointerdown", this.onPointerDown)
      canvas.removeEventListener("pointerup", this.onPointerUp)
      document.removeEventListener("keydown", this.onKey)
      document.removeEventListener("keyup", this.onKey)
    }
  }

  handleMouseEvent (event :MouseEvent) {
    for (const ro of this.roots) ro[0].dispatchMouseEvent(event, ro[1])
  }
  handleKeyEvent (event :KeyboardEvent) {
    // TODO: maintain a notion of which root currently has focus (if any)
    for (const ro of this.roots) ro[0].dispatchKeyEvent(event)
  }
  handleWheelEvent (event :WheelEvent) {
    for (const ro of this.roots) ro[0].dispatchWheelEvent(event, ro[1])
  }
  handlePointerDown (event :PointerEvent) {
    const canvas = event.target as HTMLElement
    canvas.setPointerCapture(event.pointerId)
  }
  handlePointerUp (event :PointerEvent) {
    const canvas = event.target as HTMLElement
    canvas.releasePointerCapture(event.pointerId)
  }

  update (clock :Clock) {
    let ii = 0
    for (const ro of this.roots) {
      const root = ro[0]
      if (root.update(clock)) this.rootUpdated(root, ro[1], ii)
      ii += 1
    }
  }

  dispose () {
    for (const ro of this.roots) ro[0].dispose()
  }

  protected rootAdded (root :Root, origin :vec2, index :number) {}
  protected rootUpdated (root :Root, origin :vec2, index :number) {}
  protected rootRemoved (root :Root, origin :vec2, index :number) {}
}

/** A host that simply appends canvases to an HTML element (which should be positioned). */
export class HTMLHost extends Host {
  private readonly _lastOrigins :vec2[] = []

  constructor (private readonly _container :HTMLElement) {
    super()
  }

  update (clock :Clock) {
    let ii = 0
    for (const [root, origin] of this.roots) {
      if (root.update(clock)) this.rootUpdated(root, origin, ii)
      const lastOrigin = this._lastOrigins[ii]
      if (!vec2.exactEquals(lastOrigin, origin)) {
        this._updatePosition(root, origin)
        vec2.copy(lastOrigin, origin)
      }
      ii += 1
    }
  }

  protected rootAdded (root :Root, origin :vec2, index :number) {
    this._container.appendChild(root.canvasElem)
    const style = root.canvasElem.style
    style.position = "absolute"
    style.pointerEvents = "none"
    this._updatePosition(root, origin)
    this._lastOrigins[index] = vec2.clone(origin)
  }

  protected _updatePosition (root :Root, origin :vec2) {
    const style = root.canvasElem.style
    style.left = `${origin[0]}px`
    style.top = `${origin[1]}px`
  }

  protected rootRemoved (root :Root, origin :vec2, index :number) {
    this._container.removeChild(root.canvasElem)
    this._lastOrigins.splice(index, 1)
  }
}
