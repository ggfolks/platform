import {Disposable, Disposer, Remover, NoopRemover, PMap, log} from "../core/util"
import {Clock} from "../core/clock"
import {dim2, rect, vec2} from "../core/math"
import {Record} from "../core/data"
import {Emitter, Mutable, Source, Stream, Value, trueValue, falseValue} from "../core/react"
import {MutableList, RList} from "../core/rcollect"
import {Scale} from "../core/ui"
import {keyEvents, mouseEvents, pointerEvents, touchEvents, wheelEvents} from "../input/react"
import {Action, Command, Model} from "./model"
import {Keymap} from "./keymap"
import {Spec, StyleContext} from "./style"

const tmpr = rect.create(), tmpv = vec2.create(), tmpd = dim2.create()
export const blankValue = Value.constant("")
const defScale = new Scale(window.devicePixelRatio)
const defHintSize = Value.constant(dim2.fromValues(64000, 32000))
const defMinSize = Value.constant(dim2.fromValues(0, 0))

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
    this.remover = NoopRemover
    // dirty first, in case changing the value changes the bounds expansion
    this.owner.dirty()
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
export class ElementContext {

  constructor (
    /** Used to obtain model data for elements. */
    readonly model :Model,
    /** Used to resolve styles for elements. */
    readonly style :StyleContext,
    /** Used to create new elements. */
    readonly elem :ElementFactory) {}

  /** Creates a new element context with the supplied `model`. */
  remodel (model :Model) :ElementContext { return new ElementContext(model, this.style, this.elem) }

  /** Creates an element context that will inject the supplied element configuration overrides. This
    * enables composite elements to inject specific values into their contained children without
    * having to take control over the configuration entirely. In general we wish to allow the end
    * user to decide how a particular composite element is arranged (maybe you want an `icon` next
    * to the `label` inside your `text` element), but we still need to reach in and apply custom
    * configuration to the `label` element inside the `text` element. */
  inject (rewrites :{[key :string] :Object}) :ElementContext {
    return new ElementContext(this.model, this.style, {
      create: (ctx, parent, config) => {
        const rewrite = rewrites[config.type]
        const rconfig = rewrite ? Object.assign(Object.assign({}, config), rewrite) : config
        return this.elem.create(ctx, parent, rconfig)
      }
    })
  }
}

/** Configuration shared by all [[Element]]s. */
export interface ElementConfig {
  type :string
  tags? :Set<string>
  visible? :Spec<Value<boolean>>
  constraints? :Record
  scopeId? :string
  overrideParentState? :string
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
    // base visibility on model value.  if spec is omitted, always assume true.  if spec is given
    // as a path with missing model elements, always return false
    this.visible = ctx.model.resolve(config.visible, config.visible ? falseValue : trueValue)
    if (config.scopeId) this._configScope = {id: config.scopeId, states: RootStates}
    this.invalidateOnChange(this.visible)
    this.disposer.add(() => this.clearCursor(this))
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
  get state () :Value<string> {
    return this.config.overrideParentState
      ? Value.constant(this.config.overrideParentState)
      : this.requireParent.state
  }

  /** Returns the path to this element in the root UI config. This is the list of the types of all
    * elements from the root down to (and including) this element. This is used in debug messages to
    * help the developer locate the element in the config when an error occurred creating it. */
  get configPath () :string[] {
    return this.parent ? this.parent.configPath.concat(this.config.type) : [this.config.type]
  }

  setCursor (owner :Element, cursor :string) {
    this.requireParent.setCursor(owner, cursor)
  }
  clearCursor (owner :Element) {
    this.requireParent.clearCursor(owner)
  }

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
      if (dirty) this.dirty()
    }
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
    if (this.intersectsRect(region)) this.rerender(canvas, region)
    rect.zero(this._dirtyRegion)
  }

  /** Expands the supplied bounds to include space for extra details such as shadows. */
  expandBounds (bounds :rect) :rect {
    return bounds
  }

  /** Applies the provided operation to all elements containing the specified position.
   * @param canvas the canvas context.
   * @param pos the position relative to the root origin.
   * @param op the operation to apply.
   * @return whether the operation was applied to this element (and potentially its children).
   */
  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2,
                     op :(element :Element) => void) :boolean {
    if (!this.containsPos(pos)) return false
    op(this)
    return true
  }

  /**
   * Applies the provided operation to all elements intersecting the specified region.
   * @param region the region relative to the root origin.
   * @param op the operation to apply.
   * @return whether the operation was applied to this element (and potentially its children).
   */
  applyToIntersecting (region :rect, op :(element :Element) => void) :boolean {
    if (!this.intersectsRect(region)) return false
    op(this)
    return true
  }

  /** Requests that this element handle the supplied mouse enter event.
   * @param event the event forwarded from the browser.
   * @param pos the position of the event relative to the root origin.
   */
  handleMouseEnter (event :MouseEvent, pos :vec2) {}

  /** Requests that this element handle the supplied mouse leave event.
   * @param event the event forwarded from the browser.
   * @param pos the position of the event relative to the root origin.
   */
  handleMouseLeave (event :MouseEvent, pos :vec2) {}

  /** Requests that this element handle the supplied pointer down event if it contains the position.
    * @param event the event forwarded from the browser.
    * @param pos the position of the event relative to the root origin.
    * @return an interaction if an element started an interaction with the pointer, `undefined`
    * otherwise. */
  maybeHandlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    return rect.contains(this.bounds, pos) ? this.handlePointerDown(event, pos) : undefined
  }

  /** Requests that this element handle the supplied pointer down event.
    * @param event the event forwarded from the browser.
    * @param pos the position of the event relative to the root origin.
    * @return an interaction if an element started an interaction with the pointer, `undefined`
    * otherwise. */
  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    return undefined
  }

  /** Requests that this element handle the supplied wheel event if it contains the position.
    * @param event the event forwarded from the browser.
    * @param pos the position of the event relative to the root origin.
    * @return whether or not the wheel was handled, and thus should not be further propagated. */
  maybeHandleWheel (event :WheelEvent, pos :vec2) :boolean {
    return rect.contains(this.bounds, pos) && this.handleWheel(event, pos)
  }

  /** Requests that this element handle the supplied wheel event.
    * @param event the event forwarded from the browser.
    * @param pos the position of the event relative to the root origin.
    * @return whether or not the wheel was handled, and thus should not be further propagated. */
  handleWheel (event :WheelEvent, pos :vec2) :boolean {
    return false
  }

  /** Requests that this element handle the supplied double click event if it contains the position.
    * @param event the event forwarded from the browser.
    * @param pos the position of the event relative to the root origin.
    * @return whether or not the event was handled, and thus should not be further propagated. */
  maybeHandleDoubleClick (event :MouseEvent, pos :vec2) :boolean {
    return rect.contains(this.bounds, pos) && this.handleDoubleClick(event, pos)
  }

  /** Requests that this element handle the supplied double click event.
    * @param event the event forwarded from the browser.
    * @param pos the position of the event relative to the root origin.
    * @return whether or not the event was handled, and thus should not be further propagated. */
  handleDoubleClick (event :MouseEvent, pos :vec2) :boolean {
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
    log.warn(`Missing styles for state '${state}'`, "elem", this)
    return {} as S
  }

  /** Returns true if this element is visible and its bounds contain `pos`. */
  protected containsPos (pos :vec2) {
    return this.visible.current && rect.contains(this.expandBounds(this.bounds), pos)
  }
  /** Returns true if this element is visible and its bounds intersect `region`. */
  protected intersectsRect (region :rect) {
    return this.visible.current && rect.intersects(this.expandBounds(this.bounds), region)
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
  protected abstract rerender (canvas :CanvasRenderingContext2D, region :rect) :void
}

/** An element that acts as a placeholder for elements that failed to be created. */
export class ErrorViz extends Element {

  constructor (ctx :ElementContext, parent :Element, readonly config :ElementConfig) {
    super(ctx, parent, config)
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.set(into, 20, 10)
  }

  protected relayout () {}
  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    canvas.fillStyle = "red"
    canvas.fillRect(this.x, this.y, this.width, this.height)
  }
}

/** Encapsulates a mouse or touch interaction with an element. When the button is pressed over an
  * element, it can start an interaction which will then handle subsequent events until the button
  * is released or the interaction is canceled. */
export type PointerInteraction = {
  /** Called when the pointer is moved while this interaction is active. */
  move: (moveEvent :MouseEvent|TouchEvent, pos :vec2) => void
  /** Called when the pointer is released while this interaction is active. This ends the
    * interaction. */
  release: (upEvent :MouseEvent|TouchEvent, pos :vec2) => void
  /** Called if this action is canceled. This ends the interaction. */
  cancel: () => void

  // allow extra stuff in interaction to allow communication with parent elements
  [extra :string] :any
}

export const RootStates = ["normal"]
const RootState = Value.constant(RootStates[0])

/** Defines configuration for [[Root]] elements. */
export interface RootConfig extends ElementConfig {
  type :"root"
  scale? :Scale
  autoSize? :boolean
  hintSize? :Spec<Value<dim2>>
  minSize? :Spec<Value<dim2>>
  zIndex? :number
  contents :ElementConfig
}

/** The horizontal anchor point on an anchored root. */
export type HAnchor = "left" | "center" | "right"
/** The vertical anchor point on an anchored root. */
export type VAnchor = "top" | "center" | "bottom"

function pos (align :HAnchor|VAnchor, min :number, max :number) {
  if (align === "left" || align === "top") return min
  else if (align == "right" || align === "bottom") return max
  else return min+(max-min)/2
}

let currentEditNumber = 0

/** Returns the current value of the edit number, which is simply a number that we increment after
  * certain input events (mouse up, key up) to determine which edits should be merged. */
export function getCurrentEditNumber () {
  return currentEditNumber
}

type RootChange = "resized" | "moved" | "rendered" | "removed" | "disposed"

/** The top-level of the UI hierarchy. Manages the canvas into which the UI is rendered. */
export class Root extends Element {
  private readonly interacts :Array<PointerInteraction|undefined> = []
  private readonly _clock = new Emitter<Clock>()
  private readonly _unclaimedKeyEvent = new Emitter<KeyboardEvent>()
  private readonly _scale :Scale
  private readonly _hintSize :Value<dim2>
  private readonly _minSize :Value<dim2>
  private readonly _origin = vec2.create()
  private readonly _cursorOwners = new Map<Element, string>()
  private _elementsOver = new Set<Element>()
  private _lastElementsOver = new Set<Element>()

  readonly canvasElem :HTMLCanvasElement = document.createElement("canvas")
  readonly canvas :CanvasRenderingContext2D
  readonly contents :Element
  readonly focus = Mutable.local<Control|undefined>(undefined)
  readonly cursor = Mutable.local("auto")

  /** Emits events pertaining to this root's size, origin, lifecycle, etc. */
  readonly events = new Emitter<RootChange>()

  /** Handles key events for menus and other elements that operate outside the focus system. */
  readonly keymap = new Keymap()

  constructor (readonly ctx :ElementContext, readonly config :RootConfig) {
    super(ctx, undefined, config)
    const canvas = this.canvasElem.getContext("2d")
    if (canvas) this.canvas = canvas
    else throw new Error(`Canvas rendering context not supported?`)
    this._scale = config.scale ? config.scale : defScale
    this._hintSize = config.hintSize ? ctx.model.resolve(config.hintSize) : defHintSize
    this.invalidateOnChange(this._hintSize)
    this._minSize = config.minSize ? ctx.model.resolve(config.minSize) : defMinSize
    this.invalidateOnChange(this._minSize)
    this.contents = ctx.elem.create(ctx, this, config.contents)
  }

  get clock () :Stream<Clock> { return this._clock }
  get styleScope () :StyleScope { return {id: "default", states: RootStates} }
  get root () :Root { return this }
  get state () :Value<string> { return RootState }
  get origin () :vec2 { return this._origin }

  /** Returns the desired index of this root relative to other roots. Events will be dispatched to
    * higher zIndexed roots first, under the assumption that they are rendered on top of lower
    * zIndexed roots in cases where they overlap. */
  get zIndex () :number { return this.config.zIndex || 0}

  /** A stream that emits key events not consumed by focus. */
  get unclaimedKeyEvent () :Stream<KeyboardEvent> { return this._unclaimedKeyEvent }

  setCursor (owner :Element, cursor :string) {
    this.cursor.update(cursor)
    this._cursorOwners.set(owner, cursor)
  }
  clearCursor (owner :Element) {
    const cursor = this._cursorOwners.get(owner)
    if (cursor === undefined) return
    this._cursorOwners.delete(owner)
    if (this.cursor.current !== cursor) return
    if (this._cursorOwners.size > 0) this.cursor.update(this._cursorOwners.values().next().value)
    else this.cursor.update("auto")
  }

  /** Updates the position at which the root is rendered on the screen.
    * This value is used to interpret mouse and touch events. */
  setOrigin (pos :vec2) {
    if (!vec2.equals(this._origin, pos)) {
      vec2.copy(this._origin, pos)
      this.events.emit("moved")
    }
  }

  /** Binds the origin of this root by matching a point of this root (specified by `rootH` &
    * `rootV`) to a point on the screen (specified by `screenH` & `screenV`), given a reactive view
    * of the `screen` bounds.
    * @return a remover that can be used to cancel the binding. The binding will also be cleared
    * when the root is disposed. */
  bindOrigin (screen :Value<rect>, screenH :HAnchor, screenV :VAnchor,
              rootH :HAnchor, rootV :VAnchor) :Remover {
    const rsize = this.events.filter(c => c === "resized").
      fold(this.size(dim2.create()), (sz, c) => this.size(dim2.create()), dim2.eq)
    const remover = Value.join2(screen, rsize).onValue(([ss, rs]) => {
      const sh = pos(screenH, 0, ss[2]), sv = pos(screenV, 0, ss[3])
      const rh = pos(rootH, 0, rs[0]), rv = pos(rootV, 0, rs[1])
      this.setOrigin(vec2.set(tmpv, Math.round(sh-rh)+ss[0], Math.round(sv-rv)+ss[1]))
    })
    this.disposer.add(remover)
    return remover
  }

  /** Sizes this root to `size` and immediately revalidates and rerenders it. */
  setSize (size :dim2, rerender = true) {
    if (size[0] !== this.width || size[1] !== this.height) {
      this.setBounds(rect.set(tmpr, 0, 0, size[0], size[1]))
      if (rerender) this._validateAndRender()
    }
  }

  /** Sizes this root to its preferred width and height. If either of `maxWidth` or `maxHeight` are
    * supplied, they will override the `hintSize` configuration of the root. The root's `minSize`
    * configuration will also be applied. */
  sizeToFit (maxWidth? :number, maxHeight? :number, rerender = true) {
    const hint = this._hintSize.current, min = this._minSize.current
    const hintX = maxWidth || hint[0], hintY = maxHeight || hint[1]
    this.computePreferredSize(hintX, hintY, tmpd)
    // clamp the root bounds to be no smaller than min, and no bigger than hint
    const width = Math.min(hintX, min[0] > 0 ? Math.max(tmpd[0], min[0]) : tmpd[0])
    const height = Math.min(hintY, min[1] > 0 ? Math.max(tmpd[1], min[1]) : tmpd[1])
    this.setSize(dim2.set(tmpd, width, height), rerender)
  }

  /** Sizes this root to `width` pixels and its preferred height (which is computed using the
    * supplied `maxHeight` hint). */
  sizeToWidth (width :number, maxHeight :number = 32000) {
    this.computePreferredSize(width, maxHeight, tmpd)
    tmpd[0] = width
    this.setSize(tmpd)
  }

  /** Sizes this root to `height` pixels and its preferred width (which is computed using the
    * supplied `maxWidth` hint). */
  sizeToHeight (height :number, maxWidth :number = 64000) {
    this.computePreferredSize(maxWidth, height, tmpd)
    tmpd[1] = height
    this.setSize(tmpd)
  }

  update (clock :Clock) :boolean {
    this._clock.emit(clock)
    if (!this.valid.current && this.config.autoSize) this.sizeToFit(undefined, undefined, false)
    return this._validateAndRender()
  }

  findChild (type :string) :Element|undefined {
    return super.findChild(type) || this.contents.findChild(type)
  }
  findTaggedChild (tag :string) :Element|undefined {
    return super.findTaggedChild(tag) || this.contents.findTaggedChild(tag)
  }

  dispose () {
    super.dispose()
    this.focus.update(undefined)
    this.contents.dispose()
    this.events.emit("disposed")
  }

  /** Dispatches a browser mouse event to this root.
    * @param host the host that is liaising between this root and the browser events.
    * @param event the browser event to dispatch. */
  dispatchMouseEvent (host :Host, event :MouseEvent) {
    // TODO: we're assuming the root/renderer scale is the same as the browser display unit to pixel
    // ratio (mouse events come in display units), so everything "just lines up"; if we want to
    // support other weird ratios between browser display units and backing buffers, we have to be
    // more explicit about all this...
    const pos = host.mouseToRoot(this, event, tmpv)
    const button = event.button
    const iact = this.interacts[button]
    // if this mouse event is in our bounds, stop it from propagating to (lower) roots; except in
    // the case of mouseup because a mouse interaction might start on one root and then drag over to
    // our root, but we want to be sure the original root also hears about the mouseup
    if (event.type !== "mouseup" && rect.contains(this.bounds, pos)) event.cancelBubble = true
    switch (event.type) {
    case "mousedown":
      if (iact) {
        log.warn("Got mouse down but have active interaction?", "button", button)
        iact.cancel()
      }
      const niact = this.interacts[button] = this.contents.maybeHandlePointerDown(event, pos)
      // if we click and hit no interactive control, clear the focus
      if (niact === undefined) this.focus.update(undefined)
      break
    case "mousemove":
      if (iact) iact.move(event, pos)
      else this._updateElementsOver(event, pos)
      break
    case "mouseup":
      if (iact) {
        iact.release(event, pos)
        this.interacts[button] = undefined
        this._updateElementsOver(event, pos)
      }
      currentEditNumber++
      break
    case "dblclick":
      this.contents.maybeHandleDoubleClick(event, pos)
      break
    }
  }

  /** Dispatches a browser touch event to this root.
    * @param host the host that is liaising between this root and the browser events.
    * @param event the browser event to dispatch. */
  dispatchTouchEvent (host :Host, event :TouchEvent) {
    const iact = this.interacts[0]
    switch (event.type) {
    case "touchstart":
      if (event.touches.length === 1) {
        const touch = event.changedTouches[0]
        const pos = host.touchToRoot(this, touch, tmpv)
        if (rect.contains(this.bounds, pos)) {
          // note that we are assuming responsibility for the event
          event.cancelBubble = true
          // prevent any default touch behavior
          event.preventDefault()
        }
        if (iact) {
          log.warn("Got touch start but have active interaction?")
          iact.cancel()
        }
        const niact = this.interacts[0] = this.contents.maybeHandlePointerDown(event, pos)
        // if we click and hit no interactive control, clear the focus
        if (niact === undefined) this.focus.update(undefined)

      } else if (iact) {
        iact.cancel()
        this.interacts[0] = undefined
      }
      break
    case "touchmove":
      if (iact) {
        const touch = event.changedTouches[0]
        const pos = vec2.set(tmpv, touch.clientX-this.origin[0], touch.clientY-this.origin[1])
        iact.move(event, pos)
      }
      break
    case "touchcancel":
      if (iact) {
        iact.cancel()
        this.interacts[0] = undefined
      }
      break
    case "touchend":
      if (iact) {
        const touch = event.changedTouches[0]
        const pos = vec2.set(tmpv, touch.clientX-this.origin[0], touch.clientY-this.origin[1])
        iact.release(event, pos)
        this.interacts[0] = undefined
      }
      currentEditNumber++
      break
    }
  }

  private _validateAndRender () {
    const changed = this.validate() || !rect.isEmpty(this._dirtyRegion)
    if (changed) {
      this.render(this.canvas, this._dirtyRegion)
      this.events.emit("rendered")
    }
    return changed
  }

  private _updateElementsOver (event :MouseEvent, pos :vec2) {
    const sf = this._scale.factor
    this.canvas.save()
    this.canvas.scale(sf, sf)
    const {_elementsOver, _lastElementsOver} = this
    this.contents.applyToContaining(this.canvas, pos, elem => _elementsOver.add(elem))
    this.canvas.restore()
    for (const element of _lastElementsOver) {
      if (!_elementsOver.has(element)) element.handleMouseLeave(event, pos)
    }
    for (const element of _elementsOver) {
      if (!_lastElementsOver.has(element)) element.handleMouseEnter(event, pos)
    }
    _lastElementsOver.clear()
    this._elementsOver = _lastElementsOver
    this._lastElementsOver = _elementsOver
  }

  /** Dispatches a browser keyboard event to this root. */
  dispatchKeyEvent (event :KeyboardEvent) {
    // TODO: focus navigation on Tab/Shift-Tab?
    const focus = this.focus.current
    if ((focus && focus.handleKeyEvent(event)) ||
        (event.type === "keydown" && !!this.keymap.invokeAction(event))) {
      // let the browser know we handled this event
      event.preventDefault()
      event.cancelBubble = true
      return
    }
    this._unclaimedKeyEvent.emit(event)
    if (event.type === "keyup") currentEditNumber++
  }

  dispatchWheelEvent (host :Host, event :WheelEvent) {
    const pos = host.mouseToRoot(this, event, tmpv)
    if (rect.contains(this.bounds, pos)) event.cancelBubble = true
    this.contents.maybeHandleWheel(event, pos)
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.copy(into, this.contents.preferredSize(hintX, hintY))
  }

  protected relayout () {
    this.contents.setBounds(this._bounds)
  }

  protected revalidate () {
    super.revalidate()
    const canvas = this.canvasElem, toPixel = this._scale
    const scaledWidth = Math.ceil(toPixel.scaled(this.width))
    const scaledHeight = Math.ceil(toPixel.scaled(this.height))
    if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
      canvas.width = scaledWidth
      canvas.height = scaledHeight
      canvas.style.width = `${this.width}px`
      canvas.style.height = `${this.height}px`
      this.events.emit("resized")
    }
    this.contents.validate()
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    const sf = this._scale.factor
    canvas.save()
    canvas.scale(sf, sf)
    if (debugDirty) {
      canvas.strokeStyle = DebugColors[debugColorIndex]
      debugColorIndex = (debugColorIndex + 1) % DebugColors.length
      canvas.strokeRect(region[0] - 1, region[1] - 1, region[2] + 2, region[3] + 2)
    }
    canvas.clearRect(region[0], region[1], region[2], region[3])
    canvas.beginPath()
    canvas.rect(region[0], region[1], region[2], region[3])
    canvas.clip()
    this.contents.render(canvas, region)
    canvas.restore()
  }
}

const debugDirty = false
const DebugColors = ["#FF0000", "#00FF00", "#0000FF", "#00FFFF", "#FF00FF", "#FFFF00"]
let debugColorIndex = 0

export const ControlStates = [...RootStates, "disabled", "focused", "hovered", "hoverFocused"]

/** Configuration shared by all [[Control]]s. */
export interface ControlConfig extends ElementConfig {
  enabled? :Spec<Value<boolean>>
  contents :ElementConfig
}

function bothEitherOrTrue (a :Value<boolean>|undefined, b :Value<boolean>|undefined) {
  if (a && b) return Value.join2(a, b).map(ab => ab[0] && ab[1])
  else if (a) return a
  else if (b) return b
  else return trueValue
}

/** Controls are [[Element]]s that can be interacted with. They can be enabled or disabled and
  * generally support some sort of mouse/touch/keyboard interactions. Controls are also generally
  * composite elements, combining one or more "visualization" elements. For example, a `Button`
  * combines a `Box` with an `Icon` and/or `Label` (and a `Group` if both an icon and label are
  * used) to visualize the button, and `Button` handles interactions. */
export class Control extends Element {
  protected readonly _state = Mutable.local(ControlStates[0])
  protected readonly _hovered = Mutable.local(false)
  protected readonly enabled :Value<boolean>
  protected readonly contents :Element

  constructor (ctx :ElementContext, parent :Element|undefined, readonly config :ControlConfig) {
    super(ctx, parent, config)
    const updateState = () => this._state.update(this.computeState)
    // our enabled state either comes from our command, is directly specified, or is both (anded)
    const command = ctx.model.resolveOpt(this.actionSpec(config))
    const enabled = this.enabled = bothEitherOrTrue(
      ctx.model.resolveOpt(config.enabled),
      (command instanceof Command) ? command.enabled : undefined)
    if (enabled !== trueValue) this.disposer.add(enabled.onValue(updateState))
    this.disposer.add(this._hovered.onValue(updateState))
    this.contents = ctx.elem.create(ctx, this, this.config.contents)
  }

  get styleScope () :StyleScope { return {id: "control", states: ControlStates} }
  get state () :Value<string> { return this._state }
  get isFocused () :boolean { return this.root.focus.current === this }
  get isHovered () :boolean { return this._hovered.current }

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
        this.lostFocus()
      }
    })
  }

  /** Requests that this control lose input focus. */
  blur () {
    const root = this.root
    if (root.focus.current === this) root.focus.update(undefined)
  }

  handleMouseEnter (event :MouseEvent, pos :vec2) { this._hovered.update(true) }
  handleMouseLeave (event :MouseEvent, pos :vec2) { this._hovered.update(false) }

  /** Requests that this control handle the supplied keyboard event.
    * This will only be called on controls that have the keyboard focus. */
  handleKeyEvent (event :KeyboardEvent) :boolean { return false }

  findChild (type :string) :Element|undefined {
    return super.findChild(type) || this.contents.findChild(type)
  }
  findTaggedChild (tag :string) :Element|undefined {
    return super.findTaggedChild(tag) || this.contents.findTaggedChild(tag)
  }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :(element :Element) => void) {
    const applied = super.applyToContaining(canvas, pos, op)
    if (applied) this.contents.applyToContaining(canvas, pos, op)
    return applied
  }
  applyToIntersecting (region :rect, op :(element :Element) => void) {
    const applied = super.applyToIntersecting(region, op)
    if (applied) this.contents.applyToIntersecting(region, op)
    return applied
  }

  dispose () {
    super.dispose()
    this.contents.dispose()
  }

  protected get computeState () :string {
    return this.enabled.current
      ? (this.isHovered
          ? this.isFocused ? "hoverFocused" : "hovered"
          : this.isFocused ? "focused" : "normal"
        )
      : "disabled"
  }

  /** If this control triggers an action, it must override this method to return the spec for that
    * action from its config. The control will use this to bind its enabled state to the action's
    * enabled state if it is bound to a command. */
  protected actionSpec (config :ControlConfig) :Spec<Action>|undefined { return undefined }

  protected lostFocus () {}

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
  * - keep the root's positions up to date with the positions at which the roots are rendered (either via
  *   [[Root.setOrigin]] or [[Root.bindOrigin]]).
  *
  * Clients will generally not use this class directly but rather use the `Host2` or `Host3`
  * subclasses which integrate more tightly with the `scene2` and `scene3` libraries. */
export class Host implements Disposable {
  private readonly disposer = new Disposer()
  private readonly _roots = MutableList.local<Root>()

  constructor (readonly elem :HTMLElement) {
    this.disposer.add(mouseEvents("mousedown", "mousemove", "mouseup", "dblclick").
                      onEmit(ev => this.handleMouseEvent(ev)))
    this.disposer.add(wheelEvents.onEmit(ev => this.handleWheelEvent(ev)))
    this.disposer.add(touchEvents("touchstart", "touchmove", "touchcancel", "touchend").
                      onEmit(ev => this.handleTouchEvent(ev)))
    this.disposer.add(keyEvents("keydown", "keyup").onEmit(ev => this.handleKeyEvent(ev)))
    this.disposer.add(pointerEvents("pointerdown", "pointerup").onEmit(ev => {
      if (ev.type === "pointerdown") elem.setPointerCapture(ev.pointerId)
      else elem.releasePointerCapture(ev.pointerId)
    }))
  }

  get roots () :RList<Root> { return this._roots }

  /** Adds `root` to this host. The root will be inserted into the root list after all roots with a
    * lower or equal z-index, and before any roots with a higher z-index. */
  addRoot (root :Root) {
    const roots = this._roots
    let index = 0
    for (let ll = roots.length; index < ll; index += 1) {
      if (roots.elemAt(index).zIndex > root.zIndex) break
    }
    this._roots.insert(root, index)
    // TODO: we should only do this when the mouse is over the root
    root.cursor.onValue(cursor => this.elem.style.cursor = cursor)
  }

  removeRoot (root :Root, dispose = true) {
    const idx = this._roots.indexOf(root)
    if (idx >= 0) {
      this._roots.delete(idx)
      root.events.emit("removed")
      if (dispose) root.dispose()
      this.elem.style.cursor = "auto"
    }
  }

  dispatchEvent (event :UIEvent, op :(r:Root) => void) {
    for (let ii = this._roots.length - 1; ii >= 0; ii--) {
      if (event.cancelBubble) return
      op(this._roots.elemAt(ii))
    }
  }

  mouseToRoot (root :Root, event :MouseEvent, into :vec2) :vec2 {
    return this.adjustPos(
      vec2.set(into, event.clientX-root.origin[0], event.clientY-root.origin[1]))
  }
  touchToRoot (root :Root, touch :Touch, into :vec2) :vec2 {
    return this.adjustPos(
      vec2.set(into, touch.clientX-root.origin[0], touch.clientY-root.origin[1]))
  }
  protected adjustPos (pos :vec2) :vec2 {
    const rect = this.elem.getBoundingClientRect()
    pos[0] -= rect.left
    pos[1] -= rect.top
    return pos
  }

  handleMouseEvent (event :MouseEvent) {
    this.dispatchEvent(event, r => r.dispatchMouseEvent(this, event))
  }
  handleKeyEvent (event :KeyboardEvent) {
    // TODO: maintain a notion of which root currently has focus (if any)
    this.dispatchEvent(event, r => r.dispatchKeyEvent(event))
  }
  handleWheelEvent (event :WheelEvent) {
    this.dispatchEvent(event, r => r.dispatchWheelEvent(this, event))
  }
  handleTouchEvent (event :TouchEvent) {
    this.dispatchEvent(event, r => r.dispatchTouchEvent(this, event))
  }

  update (clock :Clock) {
    for (const root of this._roots) root.update(clock)
  }

  dispose () {
    for (const root of this._roots) {
      root.events.emit("removed")
      root.dispose()
    }
    this.disposer.dispose()
  }
}

/** A host that simply appends canvases to an HTML element (which should be positioned). */
export class HTMLHost extends Host {
  private readonly _textOverlay :HTMLInputElement
  private _clearText = NoopRemover

  constructor (elem :HTMLElement) {
    super(elem)
    const text = this._textOverlay = document.createElement("input")
    text.style.position = "absolute"
    text.style.background = "none"
    text.style.border = "none"
    text.style.outline = "none"

    this.roots.onChange(ev => {
      if (ev.type === "added") this.rootAdded(ev.elem)
    })
  }

  handleKeyEvent (event :KeyboardEvent) {
    // don't dispatch key events to the root while we have a text overlay
    if (!this._textOverlay.parentNode) super.handleKeyEvent(event)
  }

  private rootAdded (root :Root) {
    this.elem.appendChild(root.canvasElem)
    const style = root.canvasElem.style
    style.position = "absolute"
    style.pointerEvents = "none"
    style.left = `${root.origin[0]}px`
    style.top = `${root.origin[1]}px`
    style.zIndex = `${root.zIndex}`
    const unpos = root.events.onEmit(c => {
      if (c === "moved") {
        style.left = `${root.origin[0]}px`
        style.top = `${root.origin[1]}px`
      }
    })
    const unviz = root.visible.onValue(
      viz => root.canvasElem.style.visibility = viz ? "visible" : "hidden")
    // TODO: this text overlay stuff needs to handle multiple roots, which will need the host to
    // have some idea of a host-wide focus; we don't have that now so we punt
    const clearText = () => {
      const text = this._textOverlay
      if (text.parentNode) {
        this.elem.removeChild(text)
        this._clearText()
        this._clearText = NoopRemover
      }
    }
    const unfocus = root.focus.onValue(focus => {
      const text = this._textOverlay
      if (focus && focus.config.type === "text") {
        this._clearText()
        this._clearText = (focus as any).configInput(text) // avoid importing Text here
        text.style.zIndex = `${root.zIndex+1}`
        this.elem.appendChild(text)
        text.focus() // for mobile (has to happen while handling touch event)
        setTimeout(() => text.focus(), 1) // for desktop (fails if done immediately, yay!)
      } else clearText()
    });

    root.events.whenOnce(e => e === "removed", _ => {
      this.elem.removeChild(root.canvasElem)
      unviz(); unfocus(); unpos(); clearText()
    })
  }
}
