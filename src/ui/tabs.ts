import {rect} from "../core/math"
import {Mutable, Source, Value} from "../core/react"
import {Element, ElementConfig, ElementContext} from "./element"
import {AxisConfig, OffAxisPolicy, VGroup} from "./group"
import {DragElementConfig, DragElement, DragElementStates, HList, OrderUpdater} from "./list"
import {ModelKey, ModelProvider, Spec} from "./model"

/** Defines configuration for [[TabbedPane]] elements. */
export interface TabbedPaneConfig extends AxisConfig {
  type :"tabbedPane"
  tabElement :ElementConfig
  addTabElement? :ElementConfig
  contentElement :ElementConfig
  data :Spec<ModelProvider>
  keys :Spec<Source<ModelKey[]>>
  key :Spec<Value<ModelKey>>
  activeKey :Spec<Mutable<ModelKey>>
  updateOrder? :Spec<OrderUpdater>
}

/** Contains a row of tabs and corresponding content pane. */
export class TabbedPane extends VGroup {
  readonly contents :Element[] = []

  private readonly _hlist :HList

  constructor (ctx :ElementContext, parent :Element, readonly config :TabbedPaneConfig) {
    super(ctx, parent, config)
    const activeKey = ctx.model.resolve(config.activeKey)
    const updateOrder = config.updateOrder && ctx.model.resolve(config.updateOrder)
    const hlistConfig = {
      type: "hlist",
      element: {
        type: "tab",
        contents: config.tabElement,
        key: config.key,
        activeKey,
        updateOrder,
      },
      data: config.data,
      keys: config.keys,
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
    this._hlist = this.findChild("hlist") as HList
    const data = ctx.model.resolve(config.data)
    this.disposer.add(activeKey.onValue(activeKey => {
      const oldElement = this.contents[1]
      if (oldElement) oldElement.dispose()
      const model = data.resolve(activeKey)
      this.contents[1] = ctx.elem.create(ctx.remodel(model), this, config.contentElement)
      this.invalidate()
    }))
  }

  protected get defaultOffPolicy () :OffAxisPolicy { return "stretch" }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    super.rerender(canvas, region)
    for (const element of this._hlist.contents) {
      const tab = element as Tab
      tab.maybeRenderDrag(canvas, region)
    }
  }
}

/** Defines configuration for [[Tab]] elements. */
export interface TabConfig extends DragElementConfig {
  type :"tab"
  key :Spec<Value<ModelKey>>
  activeKey :Spec<Mutable<ModelKey>>
  updateOrder? :Spec<OrderUpdater>
}

const TabStyleScope = {id: "tab", states: DragElementStates}

/** A single tab in a row. */
export class Tab extends DragElement {
  private readonly _key :Value<ModelKey>
  private readonly _activeKey :Mutable<ModelKey>
  private readonly _orderUpdater? :OrderUpdater

  constructor (ctx :ElementContext, parent :Element, readonly config :TabConfig) {
    super(ctx, parent, config)
    this._key = ctx.model.resolve(config.key)
    this._activeKey = ctx.model.resolve(config.activeKey)
    this.disposer.add(this._activeKey.onValue(_ => this._state.update(this.computeState)))
    if (config.updateOrder) this._orderUpdater = ctx.model.resolve(config.updateOrder)
  }

  get styleScope () { return TabStyleScope }

  get horizontal () :boolean { return true }

  get selected () :boolean {
    // can be called before constructor is complete
    return this._key && this._activeKey && this._activeKey.current === this._key.current
  }

  select () :void {
    this._activeKey.update(this._key.current)
  }

  get canReorder () :boolean {
    return !!this._orderUpdater
  }

  reorder (data :any) :void {
    this._orderUpdater!(this._key.current, data)
  }
}
