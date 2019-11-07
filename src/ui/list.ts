import {rect} from "../core/math"
import {Value} from "../core/react"
import {NoopRemover, Remover} from "../core/util"
import {Model, ModelKey, ElementsModel} from "./model"
import {Spec} from "./style"
import {Element, ElementConfig, ElementContext} from "./element"
import {AxisConfig, HGroup, OffAxisPolicy, VGroup} from "./group"
import {CursorConfig} from "./cursor"
import {OrderUpdater, DragElement, DragElementConfig, DragElementStates, ReorderDragger,
        makeReorderer} from "./drag"

export type ElementConfigMaker = (model :Model, key :ModelKey) => ElementConfig

export function elementConfig (
  element :ElementConfig|ElementConfigMaker, model :Model, key :ModelKey
) {
  return typeof element === "function" ? element(model, key) : element
}

/** Base interface for list-like elements. */
export interface AbstractListConfig extends AxisConfig {
  element :ElementConfig|ElementConfigMaker
  model :Spec<ElementsModel<ModelKey>>
}

/** Defines configuration for [[HList]] elements. */
export interface HListConfig extends AbstractListConfig {
  type :"hlist"
}

/** Interface used by list-like elements. */
export interface ListLike {
  elements :Map<ModelKey, Element>
  contents :Element[]
}

/** An hlist displays a dynamic list of elements, each instantiated from a sub-model and a list
  * element template. The elements are arrayed along a horizontal axis like a [[Row]]. */
export class HList extends HGroup implements ListLike {
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
export class VList extends VGroup implements ListLike {
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
  updateOrder :Spec<OrderUpdater>
  dropCursor? :CursorConfig
}

/** A vlist with draggable elements. */
export class DragVList extends VGroup implements ListLike {
  readonly reorderer :ReorderDragger
  readonly elements = new Map<ModelKey, Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :DragVListConfig) {
    super(ctx, parent, config)
    this.reorderer = makeReorderer(ctx, "vertical", ctx.model.resolve(config.updateOrder),
                                   this, this.contents, false, config.gap || 0, config.cursor)

    this.disposer.add(syncListContents(ctx, this, (model, key) => ({
      type: "dragVElement",
      key: Value.constant(key),
      contents: elementConfig(config.element, model, key),
    })))
  }

  protected revalidate () {
    super.revalidate()
    this.reorderer.validate()
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    super.rerender(canvas, region)
    this.reorderer.render(canvas, region)
  }

  protected get defaultOffPolicy () :OffAxisPolicy { return "stretch" }
}

/** Defines configuration for [[DragVElement]] elements. */
export interface DragVElementConfig extends DragElementConfig {
  type :"dragVElement"
}

const DragVElementStyleScope = {id: "dragVElement", states: DragElementStates}

/** A non-selectable draggable element to use in [[DragVList]]. */
export class DragVElement extends DragElement {

  get styleScope () { return DragVElementStyleScope }

  protected get dragOwner () { return (this.parent as DragVList).reorderer }
}

/** Synchronizes a list's contents with its data source. */
export function syncListContents (
  ctx :ElementContext,
  list :Element & ListLike,
  element :ElementConfig|ElementConfigMaker = list.config.element
) :Remover {
  const config = list.config as AbstractListConfig
  const model = ctx.model.resolveOpt(config.model)
  if (!model) return NoopRemover
  return model.keys.onValue(keys => {
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
        const emodel = model.resolve(key)
        elem = ctx.elem.create(ctx.remodel(emodel), list, elementConfig(element, emodel, key))
        list.elements.set(key, elem)
      }
      contents.push(elem)
    }
    list.invalidate()
  })
}
