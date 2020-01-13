import {rect} from "../core/math"
import {Value} from "../core/react"
import {Remover} from "../core/util"
import {Model, ModelKey, ElementsModel} from "./model"
import {Spec} from "./style"
import {Element} from "./element"
import {AbsGroup, AxisConfig, HGroup, OffAxisPolicy, VGroup} from "./group"
import {CursorConfig} from "./cursor"
import {Drag} from "./drag"

export type ElementConfigMaker = (model :Model, key :ModelKey) => Element.Config

export function elementConfig (
  element :Element.Config|ElementConfigMaker, model :Model, key :ModelKey
) {
  return typeof element === "function" ? element(model, key) : element
}

export namespace List {

  /** Base interface for list-like elements. */
  export interface AbstractConfig extends AxisConfig {
    element :Element.Config|ElementConfigMaker
    model :Spec<ElementsModel<ModelKey>>
  }

  /** Defines configuration for [[Horiz]] elements. */
  export interface HorizConfig extends AbstractConfig {
    type :"hlist"
  }

  /** Interface used by list-like elements. */
  export interface Like {
    elements :Map<ModelKey, Element>
    contents :Element[]
  }

  /** An hlist displays a dynamic list of elements, each instantiated from a sub-model and a list
    * element template. The elements are arrayed along a horizontal axis like a [[Row]]. */
  export class Horiz extends HGroup implements Like {
    readonly elements = new Map<ModelKey, Element>()
    readonly contents :Element[] = []

    constructor (ctx :Element.Context, parent :Element, readonly config :HorizConfig) {
      super(ctx, parent, config)
      this.disposer.add(syncContents(ctx, this, ctx.model.resolveAs(config.model, "model")))
    }
  }

  /** Defines configuration for [[Vert]] elements. */
  export interface VertConfig extends AbstractConfig {
    type :"vlist"
  }

  /** A vlist displays a dynamic list of elements, each instantiated from a sub-model and a list
    * element template. The elements are arrayed along a vertical axis like a [[Column]]. */
  export class Vert extends VGroup implements Like {
    readonly elements = new Map<ModelKey, Element>()
    readonly contents :Element[] = []

    constructor (ctx :Element.Context, parent :Element, readonly config :VertConfig) {
      super(ctx, parent, config)
      this.disposer.add(syncContents(ctx, this, ctx.model.resolveAs(config.model, "model")))
    }
  }

  /** Defines configuration for [[Abs]] elements. */
  export interface AbsConfig extends AbstractConfig {
    type :"absList"
  }

  /** An absList displays a dynamic list of elements, each instantiated from a sub-model and a list
    * element template. The elements are positioned arbitrarily like an [[AbsLayout]]. */
  export class Abs extends AbsGroup implements Like {
    readonly elements = new Map<ModelKey, Element>()
    readonly contents :Element[] = []

    constructor (ctx :Element.Context, parent :Element, readonly config :AbsConfig) {
      super(ctx, parent, config)
      this.disposer.add(syncContents(ctx, this, ctx.model.resolveAs(config.model, "model")))
    }
  }

  /** Defines configuration for [[DragVert]] elements. */
  export interface DragVertConfig extends AbstractConfig {
    type :"dragVList"
    updateOrder :Spec<Drag.OrderUpdater>
    dropCursor? :CursorConfig
  }

  /** A vlist with draggable elements. */
  export class DragVert extends VGroup implements Like {
    readonly reorderer :Drag.ReorderDragger
    readonly elements = new Map<ModelKey, Element>()
    readonly contents :Element[] = []

    constructor (ctx :Element.Context, parent :Element, readonly config :DragVertConfig) {
      super(ctx, parent, config)
      this.reorderer = Drag.makeReorderer(
        ctx, "vertical", ctx.model.resolveAs(config.updateOrder, "updateOrder"),
        this, this.contents, false, config.gap || 0, config.cursor)

      const model = ctx.model.resolveAs(config.model, "model")
      this.disposer.add(syncContents(ctx, this, model, (model, key) => ({
        type: "dragVElement",
        key: Value.constant(key),
        contents: elementConfig(config.element, model, key),
      })))
    }

    applyToChildren (op :Element.Op) {
      super.applyToChildren(op)
      op(this.reorderer.cursor)
    }
    queryChildren<R> (query :Element.Query<R>) {
      return super.queryChildren(query) || query(this.reorderer.cursor)
    }

    protected relayout () {
      super.relayout()
      this.reorderer.layout()
    }
    protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
      super.rerender(canvas, region)
      this.reorderer.cursor.render(canvas, region)
    }

    protected get defaultOffPolicy () :OffAxisPolicy { return "stretch" }
  }

  /** Defines configuration for [[DragVElement]] elements. */
  export interface DragVElementConfig extends Drag.ElemConfig {
    type :"dragVElement"
  }

  const DragVElementStyleScope = {id: "dragVElement", states: Drag.ElementStates}

  /** A non-selectable draggable element to use in [[DragVert]]. */
  export class DragVElement extends Drag.Elem {
    protected get customStyleScope () { return DragVElementStyleScope }
    protected get dragOwner () { return (this.parent as DragVert).reorderer }
  }

  /** Synchronizes a list's contents with its data source. */
  export function syncContents (
    ctx :Element.Context,
    list :Element & Like,
    model :ElementsModel<ModelKey>,
    element :Element.Config|ElementConfigMaker = list.config.element
  ) :Remover {
    if (element === undefined) throw new Error(`Missing 'element' config`)
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
      // TODO: if the list did not change at all, avoid invalidation?
      list.invalidate()
    })
  }

  export const Catalog :Element.Catalog = {
    "hlist": (ctx, parent, cfg) => new Horiz(ctx, parent, cfg as HorizConfig),
    "vlist": (ctx, parent, cfg) => new Vert(ctx, parent, cfg as VertConfig),
    "absList": (ctx, parent, cfg) => new Abs(ctx, parent, cfg as AbsConfig),
    "dragVList": (ctx, parent, cfg) => new DragVert(ctx, parent, cfg as DragVertConfig),
    "dragVElement": (ctx, parent, cfg) => new DragVElement(ctx, parent, cfg as DragVElementConfig),
  }
}
