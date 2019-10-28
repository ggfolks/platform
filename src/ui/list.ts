import {rect, vec2} from "../core/math"
import {Source, Value} from "../core/react"
import {Noop, NoopRemover, PMap, Remover} from "../core/util"
import {ModelKey, ModelProvider} from "./model"
import {
  Control, ControlConfig, ControlStates, Element, ElementConfig, ElementContext, PointerInteraction,
} from "./element"
import {DefaultPaint, PaintConfig, Spec} from "./style"
import {AxisConfig, HGroup, OffAxisPolicy, VGroup} from "./group"
import {strokeLinePath} from "./util"

/** Base interface for list-like elements. */
export interface AbstractListConfig extends AxisConfig {
  element :ElementConfig
  data :Spec<ModelProvider>
  keys :Spec<Source<ModelKey[]>>
}

/** Defines configuration for [[HList]] elements. */
export interface HListConfig extends AbstractListConfig {
  type :"hlist"
}

/** Interface used by list-like elements. */
export interface AbstractList {
  elements :Map<ModelKey, Element>
  contents :Element[]
}

/** An hlist displays a dynamic list of elements, each instantiated from a sub-model and a list
  * element template. The elements are arrayed along a horizontal axis like a [[Row]]. */
export class HList extends HGroup implements AbstractList {
  readonly elements = new Map<ModelKey, Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :HListConfig) {
    super(ctx, parent, config)
    this.disposer.add(syncListContents(ctx, this))
  }
}

/** Defines configuration for [[VList]] elements. */
export interface VListConfig extends AbstractListConfig {
  type :"vlist"
}

/** A vlist displays a dynamic list of elements, each instantiated from a sub-model and a list
  * element template. The elements are arrayed along a vertical axis like a [[Column]]. */
export class VList extends VGroup implements AbstractList {
  readonly elements = new Map<ModelKey, Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :VListConfig) {
    super(ctx, parent, config)
    this.disposer.add(syncListContents(ctx, this))
  }
}

/** Defines configuration for [[DragVList]] elements. */
export interface DragVListConfig extends AbstractListConfig {
  type :"dragVList"
  key :Spec<Value<ModelKey>>
  updateOrder :Spec<OrderUpdater>
}

/** A vlist with draggable elements. */
export class DragVList extends VGroup implements AbstractList {
  readonly elements = new Map<ModelKey, Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :DragVListConfig) {
    super(ctx, parent, config)
    const updateOrder = ctx.model.resolve(config.updateOrder)
    this.disposer.add(syncListContents(ctx, this, {
      type: "dragVElement",
      contents: config.element,
      key: config.key,
      updateOrder,
    }))
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    super.rerender(canvas, region)
    for (const element of this.contents) {
      const dragVElement = element as DragVElement
      dragVElement.maybeRenderDrag(canvas, region)
    }
  }

  protected get defaultOffPolicy () :OffAxisPolicy { return "stretch" }
}

/** The style used for draggable elements. */
export interface DragElementStyle {
  stroke :Spec<PaintConfig>
}

/** Defines configuration for [[DragElement]] elements. */
export interface DragElementConfig extends ControlConfig {
  style :PMap<DragElementStyle>
}

/** The states used for draggable elements. */
export const DragElementStates = [...ControlStates, "selected"]

const dragBounds = rect.create()
const dropBounds = rect.create()

/** Base class for draggable list elements. */
export abstract class DragElement extends Control {
  private _stroke = this.observe(DefaultPaint)

  protected _dragPos? :vec2
  protected _dropStart? :vec2
  protected _dropEnd? :vec2
  protected _dropData? :any

  constructor (ctx :ElementContext, parent :Element, readonly config :DragElementConfig) {
    super(ctx, parent, config)
    const style = this.getStyle(this.config.style, "normal")
    if (style.stroke) this._stroke.observe(ctx.style.resolvePaint(style.stroke))
  }

  /** Checks whether dragging happens horizontally. */
  get horizontal () :boolean { return false }

  /** Checks whether to constrain dragging to our axis. */
  get constrain () :boolean { return true }

  /** Checks whether this element is selected. */
  get selected () :boolean { return false }

  /** Selects this element. */
  select (event :MouseEvent|TouchEvent) :void {}

  /** Checks whether we can reorder the elements. */
  abstract get canReorder () :boolean

  /** Reorders the element based on the supplied data. */
  abstract reorder (data :any) :void

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    const interaction = this.contents.handlePointerDown(event, pos)
    if (interaction) return interaction
    if (
      event instanceof MouseEvent && event.button !== 0 ||
      !this.visible.current ||
      !this.enabled.current
    ) {
      return undefined
    }
    this.select(event)
    if (!this.canReorder) return {move: Noop, release: Noop, cancel: Noop}
    const startPos = vec2.clone(pos)
    const offsetPos = vec2.fromValues(this.x - startPos[0], this.y - startPos[1])
    const DragHysteresis = 5
    const clear = () => {
      this.clearCursor(this)
      this.dirty()
      this._dragPos = undefined
      this._clearDropPosition()
    }
    return {
      move: (moveEvent :MouseEvent|TouchEvent, pos :vec2) => {
        if (this._dragPos === undefined && vec2.distance(startPos, pos) < DragHysteresis) return
        this.setCursor(this, "move")
        this.dirty()
        if (!this._dragPos) this._dragPos = vec2.create()
        vec2.add(this._dragPos, pos, offsetPos)
        if (this.constrain) {
          const posIdx = this.horizontal ? 1 : 0
          this._dragPos[posIdx] = this.bounds[posIdx]
        }
        this._updateDropPosition()
        this.dirty()
      },
      release: (upEvent :MouseEvent|TouchEvent, pos :vec2) => {
        clear()
        if (this._dropData !== undefined) this.reorder(this._dropData)
      },
      cancel: clear,
    }
  }

  protected _updateDropPosition () {
    this._dropStart = undefined
    this._dropEnd = undefined
    this._dropData = undefined
    let dropPos = 0
    let dropDistance = Infinity
    const [posIdx, sizeIdx] = this.horizontal ? [0, 2] : [1, 3]
    const center = this._dragPos![posIdx] + this.bounds[sizeIdx] / 2
    const list = this.parent as unknown as AbstractList
    for (let ii = 0; ii < list.contents.length; ii++) {
      const element = list.contents[ii]
      const startPos = element.bounds[posIdx]
      const startDistance = Math.abs(startPos - center)
      if (startDistance < dropDistance) {
        dropDistance = startDistance
        dropPos = startPos
        this._dropData = ii
      }
      const endPos = startPos + element.bounds[sizeIdx]
      const endDistance = Math.abs(endPos - center)
      if (endDistance < dropDistance) {
        dropDistance = endDistance
        dropPos = endPos
        this._dropData = ii + 1
      }
    }
    if (this._dropData === undefined) return
    this._dropStart = vec2.fromValues(this.x, this.y)
    this._dropEnd = vec2.fromValues(this.x + this.width - 1, this.y + this.height - 1)
    this._dropStart[posIdx] = dropPos
    this._dropEnd[posIdx] = dropPos
  }

  protected _clearDropPosition () {
    this._dropStart = undefined
    this._dropEnd = undefined
  }

  handleDoubleClick (event :MouseEvent, pos :vec2) :boolean {
    return this.contents.handleDoubleClick(event, pos)
  }

  expandBounds (bounds :rect) :rect {
    if (this._dragPos === undefined) return super.expandBounds(bounds)
    const cbounds = this.contents.expandBounds(this.contents.bounds)
    rect.union(
      dragBounds,
      cbounds,
      rect.set(
        dragBounds,
        cbounds[0] + this._dragPos[0] - this.x,
        cbounds[1] + this._dragPos[1] - this.y,
        cbounds[2],
        cbounds[3],
      ),
    )
    if (this._dropStart === undefined || this._dropEnd === undefined) return dragBounds
    const minX = Math.min(this._dropStart[0], this._dropEnd[0])
    const minY = Math.min(this._dropStart[1], this._dropEnd[1])
    return rect.union(
      dropBounds,
      dragBounds,
      rect.set(
        dropBounds,
        minX,
        minY,
        Math.max(this._dropStart[0], this._dropEnd[0]) - minX + 1,
        Math.max(this._dropStart[1], this._dropEnd[1]) - minY + 1,
      ),
    )
  }

  maybeRenderDrag (canvas :CanvasRenderingContext2D, region :rect) {
    if (this._dragPos === undefined) return
    canvas.globalAlpha = 0.5
    canvas.translate(this._dragPos[0] - this.x, this._dragPos[1] - this.y)
    super.rerender(canvas, region)
    canvas.translate(this.x - this._dragPos[0], this.y - this._dragPos[1])
    canvas.globalAlpha = 1

    if (this._dropStart === undefined || this._dropEnd === undefined) return
    this._stroke.current.prepStroke(canvas)
    strokeLinePath(
      canvas,
      this._dropStart[0] + 0.5,
      this._dropStart[1] + 0.5,
      this._dropEnd[0] + 0.5,
      this._dropEnd[1] + 0.5,
      1,
    )
  }

  protected get computeState () {
    return this.enabled.current && this.selected ? "selected" : super.computeState
  }
}

/** A function that changes the order of a list element. */
export type OrderUpdater = (key :ModelKey, index :number) => void

/** Defines configuration for [[DragVElement]] elements. */
export interface DragVElementConfig extends DragElementConfig {
  type :"dragVElement"
  key :Spec<Value<ModelKey>>
  updateOrder :Spec<OrderUpdater>
}

const DragVElementStyleScope = {id: "dragVElement", states: DragElementStates}

/** A non-selectable draggable element to use in [[DragVList]]. */
export class DragVElement extends DragElement {
  private readonly _key :Value<ModelKey>
  private readonly _orderUpdater :OrderUpdater

  constructor (ctx :ElementContext, parent :Element, readonly config :DragVElementConfig) {
    super(ctx, parent, config)
    this._key = ctx.model.resolve(config.key)
    this._orderUpdater = ctx.model.resolve(config.updateOrder)
  }

  get styleScope () { return DragVElementStyleScope }

  get canReorder () :boolean { return true }

  reorder (data :any) :void {
    this._orderUpdater(this._key.current, data)
  }
}

/** Synchronizes a list's contents with its data source. */
export function syncListContents (
  ctx :ElementContext,
  list :Element & AbstractList,
  elementConfig = list.config.element,
) :Remover {
  const config = list.config as AbstractListConfig
  const keys = ctx.model.resolveOpt(config.keys)
  const data = ctx.model.resolveOpt(config.data)
  if (!(keys && data)) return NoopRemover
  return keys.onValue(keys => {
    const {contents, elements} = list
    // first dispose no longer used elements
    const kset = new Set(keys)
    for (const [ekey, elem] of elements) {
      if (!kset.has(ekey)) {
        elements.delete(ekey)
        elem.dispose()
      }
    }
    // now create/reuse elements for the new keys
    contents.length = 0
    for (const key of keys) {
      let elem = elements.get(key)
      if (!elem) {
        elem = ctx.elem.create(ctx.remodel(data.resolve(key)), list, elementConfig)
        list.elements.set(key, elem)
      }
      contents.push(elem)
    }
    list.invalidate()
  })
}
