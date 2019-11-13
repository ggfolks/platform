import {rect} from "../core/math"
import {Mutable, Value} from "../core/react"
import {ModelKey, ElementsModel, Spec} from "./model"
import {Element} from "./element"
import {AxisConfig, OffAxisPolicy, VGroup} from "./group"
import {ElementConfigMaker, List, elementConfig} from "./list"
import {Drag} from "./drag"
import {CursorConfig} from "./cursor"

/** Defines configuration for [[TabbedPane]] elements. */
export interface TabbedPaneConfig extends AxisConfig {
  type :"tabbedPane"
  tabElement :Element.Config
  addTabElement? :Element.Config
  contentElement :Element.Config|ElementConfigMaker
  model :Spec<ElementsModel<ModelKey>>
  activeKey :Spec<Mutable<ModelKey>>
  updateOrder? :Spec<Drag.OrderUpdater>
  dropCursor? :CursorConfig
}

/** Contains a row of tabs and corresponding content pane. */
export class TabbedPane extends VGroup {
  readonly reorderer? :Drag.ReorderDragger
  readonly contents :Element[] = []

  constructor (ctx :Element.Context, parent :Element, readonly config :TabbedPaneConfig) {
    super(ctx, parent, config)
    const activeKey = ctx.model.resolve(config.activeKey)
    const hlistConfig :List.HorizConfig = {
      type: "hlist",
      element: (model, key) => ({
        type: "tab",
        contents: config.tabElement,
        key: Value.constant(key),
        activeKey,
      }),
      model: config.model,
    }
    this.contents.push(
      ctx.elem.create(ctx, this, {
        type: "box",
        scopeId: "tabList",
        contents: config.addTabElement ? {
          type: "row",
          contents: [hlistConfig, config.addTabElement],
        } : hlistConfig,
        style: {halign: "left"},
      })
    )
    const tabsModel = ctx.model.resolve(config.model)
    this.disposer.add(activeKey.onValue(activeKey => {
      const oldElement = this.contents[1]
      if (oldElement) oldElement.dispose()
      const model = tabsModel.resolve(activeKey)
      const contentConfig = elementConfig(config.contentElement, model, activeKey)
      const stretchedConfig = {constraints: {stretch: true}, ...contentConfig}
      this.contents[1] = ctx.elem.create(ctx.remodel(model), this, stretchedConfig)
      this.invalidate()
    }))

    const orderUpdater = ctx.model.resolveOpt(config.updateOrder)
    if (orderUpdater) {
      const hlist = this.findChild("hlist") as List.Horiz
      this.reorderer = Drag.makeReorderer(ctx, "horizontal", orderUpdater, this, hlist.contents,
                                          true, config.gap || 0, config.dropCursor)
    }
  }

  applyToChildren (op :Element.Op) {
    super.applyToChildren(op)
    if (this.reorderer) op(this.reorderer.cursor)
  }
  queryChildren<R> (query :Element.Query<R>) {
    return super.queryChildren(query) || (this.reorderer && query(this.reorderer.cursor))
  }

  protected relayout () {
    super.relayout()
    if (this.reorderer) this.reorderer.layout()
  }
  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    super.rerender(canvas, region)
    if (this.reorderer) this.reorderer.cursor.render(canvas, region)
  }

  protected get defaultOffPolicy () :OffAxisPolicy { return "stretch" }
}

/** Defines configuration for [[Tab]] elements. */
export interface TabConfig extends Drag.ElemConfig {
  type :"tab"
  activeKey :Spec<Mutable<ModelKey>>
}

const TabStyleScope = {id: "tab", states: Drag.ElementStates}

/** A single tab in a row. */
export class Tab extends Drag.Elem {
  private readonly _activeKey :Mutable<ModelKey>

  constructor (ctx :Element.Context, parent :Element, readonly config :TabConfig) {
    super(ctx, parent, config)
    this._activeKey = ctx.model.resolve(config.activeKey)
    this.recomputeStateOnChange(this._activeKey)
  }

  get styleScope () { return TabStyleScope }

  get selected () :boolean {
    // can be called before constructor is complete
    return this.key && this._activeKey && this._activeKey.current === this.key.current
  }

  select () :void { this._activeKey.update(this.key.current) }

  protected get dragOwner () { return this.requireAncestor(TabbedPane).reorderer }
}
