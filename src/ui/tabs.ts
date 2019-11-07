import {rect} from "../core/math"
import {Mutable, Value} from "../core/react"
import {ModelKey, ElementsModel, Spec} from "./model"
import {Element, ElementConfig, ElementContext} from "./element"
import {AxisConfig, OffAxisPolicy, VGroup} from "./group"
import {ElementConfigMaker, HList, HListConfig, elementConfig} from "./list"
import {DragElementConfig, DragElement, DragElementStates, ReorderDragger, OrderUpdater,
        makeReorderer} from "./drag"
import {CursorConfig} from "./cursor"

/** Defines configuration for [[TabbedPane]] elements. */
export interface TabbedPaneConfig extends AxisConfig {
  type :"tabbedPane"
  tabElement :ElementConfig
  addTabElement? :ElementConfig
  contentElement :ElementConfig|ElementConfigMaker
  model :Spec<ElementsModel<ModelKey>>
  activeKey :Spec<Mutable<ModelKey>>
  updateOrder? :Spec<OrderUpdater>
  dropCursor? :CursorConfig
}

/** Contains a row of tabs and corresponding content pane. */
export class TabbedPane extends VGroup {
  readonly reorderer? :ReorderDragger
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :TabbedPaneConfig) {
    super(ctx, parent, config)
    const activeKey = ctx.model.resolve(config.activeKey)
    const hlistConfig :HListConfig = {
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
      this.contents[1] = ctx.elem.create(ctx.remodel(model), this, contentConfig)
      this.invalidate()
    }))

    const orderUpdater = ctx.model.resolveOpt(config.updateOrder)
    if (orderUpdater) {
      const hlist = this.findChild("hlist") as HList
      this.reorderer = makeReorderer(ctx, "horizontal", orderUpdater, this, hlist.contents,
                                     true, config.gap || 0, config.dropCursor)
    }
  }

  protected revalidate () {
    super.revalidate()
    if (this.reorderer) this.reorderer.validate()
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    super.rerender(canvas, region)
    if (this.reorderer) this.reorderer.render(canvas, region)
  }

  protected get defaultOffPolicy () :OffAxisPolicy { return "stretch" }
}

/** Defines configuration for [[Tab]] elements. */
export interface TabConfig extends DragElementConfig {
  type :"tab"
  activeKey :Spec<Mutable<ModelKey>>
}

const TabStyleScope = {id: "tab", states: DragElementStates}

/** A single tab in a row. */
export class Tab extends DragElement {
  private readonly _activeKey :Mutable<ModelKey>

  constructor (ctx :ElementContext, parent :Element, readonly config :TabConfig) {
    super(ctx, parent, config)
    this._activeKey = ctx.model.resolve(config.activeKey)
    this.disposer.add(this._activeKey.onValue(_ => this._state.update(this.computeState)))
  }

  get styleScope () { return TabStyleScope }

  get selected () :boolean {
    // can be called before constructor is complete
    return this.key && this._activeKey && this._activeKey.current === this.key.current
  }

  select () :void { this._activeKey.update(this.key.current) }

  protected get dragOwner () { return this.requireAncestor(TabbedPane).reorderer }
}
